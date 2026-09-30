using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace PaymentApp.Api.Common;

/// <summary>Globally unique, prefixed, unguessable identifiers (§234): pay_…, cus_…, evt_….</summary>
public static class Ids
{
    private const string Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

    public static string New(string prefix, int length = 20)
    {
        Span<byte> bytes = stackalloc byte[length];
        RandomNumberGenerator.Fill(bytes);
        var sb = new StringBuilder(prefix.Length + 1 + length);
        sb.Append(prefix).Append('_');
        foreach (var b in bytes) sb.Append(Alphabet[b % Alphabet.Length]);
        return sb.ToString();
    }
}

/// <summary>Every API error has a stable code (§133). Thrown anywhere; rendered by the error middleware.</summary>
public class ApiException(int status, string code, string message, object? details = null) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public object? Details { get; } = details;

    public static ApiException NotFound(string what) => new(404, "resource_missing", $"No such {what}.");
    public static ApiException Invalid(string message, object? details = null) => new(400, "invalid_request", message, details);
    public static ApiException Forbidden(string message = "You do not have permission to perform this action.") => new(403, "permission_denied", message);
    public static ApiException Conflict(string code, string message) => new(409, code, message);
    public static ApiException Unauthorized(string message = "Authentication required.") => new(401, "unauthenticated", message);
}

public static class Json
{
    public static readonly JsonSerializerOptions Options = Create();

    public static JsonSerializerOptions Create()
    {
        var o = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            DictionaryKeyPolicy = null,
            DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        };
        o.Converters.Add(new UtcDateTimeConverter());
        return o;
    }

    public static void Configure(JsonSerializerOptions o)
    {
        o.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
        o.PropertyNameCaseInsensitive = true;
        o.Converters.Add(new UtcDateTimeConverter());
    }

    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);
    public static T? Deserialize<T>(string? json) => string.IsNullOrWhiteSpace(json) ? default : JsonSerializer.Deserialize<T>(json, Options);

    /// <summary>Stored JSON columns are exposed as raw JSON in responses, not as escaped strings.</summary>
    public static JsonElement? Raw(string? json) =>
        string.IsNullOrWhiteSpace(json) ? null : JsonDocument.Parse(json).RootElement.Clone();
}

/// <summary>All backend timestamps are UTC (§136) and always serialized with a Z suffix.</summary>
public class UtcDateTimeConverter : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        DateTime.SpecifyKind(reader.GetDateTime().ToUniversalTime(), DateTimeKind.Utc);

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options) =>
        writer.WriteStringValue(DateTime.SpecifyKind(value, DateTimeKind.Utc).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"));
}

public interface IClock
{
    DateTime UtcNow { get; }
}

public class SystemClock : IClock
{
    /// <summary>Only the demo seeder moves this, to back-date sample history. Always zero at runtime.</summary>
    public TimeSpan Offset { get; set; }
    public DateTime UtcNow => DateTime.UtcNow + Offset;
}

public static class Crypto
{
    public static string Sha256Hex(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public static string Sha256Hex(byte[] value) => Convert.ToHexStringLower(SHA256.HashData(value));

    public static string HmacSha256Hex(string secret, string payload) =>
        Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(payload)));

    public static string RandomToken(int bytes = 32) =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(bytes)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static bool FixedTimeEquals(string a, string b) =>
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));

    // PBKDF2-SHA256, 210k iterations (OWASP 2023+ guidance). Format: pbkdf2$iter$salt$hash
    public static string HashPassword(string password)
    {
        const int iterations = 210_000;
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, 32);
        return $"pbkdf2${iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public static bool VerifyPassword(string password, string stored)
    {
        var parts = stored.Split('$');
        if (parts.Length != 4 || parts[0] != "pbkdf2") return false;
        var iterations = int.Parse(parts[1]);
        var salt = Convert.FromBase64String(parts[2]);
        var expected = Convert.FromBase64String(parts[3]);
        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }
}

/// <summary>
/// Field-level encryption for secrets at rest (provider credentials, webhook secrets, bank account
/// numbers, TOTP seeds) using AES-256-GCM. The key comes from configuration / a secret manager and is
/// never stored in the database (§70, §197, §198). Ciphertext carries a key version for rotation (§199).
/// </summary>
public class FieldEncryptor
{
    private readonly Dictionary<string, byte[]> _keys = new();
    private readonly string _activeVersion;

    public FieldEncryptor(IConfiguration config)
    {
        var section = config.GetSection("Security:EncryptionKeys");
        foreach (var child in section.GetChildren())
            if (!string.IsNullOrWhiteSpace(child.Value)) _keys[child.Key] = Convert.FromBase64String(child.Value);
        _activeVersion = config["Security:ActiveEncryptionKey"] ?? _keys.Keys.FirstOrDefault() ?? "";
        if (_keys.Count == 0 || !_keys.ContainsKey(_activeVersion))
            throw new InvalidOperationException("Security:EncryptionKeys must contain the active 32-byte base64 key.");
    }

    public string Encrypt(string plaintext)
    {
        var key = _keys[_activeVersion];
        var nonce = RandomNumberGenerator.GetBytes(12);
        var plain = Encoding.UTF8.GetBytes(plaintext);
        var cipher = new byte[plain.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(key, 16);
        aes.Encrypt(nonce, plain, cipher, tag);
        return $"{_activeVersion}:{Convert.ToBase64String(nonce)}:{Convert.ToBase64String(cipher)}:{Convert.ToBase64String(tag)}";
    }

    /// <summary>Binary variant for files at rest: [version-len][version][nonce 12][tag 16][cipher].</summary>
    public byte[] EncryptBytes(byte[] plain)
    {
        var key = _keys[_activeVersion];
        var nonce = RandomNumberGenerator.GetBytes(12);
        var cipher = new byte[plain.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(key, 16)) aes.Encrypt(nonce, plain, cipher, tag);
        var version = Encoding.UTF8.GetBytes(_activeVersion);
        return [(byte)version.Length, .. version, .. nonce, .. tag, .. cipher];
    }

    public byte[] DecryptBytes(byte[] stored)
    {
        var vlen = stored[0];
        var version = Encoding.UTF8.GetString(stored, 1, vlen);
        if (!_keys.TryGetValue(version, out var key)) throw new InvalidOperationException("Unknown encryption key version.");
        var offset = 1 + vlen;
        var nonce = stored.AsSpan(offset, 12);
        var tag = stored.AsSpan(offset + 12, 16);
        var cipher = stored.AsSpan(offset + 28);
        var plain = new byte[cipher.Length];
        using var aes = new AesGcm(key, 16);
        aes.Decrypt(nonce, cipher, tag, plain);
        return plain;
    }

    public string Decrypt(string stored)
    {
        var parts = stored.Split(':');
        if (parts.Length != 4 || !_keys.TryGetValue(parts[0], out var key))
            throw new InvalidOperationException("Unknown encryption key version.");
        var nonce = Convert.FromBase64String(parts[1]);
        var cipher = Convert.FromBase64String(parts[2]);
        var tag = Convert.FromBase64String(parts[3]);
        var plain = new byte[cipher.Length];
        using var aes = new AesGcm(key, 16);
        aes.Decrypt(nonce, cipher, tag, plain);
        return Encoding.UTF8.GetString(plain);
    }
}

/// <summary>Sensitive data masking for admin and support views (§137).</summary>
public static class Mask
{
    public static string? Email(string? email)
    {
        if (string.IsNullOrEmpty(email)) return email;
        var at = email.IndexOf('@');
        if (at <= 0) return "***";
        return email[0] + "***" + email[at..];
    }

    public static string? Tail(string? value, int visible = 4)
    {
        if (string.IsNullOrEmpty(value)) return value;
        return value.Length <= visible ? new string('*', value.Length) : new string('*', Math.Min(6, value.Length - visible)) + value[^visible..];
    }
}
