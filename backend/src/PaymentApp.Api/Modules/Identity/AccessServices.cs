using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Delivery;

namespace PaymentApp.Api.Modules.Identity;

// ───────────────────────── Sign-in location (§112) ─────────────────────────

public record GeoPoint(string? Country, double? Lat, double? Lon);

/// <summary>Where a request comes from. The default trusts only location headers set by the edge (CDN / load balancer).</summary>
public interface IGeoLocator
{
    GeoPoint? Locate(HttpRequest request);
}

/// <summary>
/// Reads visitor-location headers added by the edge (for example Cloudflare's CF-IPCountry, CF-IPLatitude and
/// CF-IPLongitude). Off unless Security:Geo:TrustEdgeHeaders is true, because a client could send these
/// headers itself when the API isn't behind an edge that overwrites them.
/// </summary>
public class EdgeGeoLocator(IConfiguration config) : IGeoLocator
{
    public GeoPoint? Locate(HttpRequest request)
    {
        if (!config.GetValue("Security:Geo:TrustEdgeHeaders", false)) return null;
        string? H(string key, string fallback) => request.Headers[config[$"Security:Geo:{key}"] ?? fallback].FirstOrDefault();
        var country = H("CountryHeader", "CF-IPCountry")?.Trim().ToUpperInvariant();
        if (country is { Length: not 2 } || country == "XX") country = null;
        double? Num(string? v) => double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : null;
        var lat = Num(H("LatitudeHeader", "CF-IPLatitude"));
        var lon = Num(H("LongitudeHeader", "CF-IPLongitude"));
        if (lat is < -90 or > 90 || lon is < -180 or > 180) (lat, lon) = (null, null);
        return country == null && lat == null ? null : new GeoPoint(country, lat, lon);
    }
}

public static class Geo
{
    public static double DistanceKm(double lat1, double lon1, double lat2, double lon2)
    {
        const double r = 6371;
        double Rad(double d) => d * Math.PI / 180;
        var dLat = Rad(lat2 - lat1);
        var dLon = Rad(lon2 - lon1);
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) + Math.Cos(Rad(lat1)) * Math.Cos(Rad(lat2)) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return 2 * r * Math.Asin(Math.Min(1, Math.Sqrt(a)));
    }
}

// ───────────────────────── Passwordless sign-in and password reset (§7) ─────────────────────────

/// <summary>
/// Email one-time codes, magic links and password reset. Requests always look the same whether or not the
/// address has an account (no enumeration); codes are 6 digits, single-use, valid 10 minutes and burnt after
/// 5 wrong tries; only hashes are stored. Resetting a password signs out every session.
/// </summary>
public class PasswordlessService(AppDb db, Uow uow, IdentityService identity, IConfiguration config)
{
    private const int MaxAttempts = 5;
    private static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan ResetLifetime = TimeSpan.FromMinutes(30);

    private static string CodeHash(string challengeId, string code) => Crypto.Sha256Hex(challengeId + ":" + code.Trim());

    private async Task<(User? User, bool Throttled)> Target(string email, string purpose)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);
        var since = uow.Now.AddMinutes(-15);
        var recent = await db.LoginChallenges.CountAsync(c => c.Email == email && c.Purpose == purpose && c.CreatedAt >= since);
        return (user is { Status: not "CLOSED", DeletedAt: null } ? user : null, recent >= 5);
    }

    private void Supersede(IEnumerable<LoginChallenge> open)
    {
        foreach (var c in open) { c.ConsumedAt = uow.Now; c.ConsumedBy = "superseded"; }
    }

    public async Task<object> RequestSignIn(string rawEmail)
    {
        var email = IdentityService.NormalizeEmail(rawEmail);
        var (user, throttled) = await Target(email, "sign_in");
        if (user != null && !throttled)
        {
            var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
            var token = "ml_" + Crypto.RandomToken(32);
            await uow.Run(async () =>
            {
                Supersede(await db.LoginChallenges.Where(c => c.UserId == user.Id && c.Purpose == "sign_in" && c.ConsumedAt == null).ToListAsync());
                var c = new LoginChallenge { Id = Ids.New("lch"), CreatedAt = uow.Now, UserId = user.Id, Email = email, Purpose = "sign_in", TokenHash = Crypto.Sha256Hex(token), ExpiresAt = uow.Now.Add(CodeLifetime), Ip = uow.Ctx.Ip };
                c.CodeHash = CodeHash(c.Id, code);
                db.LoginChallenges.Add(c);
                db.Notifications.Add(new Notification
                {
                    Id = Ids.New("ntf"), CreatedAt = uow.Now, UserId = user.Id, Channel = "email", Recipient = email, Template = "sign_in_code", Category = "security", Status = "delivered",
                    Subject = "Your sign-in code",
                    Body = $"Your code is {code}. It expires in 10 minutes.\nOr sign in with this link: {PlatformUrls.Web(config)}/login/magic?token={token}\nIf you didn't ask to sign in, ignore this email — your account is safe.",
                });
            });
        }
        return new { @object = "sign_in_request", sent = true, message = "If an account exists for that address, we've emailed a sign-in code and link." };
    }

    public async Task<object> VerifyCode(string rawEmail, string code)
    {
        var email = IdentityService.NormalizeEmail(rawEmail);
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);
        var now = uow.Now;
        var challenge = user == null ? null : await db.LoginChallenges.Where(c => c.UserId == user.Id && c.Purpose == "sign_in" && c.ConsumedAt == null && c.ExpiresAt > now)
            .OrderByDescending(c => c.CreatedAt).FirstOrDefaultAsync();
        if (user == null || challenge == null) throw new ApiException(401, "invalid_code", "That code is incorrect or has expired. Request a new one.");
        await identity.EnsureCanSignIn(user);
        var counted = await db.LoginChallenges.Where(c => c.Id == challenge.Id && c.Attempts < MaxAttempts).ExecuteUpdateAsync(u => u.SetProperty(c => c.Attempts, c => c.Attempts + 1));
        if (counted == 0)
        {
            await db.LoginChallenges.Where(c => c.Id == challenge.Id).ExecuteUpdateAsync(u => u.SetProperty(c => c.ConsumedAt, now).SetProperty(c => c.ConsumedBy, "too_many_attempts"));
            throw new ApiException(429, "too_many_attempts", "Too many wrong codes. Request a new one.");
        }
        if (!Crypto.FixedTimeEquals(CodeHash(challenge.Id, code), challenge.CodeHash))
        {
            await identity.RecordSecurityEvent(user.Id, "login_failed", "email_otp");
            throw new ApiException(401, "invalid_code", "That code is incorrect or has expired. Request a new one.");
        }
        return await Consume(challenge.Id, user, "email_otp");
    }

    public async Task<object> VerifyLink(string token)
    {
        var hash = Crypto.Sha256Hex(token ?? "");
        var now = uow.Now;
        var challenge = await db.LoginChallenges.FirstOrDefaultAsync(c => c.TokenHash == hash && c.Purpose == "sign_in" && c.ConsumedAt == null && c.ExpiresAt > now)
                        ?? throw new ApiException(401, "invalid_link", "This sign-in link is invalid, used or expired. Request a new one.");
        var user = await db.Users.FirstAsync(u => u.Id == challenge.UserId);
        return await Consume(challenge.Id, user, "magic_link");
    }

    private async Task<object> Consume(string challengeId, User user, string method)
    {
        var now = uow.Now;
        var consumed = await db.LoginChallenges.Where(c => c.Id == challengeId && c.ConsumedAt == null)
            .ExecuteUpdateAsync(u => u.SetProperty(c => c.ConsumedAt, now).SetProperty(c => c.ConsumedBy, method));
        if (consumed == 0) throw new ApiException(401, "invalid_code", "That code was already used. Request a new one.");
        return await identity.CompleteSignIn(user, method);
    }

    public async Task<object> RequestPasswordReset(string rawEmail)
    {
        var email = IdentityService.NormalizeEmail(rawEmail);
        var (user, throttled) = await Target(email, "password_reset");
        if (user != null && !throttled)
        {
            var token = "pr_" + Crypto.RandomToken(32);
            await uow.Run(async () =>
            {
                Supersede(await db.LoginChallenges.Where(c => c.UserId == user.Id && c.Purpose == "password_reset" && c.ConsumedAt == null).ToListAsync());
                db.LoginChallenges.Add(new LoginChallenge { Id = Ids.New("lch"), CreatedAt = uow.Now, UserId = user.Id, Email = email, Purpose = "password_reset", TokenHash = Crypto.Sha256Hex(token), ExpiresAt = uow.Now.Add(ResetLifetime), Ip = uow.Ctx.Ip });
                db.Notifications.Add(new Notification
                {
                    Id = Ids.New("ntf"), CreatedAt = uow.Now, UserId = user.Id, Channel = "email", Recipient = email, Template = "password_reset", Category = "security", Status = "delivered",
                    Subject = "Reset your password",
                    Body = $"Choose a new password here (valid 30 minutes): {PlatformUrls.Web(config)}/login/reset?token={token}\nIf you didn't ask for this, ignore this email.",
                });
            });
        }
        return new { @object = "password_reset_request", sent = true, message = "If an account exists for that address, we've emailed a reset link." };
    }

    public async Task<object> ConfirmPasswordReset(string token, string password)
    {
        IdentityService.ValidatePassword(password);
        var hash = Crypto.Sha256Hex(token ?? "");
        var now = uow.Now;
        var challenge = await db.LoginChallenges.FirstOrDefaultAsync(c => c.TokenHash == hash && c.Purpose == "password_reset" && c.ConsumedAt == null && c.ExpiresAt > now)
                        ?? throw new ApiException(400, "invalid_link", "This reset link is invalid, used or expired. Request a new one.");
        await uow.Run(async () =>
        {
            var consumed = await db.LoginChallenges.Where(c => c.Id == challenge.Id && c.ConsumedAt == null)
                .ExecuteUpdateAsync(u => u.SetProperty(c => c.ConsumedAt, now).SetProperty(c => c.ConsumedBy, "password_reset"));
            if (consumed == 0) throw new ApiException(400, "invalid_link", "This reset link was already used.");
            var user = await db.Users.FirstAsync(u => u.Id == challenge.UserId);
            user.PasswordHash = Crypto.HashPassword(password);
            // Every existing session ends: whoever had the old password is signed out.
            await db.Sessions.Where(s => s.UserId == user.Id && s.RevokedAt == null).ExecuteUpdateAsync(u => u.SetProperty(s => s.RevokedAt, now));
            db.SecurityEvents.Add(new SecurityEvent { Id = Ids.New("sev"), CreatedAt = now, UserId = user.Id, Type = "password_reset", Ip = uow.Ctx.Ip });
            db.Notifications.Add(new Notification
            {
                Id = Ids.New("ntf"), CreatedAt = now, UserId = user.Id, Channel = "email", Recipient = user.Email, Template = "password_changed", Category = "security", Status = "delivered",
                Subject = "Your password was changed", Body = "Your password was just reset and all devices were signed out. If this wasn't you, contact support immediately.",
            });
            uow.Audit("user.password_reset", "user", user.Id);
        });
        return new { @object = "password_reset", reset = true, sessions_revoked = true };
    }
}

// ───────────────────────── Custom roles (§173) ─────────────────────────

public class RoleService(AppDb db, Uow uow)
{
    /// <summary>Owner-only powers never go into a custom role.</summary>
    public static readonly string[] Assignable = Permissions.Merchant.Except(["org.close", "payouts.destination"]).ToArray();

    public static async Task<HashSet<string>> PermissionsFor(AppDb db, string orgId, string role)
    {
        if (Permissions.MerchantRoles.TryGetValue(role, out var builtIn)) return builtIn.ToHashSet();
        if (!role.StartsWith("custom:")) return [];
        var custom = await db.CustomRoles.IgnoreQueryFilters().FirstOrDefaultAsync(r => r.OrgId == orgId && r.Key == role);
        return custom == null ? [] : custom.Permissions.Intersect(Assignable).ToHashSet();
    }

    public static async Task<bool> IsAssignable(AppDb db, string orgId, string role) =>
        role != "owner" && (Permissions.MerchantRoles.ContainsKey(role) || (role.StartsWith("custom:") && await db.CustomRoles.IgnoreQueryFilters().AnyAsync(r => r.OrgId == orgId && r.Key == role)));

    private static string[] Check(IEnumerable<string>? permissions)
    {
        var list = (permissions ?? []).Select(p => p.Trim()).Where(p => p.Length > 0).Distinct().ToArray();
        if (list.Length == 0) throw ApiException.Invalid("Choose at least one permission.");
        var unknown = list.Except(Assignable).ToList();
        if (unknown.Count > 0) throw ApiException.Invalid($"Not assignable in a custom role: {string.Join(", ", unknown)}.");
        return list;
    }

    public async Task<object> List(string orgId)
    {
        var custom = await db.CustomRoles.OrderBy(r => r.Name).ToListAsync();
        var counts = await db.Memberships.Where(m => m.OrgId == orgId && !m.Deprovisioned).GroupBy(m => m.Role).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count);
        return new
        {
            @object = "list",
            data = Permissions.MerchantRoles.Select(kv => (object)new { key = kv.Key, name = char.ToUpperInvariant(kv.Key[0]) + kv.Key[1..].Replace('_', ' '), built_in = true, permissions = kv.Value, members = counts.GetValueOrDefault(kv.Key) })
                .Concat(custom.Select(r => (object)new { key = r.Key, name = r.Name, description = r.Description, built_in = false, permissions = r.Permissions, members = counts.GetValueOrDefault(r.Key), r.Id, updated_at = r.UpdatedAt })),
            assignable_permissions = Assignable,
        };
    }

    public async Task<CustomRole> Create(string orgId, string name, string? description, IEnumerable<string>? permissions)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Length > 60) throw ApiException.Invalid("name is required (max 60 characters).");
        var perms = Check(permissions);
        var slug = Regex.Replace(name.Trim().ToLowerInvariant(), "[^a-z0-9]+", "_").Trim('_');
        if (slug.Length == 0) throw ApiException.Invalid("name must contain letters or digits.");
        var key = "custom:" + slug;
        if (await db.CustomRoles.AnyAsync(r => r.Key == key)) throw ApiException.Conflict("role_exists", "A role with this name already exists.");
        return await uow.Run(async () =>
        {
            var r = new CustomRole { Id = Ids.New("role"), CreatedAt = uow.Now, UpdatedAt = uow.Now, OrgId = orgId, Key = key, Name = name.Trim(), Description = description?.Trim(), PermissionsJson = Json.Serialize(perms) };
            db.CustomRoles.Add(r);
            uow.Audit("role.create", "role", r.Id, after: new { key, perms });
            await Task.CompletedTask;
            return r;
        });
    }

    public async Task<CustomRole> Update(string key, string? name, string? description, IEnumerable<string>? permissions)
    {
        return await uow.Run(async () =>
        {
            var r = await db.CustomRoles.FirstOrDefaultAsync(x => x.Key == key) ?? throw ApiException.NotFound("custom role");
            var before = new { r.Name, permissions = r.Permissions };
            if (name != null) { if (string.IsNullOrWhiteSpace(name) || name.Length > 60) throw ApiException.Invalid("name is required (max 60 characters)."); r.Name = name.Trim(); }
            if (description != null) r.Description = description.Trim();
            if (permissions != null) r.PermissionsJson = Json.Serialize(Check(permissions));
            r.UpdatedAt = uow.Now;
            uow.Audit("role.update", "role", r.Id, before, new { r.Name, permissions = r.Permissions });
            await Task.CompletedTask;
            return r;
        });
    }

    public async Task Delete(string orgId, string key)
    {
        await uow.Run(async () =>
        {
            var r = await db.CustomRoles.FirstOrDefaultAsync(x => x.Key == key) ?? throw ApiException.NotFound("custom role");
            var assigned = await db.Memberships.CountAsync(m => m.OrgId == orgId && m.Role == key && !m.Deprovisioned);
            if (assigned > 0) throw ApiException.Conflict("role_in_use", $"{assigned} member(s) still have this role. Move them to another role first.");
            db.CustomRoles.Remove(r);
            uow.Audit("role.delete", "role", r.Id, before: new { r.Key, permissions = r.Permissions });
        });
    }
}

// ───────────────────────── SCIM 2.0 user provisioning (§173) ─────────────────────────

public class ScimException(int status, string detail, string? scimType = null) : Exception(detail)
{
    public int Status { get; } = status;
    public string? ScimType { get; } = scimType;
}

/// <summary>
/// SCIM 2.0 (RFC 7643/7644) Users for an organization's identity provider. Provisioning adds a member
/// (creating the person's account without a password — they sign in by email code or set one via reset);
/// active=false deprovisions immediately (access ends on the next request) while keeping the record;
/// DELETE removes the membership. Owners can't be changed through SCIM.
/// </summary>
public class ScimService(AppDb db, Uow uow)
{
    public const string UserSchema = "urn:ietf:params:scim:schemas:core:2.0:User";
    public const string ListSchema = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
    public const string PatchSchema = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

    public async Task<ScimToken> CreateToken(string orgId, string defaultRole, string createdBy, Func<string, Task> reveal)
    {
        if (!await RoleService.IsAssignable(db, orgId, defaultRole)) throw ApiException.Invalid("default_role must be an assignable role.");
        var token = "scim_" + Crypto.RandomToken(32);
        var t = await uow.Run(async () =>
        {
            var x = new ScimToken { Id = Ids.New("scimt"), CreatedAt = uow.Now, OrgId = orgId, TokenHash = Crypto.Sha256Hex(token), Last4 = token[^4..], DefaultRole = defaultRole, CreatedBy = createdBy };
            db.ScimTokens.Add(x);
            uow.Audit("scim.token_create", "scim_token", x.Id, after: new { defaultRole });
            await Task.CompletedTask;
            return x;
        });
        await reveal(token);
        return t;
    }

    public static object Resource(Membership m, User u, string baseUrl) => new Dictionary<string, object?>
    {
        ["schemas"] = new[] { UserSchema },
        ["id"] = u.Id,
        ["externalId"] = m.ExternalId,
        ["userName"] = u.Email,
        ["displayName"] = u.Name,
        ["name"] = new { formatted = u.Name },
        ["emails"] = new[] { new { value = u.Email, primary = true, type = "work" } },
        ["active"] = !m.Deprovisioned,
        ["roles"] = new[] { new { value = m.Role, primary = true } },
        ["meta"] = new { resourceType = "User", created = m.CreatedAt, location = $"{baseUrl}/scim/v2/Users/{u.Id}" },
    };

    private async Task<(Membership M, User U)> Find(string orgId, string userId)
    {
        var m = await db.Memberships.FirstOrDefaultAsync(x => x.OrgId == orgId && x.UserId == userId) ?? throw new ScimException(404, "User not found.");
        return (m, await db.Users.FirstAsync(u => u.Id == userId));
    }

    public async Task<object> List(string orgId, string? filter, int startIndex, int count, string baseUrl)
    {
        var members = db.Memberships.Where(m => m.OrgId == orgId);
        if (!string.IsNullOrWhiteSpace(filter))
        {
            var match = Regex.Match(filter, @"^\s*(userName|externalId|emails\.value)\s+eq\s+""([^""]*)""\s*$", RegexOptions.IgnoreCase);
            if (!match.Success) throw new ScimException(400, "Only 'userName eq', 'externalId eq' and 'emails.value eq' filters are supported.", "invalidFilter");
            var value = match.Groups[2].Value;
            if (match.Groups[1].Value.Equals("externalId", StringComparison.OrdinalIgnoreCase)) members = members.Where(m => m.ExternalId == value);
            else
            {
                var email = value.Trim().ToLowerInvariant();
                var ids = await db.Users.Where(u => u.Email == email).Select(u => u.Id).ToListAsync();
                members = members.Where(m => ids.Contains(m.UserId));
            }
        }
        var total = await members.CountAsync();
        var page = await members.OrderBy(m => m.CreatedAt).Skip(Math.Max(0, startIndex - 1)).Take(Math.Clamp(count, 0, 200)).ToListAsync();
        var userIds = page.Select(m => m.UserId).ToList();
        var users = await db.Users.Where(u => userIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id);
        return new Dictionary<string, object>
        {
            ["schemas"] = new[] { ListSchema }, ["totalResults"] = total, ["startIndex"] = Math.Max(1, startIndex), ["itemsPerPage"] = page.Count,
            ["Resources"] = page.Select(m => Resource(m, users[m.UserId], baseUrl)).ToList(),
        };
    }

    public async Task<object> Get(string orgId, string userId, string baseUrl)
    {
        var (m, u) = await Find(orgId, userId);
        return Resource(m, u, baseUrl);
    }

    private static (string? Email, string? Name, string? ExternalId, bool? Active, string? Role) Read(JsonElement body)
    {
        string? S(JsonElement e, string p) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        var email = S(body, "userName");
        if (body.TryGetProperty("emails", out var emails) && emails.ValueKind == JsonValueKind.Array)
            email ??= emails.EnumerateArray().Select(e => S(e, "value")).FirstOrDefault(v => v != null);
        var name = S(body, "displayName");
        if (name == null && body.TryGetProperty("name", out var n))
            name = S(n, "formatted") ?? string.Join(" ", new[] { S(n, "givenName"), S(n, "familyName") }.Where(x => !string.IsNullOrWhiteSpace(x))).NullIfEmpty();
        bool? active = body.TryGetProperty("active", out var a) && a.ValueKind is JsonValueKind.True or JsonValueKind.False ? a.GetBoolean() : null;
        string? role = null;
        if (body.TryGetProperty("roles", out var roles) && roles.ValueKind == JsonValueKind.Array)
            role = roles.EnumerateArray().Select(r => r.ValueKind == JsonValueKind.String ? r.GetString() : S(r, "value")).FirstOrDefault(v => v != null);
        return (email, name, S(body, "externalId"), active, role);
    }

    public async Task<object> Create(ScimToken token, JsonElement body, string baseUrl)
    {
        var (email, name, externalId, active, role) = Read(body);
        if (string.IsNullOrWhiteSpace(email) || !email.Contains('@')) throw new ScimException(400, "userName must be the person's email address.", "invalidValue");
        email = IdentityService.NormalizeEmail(email);
        role ??= token.DefaultRole;
        if (!await RoleService.IsAssignable(db, token.OrgId, role)) throw new ScimException(400, $"Role '{role}' can't be assigned.", "invalidValue");
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);
        if (user != null && await db.Memberships.AnyAsync(m => m.OrgId == token.OrgId && m.UserId == user.Id))
            throw new ScimException(409, "This user is already a member.", "uniqueness");
        return await uow.Run(async () =>
        {
            if (user == null)
            {
                // No usable password: SSO-provisioned people sign in with an email code, or set a password via reset.
                user = new User { Id = Ids.New("usr"), CreatedAt = uow.Now, Email = email, Name = string.IsNullOrWhiteSpace(name) ? email.Split('@')[0] : name.Trim(), PasswordHash = Crypto.HashPassword(Crypto.RandomToken(32)) };
                db.Users.Add(user);
            }
            var m = new Membership { Id = Ids.New("mem"), CreatedAt = uow.Now, OrgId = token.OrgId, UserId = user.Id, Role = role, ExternalId = externalId, Source = "scim", Deprovisioned = active == false };
            db.Memberships.Add(m);
            uow.Audit("scim.provision", "membership", m.Id, after: new { email, role, externalId }, orgId: token.OrgId);
            await Task.CompletedTask;
            return Resource(m, user, baseUrl);
        });
    }

    /// <summary>PUT (full replace) and PATCH share this: only the fields present change.</summary>
    public async Task<object> Apply(string orgId, string userId, string? name, string? externalId, bool? active, string? role, string baseUrl)
    {
        var (m, u) = await Find(orgId, userId);
        if (m.Role == "owner" && (active == false || (role != null && role != "owner"))) throw new ScimException(403, "The organization owner can't be deprovisioned or re-roled through SCIM.");
        if (role != null && role != m.Role && !await RoleService.IsAssignable(db, orgId, role)) throw new ScimException(400, $"Role '{role}' can't be assigned.", "invalidValue");
        return await uow.Run(async () =>
        {
            var before = new { m.Role, m.Deprovisioned, m.ExternalId };
            if (role != null && m.Role != "owner") m.Role = role;
            if (active != null) m.Deprovisioned = !active.Value;
            if (externalId != null) m.ExternalId = externalId;
            // Names belong to the person, who may be in other organizations: only fill a missing one.
            if (!string.IsNullOrWhiteSpace(name) && string.IsNullOrWhiteSpace(u.Name)) u.Name = name.Trim();
            uow.Audit(active == false ? "scim.deprovision" : "scim.update", "membership", m.Id, before, new { m.Role, m.Deprovisioned, m.ExternalId }, orgId: orgId);
            await Task.CompletedTask;
            return Resource(m, u, baseUrl);
        });
    }

    public Task<object> Replace(string orgId, string userId, JsonElement body, string baseUrl)
    {
        var (_, name, externalId, active, role) = Read(body);
        return Apply(orgId, userId, name, externalId, active ?? true, role, baseUrl);
    }

    public Task<object> Patch(string orgId, string userId, JsonElement body, string baseUrl)
    {
        if (!body.TryGetProperty("Operations", out var ops) || ops.ValueKind != JsonValueKind.Array) throw new ScimException(400, "Operations are required.", "invalidSyntax");
        string? name = null, externalId = null, role = null;
        bool? active = null;
        foreach (var op in ops.EnumerateArray())
        {
            var kind = op.TryGetProperty("op", out var o) ? o.GetString()?.ToLowerInvariant() : null;
            if (kind is not ("replace" or "add")) throw new ScimException(400, $"Unsupported op '{kind}'.", "invalidSyntax");
            var path = op.TryGetProperty("path", out var p) ? p.GetString() : null;
            var value = op.TryGetProperty("value", out var v) ? v : default;
            if (path == null && value.ValueKind == JsonValueKind.Object)
            {
                var r = Read(value);
                (name, externalId, active, role) = (r.Name ?? name, r.ExternalId ?? externalId, r.Active ?? active, r.Role ?? role);
                continue;
            }
            switch (path?.ToLowerInvariant())
            {
                case "active": active = value.ValueKind is JsonValueKind.True or JsonValueKind.False ? value.GetBoolean() : bool.TryParse(value.ToString(), out var b) ? b : throw new ScimException(400, "active must be a boolean.", "invalidValue"); break;
                case "displayname": case "name.formatted": name = value.GetString(); break;
                case "externalid": externalId = value.GetString(); break;
                case "roles": role = Read(JsonDocument.Parse($"{{\"roles\":{value.GetRawText()}}}").RootElement).Role; break;
                default: throw new ScimException(400, $"Path '{path}' can't be changed.", "invalidPath");
            }
        }
        return Apply(orgId, userId, name, externalId, active, role, baseUrl);
    }

    public async Task Delete(string orgId, string userId)
    {
        var (m, _) = await Find(orgId, userId);
        if (m.Role == "owner") throw new ScimException(403, "The organization owner can't be removed through SCIM.");
        await uow.Run(async () =>
        {
            db.Memberships.Remove(m);
            uow.Audit("scim.delete", "membership", m.Id, before: new { m.UserId, m.Role }, orgId: orgId);
            await Task.CompletedTask;
        });
    }
}

internal static class StringExtensions
{
    public static string? NullIfEmpty(this string s) => string.IsNullOrWhiteSpace(s) ? null : s;
}
