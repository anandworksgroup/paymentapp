using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Growth;

namespace PaymentApp.Api.Modules.Delivery;

/// <summary>Absolute URLs for links that leave the platform in emails.</summary>
public static class PlatformUrls
{
    public static string Web(IConfiguration config) => (config["Platform:WebUrl"] ?? "http://localhost:3000").TrimEnd('/');
    public static string Api(IConfiguration config) => (config["Platform:ApiUrl"] ?? "http://localhost:5080").TrimEnd('/');
}

/// <summary>
/// Digital goods delivery (§52, §291). A product can carry downloadable assets; every purchase that grants
/// the product gets its own download grant per asset: an unguessable link (only its hash is stored), a
/// download limit and an expiry. Links stop working the moment the entitlement is revoked (refund,
/// chargeback, cancellation), and every download is counted and attributed to an IP.
/// </summary>
public class DeliveryService(AppDb db, Uow uow, FileService files, IConfiguration config)
{
    public async Task<ProductAsset> AddAsset(string productId, string fileId, string? name, int? maxDownloads, int? linkDays)
    {
        if (maxDownloads is < 1 or > 100) throw ApiException.Invalid("max_downloads must be 1-100.");
        if (linkDays is < 0 or > 3650) throw ApiException.Invalid("link_days must be 0-3650 (0 = no expiry).");
        var product = await db.Products.FirstOrDefaultAsync(p => p.Id == productId) ?? throw ApiException.NotFound("product");
        var file = await db.Files.FirstOrDefaultAsync(f => f.Id == fileId && f.OrgId == product.OrgId && f.Livemode == product.Livemode)
                   ?? throw ApiException.NotFound("file");
        if (file.Purpose != "product_asset") throw ApiException.Invalid("Upload the file with purpose=product_asset first.");
        return await uow.Run(async () =>
        {
            var a = new ProductAsset
            {
                Id = Ids.New("passet"), CreatedAt = uow.Now, ProductId = product.Id, FileId = file.Id, Name = string.IsNullOrWhiteSpace(name) ? file.FileName : name.Trim(),
                MaxDownloads = maxDownloads ?? 5, LinkDays = linkDays ?? 30,
            };
            db.ProductAssets.Add(a);
            if (product.DeliveryType == "access") product.DeliveryType = "download";
            uow.Audit("product.asset_add", "product", product.Id, after: new { asset = a.Id, file = file.Id, a.MaxDownloads, a.LinkDays });
            await Task.CompletedTask;
            return a;
        });
    }

    private static string NewToken() => "dl_" + Crypto.RandomToken(32);

    private string Url(string token) => $"{PlatformUrls.Api(config)}/v1/public/downloads/{token}";

    /// <summary>Called inside the unit of work that granted the entitlement.</summary>
    public async Task IssueFor(Entitlement e)
    {
        var assets = await db.ProductAssets.Where(a => a.ProductId == e.ProductId && a.Active).OrderBy(a => a.CreatedAt).ToListAsync();
        if (assets.Count == 0) return;
        if (await db.DownloadGrants.AnyAsync(g => g.EntitlementId == e.Id)) return; // re-activation keeps the original grants
        // A just-granted entitlement is stamped with its tenant on save, so fall back to the current tenant.
        var orgId = string.IsNullOrEmpty(e.OrgId) ? db.Tenant.OrgId ?? "" : e.OrgId;
        var livemode = string.IsNullOrEmpty(e.OrgId) ? db.Tenant.Livemode : e.Livemode;
        var links = new List<(string Name, string Url, int Max, DateTime? Expires)>();
        foreach (var a in assets)
        {
            var token = NewToken();
            var g = new DownloadGrant
            {
                Id = Ids.New("dlg"), CreatedAt = uow.Now, OrgId = orgId, Livemode = livemode, EntitlementId = e.Id, CustomerId = e.CustomerId,
                ProductId = e.ProductId, AssetId = a.Id, FileId = a.FileId, AssetName = a.Name, TokenHash = Crypto.Sha256Hex(token),
                MaxDownloads = a.MaxDownloads, ExpiresAt = a.LinkDays == 0 ? null : uow.Now.AddDays(a.LinkDays),
            };
            db.DownloadGrants.Add(g);
            links.Add((a.Name, Url(token), g.MaxDownloads, g.ExpiresAt));
        }
        var customer = await db.Customers.FirstOrDefaultAsync(c => c.Id == e.CustomerId);
        var product = await db.Products.FirstAsync(p => p.Id == e.ProductId);
        if (!string.IsNullOrEmpty(customer?.Email))
            db.Notifications.Add(new Notification
            {
                Id = Ids.New("ntf"), CreatedAt = uow.Now, OrgId = orgId, Channel = "email", Recipient = customer.Email, Template = "download_ready",
                Subject = $"Your download: {product.Name}", Status = "delivered", ObjectType = "entitlement", ObjectId = e.Id,
                Body = "Thanks for your purchase. Your files:\n" + string.Join("\n", links.Select(l =>
                    $"- {l.Name}: {l.Url} (up to {l.Max} downloads{(l.Expires == null ? "" : $", until {l.Expires:yyyy-MM-dd}")})")),
            });
        uow.Emit("entitlement.downloads_ready", e);
    }

    /// <summary>Public download: validates the link, counts it atomically and returns the file.</summary>
    public async Task<(StoredFile File, byte[] Content)> Download(string token, string? ip)
    {
        if (!token.StartsWith("dl_") || token.Length > 80) throw ApiException.NotFound("download");
        var hash = Crypto.Sha256Hex(token);
        using var _ = db.Tenant.Elevate();
        var g = await db.DownloadGrants.AsNoTracking().FirstOrDefaultAsync(x => x.TokenHash == hash) ?? throw ApiException.NotFound("download");
        var entitlement = await db.Entitlements.AsNoTracking().FirstAsync(x => x.Id == g.EntitlementId);
        if (entitlement.Status != "active") throw new ApiException(403, "access_revoked", "Access to this download has ended (the purchase was refunded or cancelled).");
        var now = uow.Now;
        if (g.ExpiresAt != null && g.ExpiresAt < now) throw new ApiException(410, "link_expired", "This download link has expired. Get a fresh one from your customer portal or contact the seller.");
        // Conditional increment: concurrent requests can't exceed the limit.
        var counted = await db.DownloadGrants.Where(x => x.Id == g.Id && x.Downloads < x.MaxDownloads)
            .ExecuteUpdateAsync(u => u.SetProperty(x => x.Downloads, x => x.Downloads + 1).SetProperty(x => x.LastDownloadAt, now).SetProperty(x => x.LastIp, ip));
        if (counted == 0) throw new ApiException(410, "download_limit_reached", $"This link has been used {g.MaxDownloads} times, the maximum. Contact the seller if you need it again.");
        var file = await db.Files.AsNoTracking().FirstAsync(f => f.Id == g.FileId);
        return (file, await files.Read(file));
    }

    /// <summary>Replaces a grant's link (portal "get link", merchant resend); the old link stops working.</summary>
    public async Task<(DownloadGrant Grant, string Url)> Rotate(string grantId, string customerId)
    {
        return await uow.Run(async () =>
        {
            var g = await db.DownloadGrants.FirstOrDefaultAsync(x => x.Id == grantId && x.CustomerId == customerId) ?? throw ApiException.NotFound("download");
            var e = await db.Entitlements.FirstAsync(x => x.Id == g.EntitlementId);
            if (e.Status != "active") throw new ApiException(403, "access_revoked", "Access to this download has ended.");
            var token = NewToken();
            g.TokenHash = Crypto.Sha256Hex(token);
            await Task.CompletedTask;
            return (g, Url(token));
        });
    }

    /// <summary>Merchant support action: more downloads and/or a later expiry.</summary>
    public async Task<DownloadGrant> Reset(string grantId, int? maxDownloads, int? extendDays, string? reason)
    {
        if (maxDownloads is < 1 or > 100) throw ApiException.Invalid("max_downloads must be 1-100.");
        if (extendDays is < 1 or > 3650) throw ApiException.Invalid("extend_days must be 1-3650.");
        return await uow.Run(async () =>
        {
            var g = await db.DownloadGrants.FirstOrDefaultAsync(x => x.Id == grantId) ?? throw ApiException.NotFound("download");
            var before = new { g.MaxDownloads, g.Downloads, g.ExpiresAt };
            if (maxDownloads != null) g.MaxDownloads = Math.Max(maxDownloads.Value, g.Downloads);
            if (extendDays != null) g.ExpiresAt = (g.ExpiresAt == null || g.ExpiresAt < uow.Now ? uow.Now : g.ExpiresAt.Value).AddDays(extendDays.Value);
            uow.Audit("download_grant.reset", "download_grant", g.Id, before, new { g.MaxDownloads, g.Downloads, g.ExpiresAt }, reason);
            await Task.CompletedTask;
            return g;
        });
    }
}
