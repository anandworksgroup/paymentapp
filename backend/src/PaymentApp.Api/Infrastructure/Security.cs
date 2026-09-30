using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;

namespace PaymentApp.Api.Infrastructure;

/// <summary>Resource-based permissions (§77). Roles are just named collections of these.</summary>
public static class Permissions
{
    public static readonly string[] Merchant =
    [
        "payments.read", "payments.write", "payments.refund", "disputes.read", "disputes.write",
        "customers.read", "customers.write", "products.read", "products.write", "checkout.write", "coupons.write",
        "subscriptions.read", "subscriptions.write", "invoices.read", "invoices.write", "usage.read", "usage.write",
        "credits.read", "credits.write", "balance.read", "payouts.read", "payouts.manage", "payouts.destination",
        "ledger.read", "reports.read", "analytics.read", "tax.read", "tax.write",
        "developers.read", "developers.write", "team.read", "team.manage", "org.manage", "org.close",
        "compliance.read", "compliance.write", "wallet.read", "wallet.transfer", "copilot.use",
    ];

    public static readonly Dictionary<string, string[]> MerchantRoles = new()
    {
        ["owner"] = Merchant,
        // Admins manage almost everything except ownership, payout bank changes and closure (§5.2).
        ["admin"] = Merchant.Except(["payouts.destination", "org.close"]).ToArray(),
        ["finance"] = ["payments.read", "payments.refund", "disputes.read", "disputes.write", "invoices.read", "balance.read",
            "payouts.read", "payouts.manage", "ledger.read", "reports.read", "analytics.read", "tax.read", "customers.read",
            "subscriptions.read", "usage.read", "credits.read", "wallet.read", "copilot.use"],
        ["developer"] = ["developers.read", "developers.write", "products.read", "products.write", "payments.read", "customers.read",
            "subscriptions.read", "invoices.read", "usage.read", "usage.write", "checkout.write", "credits.read", "copilot.use"],
        ["support"] = ["customers.read", "customers.write", "payments.read", "subscriptions.read", "invoices.read", "disputes.read", "products.read"],
        ["analyst"] = ["payments.read", "customers.read", "products.read", "subscriptions.read", "invoices.read", "reports.read",
            "analytics.read", "usage.read", "balance.read", "copilot.use"],
        ["compliance_analyst"] = ["compliance.read", "customers.read", "payments.read", "disputes.read"],
    };

    public static readonly string[] Admin =
    [
        "admin.overview", "admin.merchants.read", "admin.merchants.decide", "admin.users.read", "admin.pii.unmask",
        "admin.transactions.read", "admin.ledger.read", "admin.ledger.adjust", "admin.recon.read", "admin.recon.resolve",
        "admin.payouts.hold", "admin.aml.read", "admin.aml.write", "admin.cases.decide", "admin.sanctions.decide",
        "admin.restrict", "admin.freeze", "admin.approve", "admin.providers.manage", "admin.config.manage",
        "admin.audit.read", "admin.export", "admin.reports.read", "admin.regulatory.report", "admin.kyc.decide",
    ];

    private static readonly string[] AdminReads = Admin.Where(p => p.EndsWith(".read") || p == "admin.overview").ToArray();

    public static readonly Dictionary<string, string[]> AdminRoles = new()
    {
        ["SUPER_ADMIN"] = Admin,
        ["COMPLIANCE_ADMIN"] = ["admin.overview", "admin.merchants.read", "admin.merchants.decide", "admin.users.read", "admin.pii.unmask",
            "admin.transactions.read", "admin.aml.read", "admin.aml.write", "admin.cases.decide", "admin.sanctions.decide", "admin.restrict",
            "admin.freeze", "admin.approve", "admin.audit.read", "admin.export", "admin.reports.read", "admin.kyc.decide", "admin.payouts.hold"],
        // AML analysts investigate; they cannot touch payouts, providers, secrets or unmasked exports (§86).
        ["AML_ANALYST"] = ["admin.overview", "admin.users.read", "admin.merchants.read", "admin.transactions.read", "admin.aml.read", "admin.aml.write", "admin.restrict"],
        ["FRAUD_ANALYST"] = ["admin.overview", "admin.users.read", "admin.merchants.read", "admin.transactions.read", "admin.aml.read", "admin.aml.write", "admin.restrict"],
        // Finance has no sanctions or AML case authority (§86).
        ["FINANCE_ADMIN"] = ["admin.overview", "admin.merchants.read", "admin.transactions.read", "admin.ledger.read", "admin.ledger.adjust",
            "admin.recon.read", "admin.recon.resolve", "admin.payouts.hold", "admin.reports.read", "admin.approve"],
        ["SUPPORT_ADMIN"] = ["admin.overview", "admin.users.read", "admin.merchants.read", "admin.transactions.read"],
        ["AUDITOR"] = AdminReads.Concat(["admin.export"]).ToArray(),
        ["LEGAL_REVIEWER"] = ["admin.overview", "admin.users.read", "admin.aml.read", "admin.audit.read", "admin.approve", "admin.pii.unmask"],
        ["REGULATORY_REPORTING"] = ["admin.overview", "admin.aml.read", "admin.users.read", "admin.regulatory.report", "admin.export"],
        ["READ_ONLY_ADMIN"] = ["admin.overview", "admin.merchants.read", "admin.users.read", "admin.transactions.read", "admin.reports.read"],
    };
}

/// <summary>Who is calling, on behalf of which tenant, with which permissions. One per request.</summary>
public class RequestContext
{
    public string RequestId { get; set; } = Ids.New("req", 16);
    public string? Ip { get; set; }
    public string? UserAgent { get; set; }
    public string? DeviceId { get; set; }
    public User? User { get; set; }
    public Session? Session { get; set; }
    public ApiKey? ApiKey { get; set; }
    public string? OrgId { get; set; }
    public bool Livemode { get; set; }
    public string? MemberRole { get; set; }
    public HashSet<string> Permissions { get; set; } = [];
    public HashSet<string> AdminPermissions { get; set; } = [];
    public bool IsSystem { get; set; }

    public string ActorType => IsSystem ? "system" : ApiKey != null ? "api_key" : User?.PlatformRole != null && OrgId == null ? "admin" : User != null ? "user" : "anonymous";
    public string ActorId => IsSystem ? "system" : ApiKey?.Id ?? User?.Id ?? "anonymous";
    public string? ActorRole => User?.PlatformRole ?? MemberRole ?? ApiKey?.Type;

    public User RequireUser() => User ?? throw ApiException.Unauthorized();

    public string RequireOrg(string permission)
    {
        if (User == null && ApiKey == null) throw ApiException.Unauthorized();
        if (OrgId == null) throw ApiException.Invalid("Select an organization (X-Org-Id header) or use an API key.");
        if (!Permissions.Contains(permission)) throw ApiException.Forbidden($"Missing permission '{permission}'.");
        return OrgId;
    }

    public User RequireAdmin(string permission)
    {
        var user = RequireUser();
        if (user.PlatformRole == null) throw ApiException.Forbidden("Platform staff only.");
        if (!AdminPermissions.Contains(permission)) throw ApiException.Forbidden($"Your role {user.PlatformRole} lacks '{permission}'.");
        return user;
    }

    /// <summary>High-risk actions need a recent re-authentication (§201).</summary>
    public void RequireStepUp(IClock clock)
    {
        if (ApiKey != null) throw ApiException.Forbidden("This action requires a signed-in user with recent re-authentication.");
        if (Session?.StepUpUntil == null || Session.StepUpUntil < clock.UtcNow)
            throw new ApiException(403, "step_up_required", "Re-authenticate (POST /v1/auth/step-up) to perform this action.");
    }
}

public class AuthMiddleware(RequestDelegate next)
{
    public async Task Invoke(HttpContext http, AppDb db, RequestContext ctx, TenantScope tenant, IClock clock)
    {
        ctx.Ip = http.Connection.RemoteIpAddress?.ToString();
        ctx.UserAgent = http.Request.Headers.UserAgent.ToString();
        ctx.DeviceId = http.Request.Headers["X-Device-Id"].FirstOrDefault();
        if (http.Request.Headers.TryGetValue("X-Request-Id", out var rid) && rid.ToString().Length is > 0 and <= 64) ctx.RequestId = rid.ToString();
        http.Response.Headers["Request-Id"] = ctx.RequestId;

        var auth = http.Request.Headers.Authorization.ToString();
        if (auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            var token = auth[7..].Trim();
            if (token.StartsWith("sk_") || token.StartsWith("rk_")) await AuthenticateApiKey(token, db, ctx, tenant, clock);
            else await AuthenticateSession(token, http, db, ctx, tenant, clock);
        }
        await next(http);
    }

    private static async Task AuthenticateApiKey(string token, AppDb db, RequestContext ctx, TenantScope tenant, IClock clock)
    {
        var hash = Crypto.Sha256Hex(token);
        var key = await db.ApiKeys.FirstOrDefaultAsync(k => k.KeyHash == hash && k.RevokedAt == null)
                  ?? throw new ApiException(401, "invalid_api_key", "Invalid API key provided.");
        if (!string.IsNullOrEmpty(key.AllowedIpsCsv) && !key.AllowedIpsCsv.Split(',').Contains(ctx.Ip))
            throw new ApiException(403, "ip_not_allowed", "This API key is not allowed from your IP address.");
        var org = await db.Organizations.FirstAsync(o => o.Id == key.OrgId);
        if (org.Status == "CLOSED") throw new ApiException(401, "account_closed", "This account is closed.");
        if (key.Livemode && org.GoLiveState != "PRODUCTION")
            throw new ApiException(403, "live_mode_not_activated", "Live mode is not activated for this account.");
        ctx.ApiKey = key;
        ctx.OrgId = key.OrgId;
        ctx.Livemode = key.Livemode;
        ctx.Permissions = key.Type == "restricted"
            ? (Json.Deserialize<string[]>(key.PermissionsJson) ?? []).ToHashSet()
            : Permissions.MerchantRoles["admin"].Except(["team.manage", "developers.write", "org.manage", "copilot.use"]).ToHashSet();
        tenant.Set(key.OrgId, key.Livemode);
        key.LastUsedAt = clock.UtcNow;
        await db.SaveChangesAsync();
    }

    private static async Task AuthenticateSession(string token, HttpContext http, AppDb db, RequestContext ctx, TenantScope tenant, IClock clock)
    {
        var hash = Crypto.Sha256Hex(token);
        var now = clock.UtcNow;
        var session = await db.Sessions.FirstOrDefaultAsync(s => s.TokenHash == hash && s.RevokedAt == null && s.ExpiresAt > now);
        if (session == null) throw new ApiException(401, "session_expired", "Your session has expired. Sign in again.");
        var user = await db.Users.FirstAsync(u => u.Id == session.UserId);
        if (user.Status == "CLOSED" || user.DeletedAt != null) throw new ApiException(401, "account_closed", "This account is closed.");
        ctx.Session = session;
        if (session.MfaPending)
        {
            // Only the MFA completion endpoint is reachable with a half-authenticated session.
            if (!http.Request.Path.StartsWithSegments("/v1/auth/mfa/verify") && !http.Request.Path.StartsWithSegments("/v1/auth/logout"))
                throw new ApiException(401, "mfa_required", "Complete multi-factor authentication.");
        }
        ctx.User = user;
        if (user.PlatformRole != null && Permissions.AdminRoles.TryGetValue(user.PlatformRole, out var adminPerms))
            ctx.AdminPermissions = adminPerms.ToHashSet();

        var orgId = http.Request.Headers["X-Org-Id"].FirstOrDefault();
        if (!string.IsNullOrEmpty(orgId))
        {
            var membership = await db.Memberships.FirstOrDefaultAsync(m => m.OrgId == orgId && m.UserId == user.Id)
                             ?? throw ApiException.Forbidden("You are not a member of this organization.");
            var org = await db.Organizations.FirstAsync(o => o.Id == orgId);
            var live = string.Equals(http.Request.Headers["X-Livemode"].FirstOrDefault(), "true", StringComparison.OrdinalIgnoreCase);
            if (live && org.GoLiveState != "PRODUCTION") throw new ApiException(403, "live_mode_not_activated", "Live mode is not activated for this account.");
            ctx.OrgId = orgId;
            ctx.Livemode = live;
            ctx.MemberRole = membership.Role;
            ctx.Permissions = Permissions.MerchantRoles.TryGetValue(membership.Role, out var p) ? p.ToHashSet() : [];
            tenant.Set(orgId, live);
        }
        if (session.LastSeenAt < now.AddMinutes(-1)) { session.LastSeenAt = now; user.LastActivityAt = now; await db.SaveChangesAsync(); }
    }
}
