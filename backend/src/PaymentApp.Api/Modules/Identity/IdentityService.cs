using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Compliance;

namespace PaymentApp.Api.Modules.Identity;

/// <summary>RFC 6238 TOTP (30s, 6 digits, SHA-1) for MFA (§7).</summary>
public static class Totp
{
    private const string Base32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    public static string NewSecret()
    {
        var bytes = RandomNumberGenerator.GetBytes(20);
        var sb = new StringBuilder();
        int buffer = 0, bits = 0;
        foreach (var b in bytes)
        {
            buffer = (buffer << 8) | b; bits += 8;
            while (bits >= 5) { sb.Append(Base32[(buffer >> (bits - 5)) & 31]); bits -= 5; }
        }
        if (bits > 0) sb.Append(Base32[(buffer << (5 - bits)) & 31]);
        return sb.ToString();
    }

    private static byte[] Decode(string s)
    {
        var output = new List<byte>();
        int buffer = 0, bits = 0;
        foreach (var c in s.TrimEnd('=').ToUpperInvariant())
        {
            buffer = (buffer << 5) | Base32.IndexOf(c); bits += 5;
            if (bits >= 8) { output.Add((byte)(buffer >> (bits - 8))); bits -= 8; }
        }
        return output.ToArray();
    }

    public static string Code(string secret, DateTime at)
    {
        var counter = new DateTimeOffset(at).ToUnixTimeSeconds() / 30;
        var msg = BitConverter.GetBytes(counter);
        if (BitConverter.IsLittleEndian) Array.Reverse(msg);
        var hash = HMACSHA1.HashData(Decode(secret), msg);
        var offset = hash[^1] & 0x0F;
        var binary = ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
        return (binary % 1_000_000).ToString("D6");
    }

    public static bool Verify(string secret, string code, DateTime now) =>
        new[] { -1, 0, 1 }.Any(w => Crypto.FixedTimeEquals(Code(secret, now.AddSeconds(30 * w)), code.Trim()));
}

public class IdentityService(AppDb db, Uow uow, FieldEncryptor encryptor, ScreeningService screening, IConfiguration config)
{
    public async Task<(User User, string Token, Session Session)> SignUp(string email, string password, string name, string? country, string? phone)
    {
        email = NormalizeEmail(email);
        ValidatePassword(password);
        if (string.IsNullOrWhiteSpace(name)) throw ApiException.Invalid("name is required.");
        if (await db.Users.AnyAsync(u => u.Email == email)) throw ApiException.Conflict("email_taken", "An account with this email already exists.");
        var user = await uow.Run(async () =>
        {
            var u = new User
            {
                Id = Ids.New("usr"), CreatedAt = uow.Now, Email = email, PasswordHash = Crypto.HashPassword(password), Name = name.Trim(),
                Country = country?.ToUpperInvariant(), Phone = phone,
            };
            if (!string.IsNullOrEmpty(config["Platform:BootstrapAdminEmail"]) && string.Equals(config["Platform:BootstrapAdminEmail"], email, StringComparison.OrdinalIgnoreCase))
                u.PlatformRole = "SUPER_ADMIN";
            db.Users.Add(u);
            uow.Audit("user.signup", "user", u.Id);
            await Task.CompletedTask;
            return u;
        });
        var (token, session) = await IssueSession(user, mfaPending: false);
        return (user, token, session);
    }

    public async Task<object> Login(string email, string password, string? totp)
    {
        email = NormalizeEmail(email);
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);
        if (user == null || !Crypto.VerifyPassword(password, user.PasswordHash))
        {
            await Security(user?.Id, "login_failed", $"email={Mask.Email(email)}");
            throw new ApiException(401, "invalid_credentials", "Email or password is incorrect.");
        }
        if (user.Status == "CLOSED") throw new ApiException(401, "account_closed", "This account is closed.");
        var recentFailures = await db.SecurityEvents.CountAsync(e => e.UserId == user.Id && e.Type == "login_failed" && e.CreatedAt >= uow.Now.AddMinutes(-15));
        if (recentFailures >= 10) throw new ApiException(429, "too_many_attempts", "Too many failed sign-in attempts. Try again in 15 minutes.");
        if (user.MfaEnabled && totp != null && !Totp.Verify(encryptor.Decrypt(user.MfaSecretEnc!), totp, uow.Now))
            throw new ApiException(401, "invalid_mfa_code", "The authentication code is incorrect.");
        var mfaPending = user.MfaEnabled && totp == null;
        var (token, session) = await IssueSession(user, mfaPending);
        await Security(user.Id, mfaPending ? "mfa_challenge" : "login", null);
        return new { @object = "session", token, mfa_required = mfaPending, expires_at = session.ExpiresAt, user = mfaPending ? null : user };
    }

    public async Task<(string Token, Session Session)> IssueSession(User user, bool mfaPending)
    {
        var token = "ses_" + Crypto.RandomToken(32);
        var session = await uow.Run(async () =>
        {
            var s = new Session
            {
                Id = Ids.New("ses"), CreatedAt = uow.Now, UserId = user.Id, TokenHash = Crypto.Sha256Hex(token), ExpiresAt = uow.Now.AddDays(mfaPending ? 0.01 : 14),
                MfaPending = mfaPending, Ip = uow.Ctx.Ip, UserAgent = uow.Ctx.UserAgent, DeviceId = uow.Ctx.DeviceId, LastSeenAt = uow.Now,
            };
            db.Sessions.Add(s);
            if (!mfaPending)
            {
                user.LastLoginAt = uow.Now;
                await TrackDevice(user);
            }
            return s;
        });
        return (token, session);
    }

    private async Task TrackDevice(User user)
    {
        var fingerprint = Crypto.Sha256Hex((uow.Ctx.DeviceId ?? "") + "|" + (uow.Ctx.UserAgent ?? ""));
        var device = await db.Devices.FirstOrDefaultAsync(d => d.UserId == user.Id && d.Fingerprint == fingerprint);
        if (device == null)
        {
            device = new Device
            {
                Id = Ids.New("dev"), CreatedAt = uow.Now, UserId = user.Id, Fingerprint = fingerprint, UserAgent = uow.Ctx.UserAgent,
                Platform = uow.Ctx.UserAgent?.Contains("Dart") == true ? "mobile_app" : "web",
            };
            db.Devices.Add(device);
            if (await db.Devices.AnyAsync(d => d.UserId == user.Id))
                db.SecurityEvents.Add(new SecurityEvent { Id = Ids.New("sev"), CreatedAt = uow.Now, UserId = user.Id, Type = "new_device", Ip = uow.Ctx.Ip, DeviceId = device.Id });
        }
        device.LastSeenAt = uow.Now;
        device.LastIp = uow.Ctx.Ip;
    }

    public async Task<object> CompleteMfa(Session session, string code)
    {
        var user = await db.Users.FirstAsync(u => u.Id == session.UserId);
        if (!session.MfaPending) throw ApiException.Invalid("MFA already completed.");
        var ok = Totp.Verify(encryptor.Decrypt(user.MfaSecretEnc!), code, uow.Now) || await UseRecoveryCode(user, code);
        if (!ok) { await Security(user.Id, "mfa_failed", null); throw new ApiException(401, "invalid_mfa_code", "The authentication code is incorrect."); }
        await uow.Run(async () =>
        {
            session.MfaPending = false;
            session.ExpiresAt = uow.Now.AddDays(14);
            user.LastLoginAt = uow.Now;
            await TrackDevice(user);
            db.SecurityEvents.Add(new SecurityEvent { Id = Ids.New("sev"), CreatedAt = uow.Now, UserId = user.Id, Type = "login", Ip = uow.Ctx.Ip, Detail = "mfa" });
        });
        return new { @object = "session", mfa_required = false, user };
    }

    private async Task<bool> UseRecoveryCode(User user, string code)
    {
        var codes = Json.Deserialize<List<string>>(user.RecoveryCodesJson) ?? [];
        var hash = Crypto.Sha256Hex(code.Trim().ToUpperInvariant());
        if (!codes.Remove(hash)) return false;
        await uow.Run(async () => { user.RecoveryCodesJson = Json.Serialize(codes); await Task.CompletedTask; });
        return true;
    }

    public async Task<object> BeginMfaEnrollment(User user)
    {
        var secret = Totp.NewSecret();
        await uow.Run(async () => { user.MfaSecretEnc = encryptor.Encrypt(secret); user.MfaEnabled = false; await Task.CompletedTask; });
        var issuer = Uri.EscapeDataString(config["Platform:Name"] ?? "Monetization Platform");
        return new { secret, otpauth_url = $"otpauth://totp/{issuer}:{Uri.EscapeDataString(user.Email)}?secret={secret}&issuer={issuer}" };
    }

    public async Task<object> ConfirmMfa(User user, string code)
    {
        if (user.MfaSecretEnc == null) throw ApiException.Invalid("Start enrollment first.");
        if (!Totp.Verify(encryptor.Decrypt(user.MfaSecretEnc), code, uow.Now)) throw new ApiException(400, "invalid_mfa_code", "The code is incorrect.");
        var recovery = Enumerable.Range(0, 8).Select(_ => Ids.New("r", 10)[2..].ToUpperInvariant()).ToList();
        await uow.Run(async () =>
        {
            user.MfaEnabled = true;
            user.RecoveryCodesJson = Json.Serialize(recovery.Select(c => Crypto.Sha256Hex(c)).ToList());
            db.SecurityEvents.Add(new SecurityEvent { Id = Ids.New("sev"), CreatedAt = uow.Now, UserId = user.Id, Type = "mfa_enrolled", Ip = uow.Ctx.Ip });
            uow.Audit("user.mfa_enable", "user", user.Id);
            await Task.CompletedTask;
        });
        return new { mfa_enabled = true, recovery_codes = recovery, note = "Store these recovery codes safely. They are shown once." };
    }

    /// <summary>Re-authentication for high-risk actions (§201): password, plus TOTP when enabled.</summary>
    public async Task<object> StepUp(Session session, User user, string password, string? code)
    {
        if (!Crypto.VerifyPassword(password, user.PasswordHash)) throw new ApiException(401, "invalid_credentials", "Password is incorrect.");
        if (user.MfaEnabled && (code == null || !Totp.Verify(encryptor.Decrypt(user.MfaSecretEnc!), code, uow.Now)))
            throw new ApiException(401, "invalid_mfa_code", "An authentication code is required.");
        await uow.Run(async () =>
        {
            session.StepUpUntil = uow.Now.AddMinutes(10);
            db.SecurityEvents.Add(new SecurityEvent { Id = Ids.New("sev"), CreatedAt = uow.Now, UserId = user.Id, Type = "step_up", Ip = uow.Ctx.Ip });
            await Task.CompletedTask;
        });
        return new { step_up_until = session.StepUpUntil };
    }

    public async Task<object> SubmitKyc(User user, string fullName, string dateOfBirth, string country, string address, string documentType, int level)
    {
        if (level is < 1 or > 3) throw ApiException.Invalid("level must be 1-3.");
        if (!DateOnly.TryParse(dateOfBirth, out var dob) || dob > DateOnly.FromDateTime(uow.Now.AddYears(-18))) throw ApiException.Invalid("You must be at least 18.");
        var screen = await screening.Screen("user", user.Id, fullName, dateOfBirth, country, "kyc");
        return await uow.Run(async () =>
        {
            user.Name = fullName;
            user.DateOfBirth = dateOfBirth;
            user.Country = country.ToUpperInvariant();
            user.Address = address;
            // Sandbox KYC provider: names containing "review" go to manual review, "fail" are rejected.
            var lower = fullName.ToLowerInvariant();
            var result = screen.Result == "potential_match" || lower.Contains("review") ? "review" : lower.Contains("fail") ? "failed" : "verified";
            var check = new KycCheck
            {
                Id = Ids.New("kyc"), CreatedAt = uow.Now, UserId = user.Id, LevelRequested = level, DocumentType = documentType, Result = result,
                ProviderResponse = Json.Serialize(new { provider = "kyc_simulator", document_authentic = result != "failed", liveness = "passed", screening = screen.Result }),
                Reason = screen.Result == "potential_match" ? "Screening requires review" : null,
            };
            db.KycChecks.Add(check);
            var before = user.KycStatus;
            user.KycStatus = result switch { "verified" => "VERIFIED", "failed" => "FAILED", _ => "REVIEW" };
            if (result == "verified") { user.KycLevel = Math.Max(user.KycLevel, level); user.KycVerifiedAt = uow.Now; }
            uow.Transition("kyc", user.Id, before, user.KycStatus);
            uow.Audit("kyc.submit", "user", user.Id, after: new { level, result });
            await Task.CompletedTask;
            return (object)new { @object = "kyc_check", check.Id, status = user.KycStatus, kyc_level = user.KycLevel, message = result == "review" ? "We're reviewing your details. This usually takes less than a day." : null };
        });
    }

    private async Task Security(string? userId, string type, string? detail)
    {
        db.SecurityEvents.Add(new SecurityEvent { Id = Ids.New("sev"), CreatedAt = uow.Now, UserId = userId, Type = type, Ip = uow.Ctx.Ip, Detail = detail });
        await db.SaveChangesAsync();
    }

    public static string NormalizeEmail(string? email)
    {
        var e = email?.Trim().ToLowerInvariant() ?? "";
        if (e.Length is < 3 or > 254 || !e.Contains('@') || e.StartsWith('@') || e.EndsWith('@')) throw ApiException.Invalid("A valid email is required.");
        return e;
    }

    public static void ValidatePassword(string? password)
    {
        if (password == null || password.Length < 10) throw ApiException.Invalid("Password must be at least 10 characters.");
        if (password.Length > 200) throw ApiException.Invalid("Password is too long.");
    }
}
