using System.Text;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;

namespace PaymentApp.Api.Modules.Growth;

/// <summary>Malware-scanning hook (§96). The default reports "not_scanned" rather than pretending to scan.</summary>
public interface IFileScanner
{
    Task<string> Scan(byte[] content, string contentType);
}

public class NoScanner : IFileScanner
{
    public Task<string> Scan(byte[] content, string contentType) => Task.FromResult("not_scanned");
}

/// <summary>
/// Object storage for KYB/KYC documents and dispute evidence (§96): type-checked by content (not just
/// the extension), encrypted at rest with the field-encryption keys, hashed, and served only through
/// short-lived signed links whose use is audited.
/// </summary>
public class FileService(AppDb db, Uow uow, FieldEncryptor encryptor, IFileScanner scanner, IConfiguration config, IWebHostEnvironment env)
{
    public const long MaxBytes = 10 * 1024 * 1024;
    public static readonly string[] Purposes = ["kyb_document", "kyc_document", "dispute_evidence", "tax_document", "product_asset"];

    private string Root => Path.IsPathRooted(config["Storage:Path"] ?? "") ? config["Storage:Path"]! : Path.Combine(env.ContentRootPath, config["Storage:Path"] ?? "storage/files");
    private string Secret => config["Security:FileUrlSecret"] ?? config["Security:PortalTokenSecret"] ?? throw new InvalidOperationException("No file URL signing secret configured.");

    public async Task<StoredFile> Save(IFormFile upload, string purpose, string? orgId, string? userId, bool livemode)
    {
        if (!Purposes.Contains(purpose)) throw ApiException.Invalid($"purpose must be one of {string.Join(", ", Purposes)}.");
        if (upload.Length == 0) throw ApiException.Invalid("The file is empty.");
        if (upload.Length > MaxBytes) throw new ApiException(413, "file_too_large", "Files can be at most 10 MB.");
        using var ms = new MemoryStream();
        await upload.CopyToAsync(ms);
        var bytes = ms.ToArray();
        var detected = Sniff(bytes, allowArchive: purpose == "product_asset")
                       ?? throw new ApiException(415, "unsupported_file_type", purpose == "product_asset" ? "Upload a ZIP, PDF, PNG, JPEG, WebP, plain-text or CSV file." : "Upload a PDF, PNG, JPEG, WebP, plain-text or CSV file.");
        var scan = await scanner.Scan(bytes, detected);
        if (scan == "infected") throw new ApiException(422, "file_rejected", "The file failed the malware scan.");
        var id = Ids.New("file");
        var relative = Path.Combine(DateTime.UtcNow.ToString("yyyy-MM"), id + ".bin");
        var full = Path.Combine(Root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        await File.WriteAllBytesAsync(full, encryptor.EncryptBytes(bytes));
        return await uow.Run(async () =>
        {
            var f = new StoredFile
            {
                Id = id, CreatedAt = uow.Now, OrgId = orgId, UserId = userId, Purpose = purpose, Livemode = livemode,
                FileName = SafeName(upload.FileName, detected), ContentType = detected, Size = bytes.Length, Sha256 = Crypto.Sha256Hex(bytes),
                StoragePath = relative, UploadedBy = uow.Ctx.ActorId, ScanStatus = scan,
            };
            db.Files.Add(f);
            uow.Audit("file.upload", "file", f.Id, after: new { purpose, f.Size, f.Sha256, f.ContentType }, orgId: orgId);
            await Task.CompletedTask;
            return f;
        });
    }

    /// <summary>
    /// Stores bytes the platform produced itself (exports), so no content sniffing is needed. Same encryption,
    /// hashing and signed-link delivery as uploads.
    /// </summary>
    public async Task<StoredFile> SaveGenerated(byte[] bytes, string fileName, string contentType, string purpose, string? orgId, bool livemode)
    {
        var id = Ids.New("file");
        var relative = Path.Combine(DateTime.UtcNow.ToString("yyyy-MM"), id + ".bin");
        var full = Path.Combine(Root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        await File.WriteAllBytesAsync(full, encryptor.EncryptBytes(bytes));
        var f = new StoredFile
        {
            Id = id, CreatedAt = uow.Now, OrgId = orgId, Purpose = purpose, Livemode = livemode, FileName = fileName, ContentType = contentType,
            Size = bytes.Length, Sha256 = Crypto.Sha256Hex(bytes), StoragePath = relative, UploadedBy = "system", ScanStatus = "generated",
        };
        db.Files.Add(f);
        return f;
    }

    /// <summary>Decrypts a stored file and checks it against its recorded hash.</summary>
    public async Task<byte[]> Read(StoredFile f)
    {
        var content = encryptor.DecryptBytes(await File.ReadAllBytesAsync(Path.Combine(Root, f.StoragePath)));
        if (Crypto.Sha256Hex(content) != f.Sha256) throw new InvalidOperationException($"Integrity check failed for {f.Id}.");
        return content;
    }

    /// <summary>Removes a file's stored bytes and record (retention of generated files).</summary>
    public void Delete(StoredFile f)
    {
        var full = Path.Combine(Root, f.StoragePath);
        if (File.Exists(full)) File.Delete(full);
        db.Files.Remove(f);
    }

    /// <summary>Content sniffing: the declared type is ignored; only these signatures are accepted.</summary>
    public static string? Sniff(byte[] b, bool allowArchive = false)
    {
        bool Starts(params byte[] sig) => b.Length >= sig.Length && sig.Select((x, i) => b[i] == x).All(x => x);
        // Archives only for digital products sold to buyers, never for compliance documents.
        if (allowArchive && Starts(0x50, 0x4B, 0x03, 0x04)) return "application/zip";
        if (Starts(0x25, 0x50, 0x44, 0x46, 0x2D)) return "application/pdf";
        if (Starts(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)) return "image/png";
        if (Starts(0xFF, 0xD8, 0xFF)) return "image/jpeg";
        if (b.Length > 12 && Starts(0x52, 0x49, 0x46, 0x46) && Encoding.ASCII.GetString(b, 8, 4) == "WEBP") return "image/webp";
        // Text: valid UTF-8 without NUL bytes or markup that a browser could execute.
        if (b.Take(8192).Any(x => x == 0)) return null;
        var text = Encoding.UTF8.GetString(b.Take(8192).ToArray());
        if (text.Contains("<script", StringComparison.OrdinalIgnoreCase) || text.Contains("<html", StringComparison.OrdinalIgnoreCase)) return null;
        var lines = text.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Length > 0).Take(5).ToList();
        return lines.Count > 0 && lines.All(l => l.Contains(',')) ? "text/csv" : "text/plain";
    }

    private static string SafeName(string name, string contentType)
    {
        var baseName = new string(Path.GetFileNameWithoutExtension(name).Where(c => char.IsLetterOrDigit(c) || c is '-' or '_' or ' ').Take(80).ToArray()).Trim();
        var ext = contentType switch { "application/pdf" => ".pdf", "image/png" => ".png", "image/jpeg" => ".jpg", "image/webp" => ".webp", "text/csv" => ".csv", "application/zip" => ".zip", _ => ".txt" };
        return (baseName.Length == 0 ? "file" : baseName) + ext;
    }

    public (string Token, DateTime Expires) SignLink(StoredFile f, TimeSpan ttl)
    {
        var expires = uow.Now.Add(ttl);
        var body = $"{f.Id}|{new DateTimeOffset(expires).ToUnixTimeSeconds()}";
        var token = Convert.ToBase64String(Encoding.UTF8.GetBytes(body + "|" + Crypto.HmacSha256Hex(Secret, body))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return (token, expires);
    }

    public async Task<(StoredFile File, byte[] Content)> Open(string token)
    {
        string raw;
        try
        {
            var b64 = token.Replace('-', '+').Replace('_', '/');
            raw = Encoding.UTF8.GetString(Convert.FromBase64String(b64.PadRight(b64.Length + (4 - b64.Length % 4) % 4, '=')));
        }
        catch { throw ApiException.NotFound("file"); }
        var parts = raw.Split('|');
        if (parts.Length != 3 || !Crypto.FixedTimeEquals(Crypto.HmacSha256Hex(Secret, parts[0] + "|" + parts[1]), parts[2])) throw ApiException.NotFound("file");
        if (DateTimeOffset.FromUnixTimeSeconds(long.Parse(parts[1])) < uow.Now) throw new ApiException(410, "link_expired", "This download link has expired.");
        using var _ = db.Tenant.Elevate();
        var f = await db.Files.FirstOrDefaultAsync(x => x.Id == parts[0]) ?? throw ApiException.NotFound("file");
        return (f, await Read(f));
    }
}
