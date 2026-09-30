using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Identity;
using PaymentApp.Api.Modules.Merchants;
using PaymentApp.Api.Modules.Platform;

namespace PaymentApp.Api.Endpoints;

public record SignUpRequest(string Email, string Password, string Name, string? Country, string? Phone, string? OrganizationName, string? Currency);
public record LoginRequest(string Email, string Password, string? Code);
public record CodeRequest(string Code);
public record StepUpRequest(string Password, string? Code);
public record ProfileRequest(string? Name, string? Phone, string? Country);
public record KycRequest(string FullName, string DateOfBirth, string Country, string Address, string DocumentType, int Level = 1);
public record OrgRequest(string Name, string Country, string? Currency);
public record OrgSettingsRequest(string? Name, string? SupportEmail, string? Website, string? BrandColor, string? LogoUrl, string? PayoutSchedule,
    string? DunningRetryDaysCsv, string? DunningFinalAction, int? DunningGraceDays, string? InvoicePrefix);
public record MemberRequest(string Email, string Role);
public record ApplicationRequest(string? LegalName, string? TradingName, string? Website, string? BusinessType, string? Industry, string? Country,
    string? RegisteredAddress, string? OperatingAddress, string? RegistrationNumber, string? TaxNumber, string? ContactPhone, string? ProductDescription,
    string? CustomerType, long? AverageOrderMinor, long? ExpectedMonthlyVolumeMinor, string? CountriesServedCsv, string? RefundPolicyUrl, string? TermsUrl,
    string? PrivacyUrl, List<OwnerRequest>? BeneficialOwners);
public record OwnerRequest(string Name, string? DateOfBirth, string? Nationality, string? Country, int OwnershipBps, string Relationship);
public record ApiKeyRequest(string Name, string Type, string[]? Permissions, string? AllowedIps);
public record WebhookRequest(string Url, string? EnabledEvents, string? Description);
public record RotateRequest(int GraceHours = 24);
public record DestinationRequest(string Country, string Currency, string AccountHolder, string BankName, string AccountNumber, string? RoutingNumber, string? Swift);
public record CloseRequest(string Reason);
public record TemplateRequest(string Key, string Subject, string Body);

public static class AccountEndpoints
{
    public static void Map(WebApplication app)
    {
        var auth = app.MapGroup("/v1/auth").WithTags("Authentication");
        auth.MapPost("/signup", async (SignUpRequest r, IdentityService ids, MerchantService merchants, RequestContext ctx) =>
        {
            var (user, token, _) = await ids.SignUp(r.Email, r.Password, r.Name, r.Country, r.Phone);
            Organization? org = null;
            if (!string.IsNullOrWhiteSpace(r.OrganizationName))
            {
                ctx.User = user;
                org = await merchants.CreateOrganization(user, r.OrganizationName, r.Country ?? "US", r.Currency ?? "USD");
            }
            return Results.Json(new { @object = "session", token, user, organization = org }, statusCode: 201);
        });
        auth.MapPost("/login", async (LoginRequest r, IdentityService ids) => await ids.Login(r.Email, r.Password, r.Code));
        auth.MapPost("/mfa/verify", async (CodeRequest r, IdentityService ids, RequestContext ctx) =>
            await ids.CompleteMfa(ctx.Session ?? throw ApiException.Unauthorized(), r.Code));
        auth.MapPost("/logout", async (RequestContext ctx, AppDb db, IClock clock) =>
        {
            if (ctx.Session != null) { ctx.Session.RevokedAt = clock.UtcNow; await db.SaveChangesAsync(); }
            return Results.NoContent();
        });
        auth.MapPost("/step-up", async (StepUpRequest r, IdentityService ids, RequestContext ctx) =>
            await ids.StepUp(ctx.Session ?? throw ApiException.Unauthorized(), ctx.RequireUser(), r.Password, r.Code));
        auth.MapPost("/mfa/enroll", async (IdentityService ids, RequestContext ctx) => await ids.BeginMfaEnrollment(ctx.RequireUser()));
        auth.MapPost("/mfa/confirm", async (CodeRequest r, IdentityService ids, RequestContext ctx) => await ids.ConfirmMfa(ctx.RequireUser(), r.Code));

        var me = app.MapGroup("/v1/me").WithTags("Me");
        me.MapGet("/", async (RequestContext ctx, AppDb db) =>
        {
            var user = ctx.RequireUser();
            var memberships = await db.Memberships.Where(m => m.UserId == user.Id).ToListAsync();
            var orgIds = memberships.Select(m => m.OrgId).ToList();
            var orgs = await db.Organizations.Where(o => orgIds.Contains(o.Id)).ToListAsync();
            var wallet = await db.Wallets.FirstOrDefaultAsync(w => w.OwnerType == "user" && w.OwnerId == user.Id);
            return new
            {
                user,
                organizations = orgs.Select(o => new { o.Id, o.Name, o.Status, o.GoLiveState, o.Country, o.DefaultCurrency, role = memberships.First(m => m.OrgId == o.Id).Role }),
                wallet = wallet == null ? null : new { wallet.Id, wallet.Handle, wallet.Status },
                admin_permissions = ctx.AdminPermissions,
            };
        });
        me.MapPatch("/", async (ProfileRequest r, RequestContext ctx, Uow uow) =>
        {
            var user = ctx.RequireUser();
            return await uow.Run(async () =>
            {
                if (r.Name != null && user.KycStatus != "VERIFIED") user.Name = r.Name;
                if (r.Phone != null) user.Phone = r.Phone;
                if (r.Country != null && user.KycStatus != "VERIFIED") user.Country = r.Country.ToUpperInvariant();
                uow.Audit("user.update", "user", user.Id);
                await Task.CompletedTask;
                return user;
            });
        });
        me.MapPost("/kyc", async (KycRequest r, IdentityService ids, RequestContext ctx) =>
            await ids.SubmitKyc(ctx.RequireUser(), r.FullName, r.DateOfBirth, r.Country, r.Address, r.DocumentType, r.Level));
        me.MapGet("/sessions", async (RequestContext ctx, AppDb db, IClock clock) =>
        {
            var user = ctx.RequireUser();
            var now = clock.UtcNow;
            var sessions = await db.Sessions.Where(s => s.UserId == user.Id && s.RevokedAt == null && s.ExpiresAt > now).OrderByDescending(s => s.LastSeenAt).ToListAsync();
            return new { @object = "list", data = sessions.Select(s => new { s.Id, s.CreatedAt, s.LastSeenAt, s.Ip, s.UserAgent, current = s.Id == ctx.Session?.Id }) };
        });
        me.MapDelete("/sessions/{id}", async (string id, RequestContext ctx, AppDb db, IClock clock) =>
        {
            var user = ctx.RequireUser();
            var s = await db.Sessions.FirstOrDefaultAsync(x => x.Id == id && x.UserId == user.Id) ?? throw ApiException.NotFound("session");
            s.RevokedAt = clock.UtcNow;
            db.SecurityEvents.Add(new SecurityEvent { Id = Ids.New("sev"), CreatedAt = clock.UtcNow, UserId = user.Id, Type = "session_revoked", Ip = ctx.Ip });
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
        me.MapGet("/security_events", async (RequestContext ctx, AppDb db) =>
        {
            var user = ctx.RequireUser();
            return new { @object = "list", data = await db.SecurityEvents.Where(e => e.UserId == user.Id).OrderByDescending(e => e.CreatedAt).Take(50).ToListAsync() };
        });
        me.MapGet("/devices", async (RequestContext ctx, AppDb db) =>
            new { @object = "list", data = await db.Devices.Where(d => d.UserId == ctx.RequireUser().Id).OrderByDescending(d => d.LastSeenAt).ToListAsync() });
        me.MapGet("/notifications", async (RequestContext ctx, AppDb db) =>
        {
            var user = ctx.RequireUser();
            var orgIds = await db.Memberships.Where(m => m.UserId == user.Id).Select(m => m.OrgId).ToListAsync();
            var q = db.Notifications.Where(n => n.UserId == user.Id || (n.OrgId != null && orgIds.Contains(n.OrgId) && n.Channel != "email"));
            if (ctx.OrgId != null) q = q.Where(n => n.UserId == user.Id || n.OrgId == ctx.OrgId);
            return new { @object = "list", data = await q.OrderByDescending(n => n.CreatedAt).Take(50).ToListAsync() };
        });

        var org = app.MapGroup("/v1").WithTags("Organization");
        org.MapPost("/organizations", async (OrgRequest r, MerchantService merchants, RequestContext ctx) =>
            Results.Json(await merchants.CreateOrganization(ctx.RequireUser(), r.Name, r.Country, r.Currency ?? "USD"), statusCode: 201));
        org.MapGet("/organization", async (RequestContext ctx, AppDb db) =>
        {
            var orgId = ctx.RequireOrg("team.read");
            return await db.Organizations.FirstAsync(o => o.Id == orgId);
        });
        org.MapPatch("/organization", async (OrgSettingsRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            var orgId = ctx.RequireOrg("org.manage");
            return await uow.Run(async () =>
            {
                var o = await db.Organizations.FirstAsync(x => x.Id == orgId);
                var before = new { o.Name, o.PayoutSchedule, o.DunningRetryDaysCsv, o.DunningFinalAction };
                if (r.Name != null) o.Name = r.Name;
                if (r.SupportEmail != null) o.SupportEmail = r.SupportEmail;
                if (r.Website != null) o.Website = r.Website;
                if (r.BrandColor != null) o.BrandColor = r.BrandColor;
                if (r.LogoUrl != null) o.LogoUrl = r.LogoUrl;
                if (r.InvoicePrefix != null) o.InvoicePrefix = r.InvoicePrefix.ToUpperInvariant();
                if (r.PayoutSchedule != null)
                {
                    if (r.PayoutSchedule is not ("daily" or "weekly" or "monthly" or "manual")) throw ApiException.Invalid("payout_schedule must be daily, weekly, monthly or manual.");
                    o.PayoutSchedule = r.PayoutSchedule;
                }
                if (r.DunningRetryDaysCsv != null)
                {
                    var parts = r.DunningRetryDaysCsv.Split(',');
                    if (parts.Length is < 1 or > 8 || parts.Any(p => !int.TryParse(p, out var d) || d is < 1 or > 30)) throw ApiException.Invalid("dunning_retry_days_csv must be 1-8 comma-separated day counts (1-30).");
                    o.DunningRetryDaysCsv = r.DunningRetryDaysCsv;
                }
                if (r.DunningFinalAction != null)
                {
                    if (r.DunningFinalAction is not ("cancel" or "leave_past_due")) throw ApiException.Invalid("dunning_final_action must be cancel or leave_past_due.");
                    o.DunningFinalAction = r.DunningFinalAction;
                }
                if (r.DunningGraceDays != null) o.DunningGraceDays = Math.Clamp(r.DunningGraceDays.Value, 0, 30);
                uow.Audit("organization.update", "organization", o.Id, before, new { o.Name, o.PayoutSchedule, o.DunningRetryDaysCsv, o.DunningFinalAction });
                await Task.CompletedTask;
                return o;
            });
        });
        org.MapGet("/organization/checklist", async (RequestContext ctx, MerchantService merchants) => await merchants.Checklist(ctx.RequireOrg("team.read")));
        org.MapPost("/organization/go_live", async (RequestContext ctx, MerchantService merchants, IClock clock) =>
        {
            var orgId = ctx.RequireOrg("org.manage");
            ctx.RequireStepUp(clock);
            return await merchants.GoLive(orgId);
        });
        org.MapPost("/organization/close", async (CloseRequest r, RequestContext ctx, MerchantService merchants, IClock clock) =>
        {
            var orgId = ctx.RequireOrg("org.close");
            ctx.RequireStepUp(clock);
            return await merchants.Close(orgId, r.Reason);
        });

        org.MapGet("/organization/application", async (RequestContext ctx, AppDb db) =>
        {
            var orgId = ctx.RequireOrg("compliance.read");
            return new { application = await db.MerchantApplications.FirstAsync(a => a.OrgId == orgId), beneficial_owners = await db.BeneficialOwners.Where(b => b.OrgId == orgId).ToListAsync() };
        });
        org.MapPatch("/organization/application", async (ApplicationRequest r, RequestContext ctx, MerchantService merchants) =>
        {
            var orgId = ctx.RequireOrg("compliance.write");
            var owners = r.BeneficialOwners?.Select(o => new BeneficialOwner { Name = o.Name, DateOfBirth = o.DateOfBirth, Nationality = o.Nationality, Country = o.Country, OwnershipBps = o.OwnershipBps, Relationship = o.Relationship }).ToList();
            return await merchants.UpdateApplication(orgId, a =>
            {
                a.LegalName = r.LegalName ?? a.LegalName; a.TradingName = r.TradingName ?? a.TradingName; a.Website = r.Website ?? a.Website;
                a.BusinessType = r.BusinessType ?? a.BusinessType; a.Industry = r.Industry ?? a.Industry; a.Country = r.Country ?? a.Country;
                a.RegisteredAddress = r.RegisteredAddress ?? a.RegisteredAddress; a.OperatingAddress = r.OperatingAddress ?? a.OperatingAddress;
                a.RegistrationNumber = r.RegistrationNumber ?? a.RegistrationNumber; a.TaxNumber = r.TaxNumber ?? a.TaxNumber; a.ContactPhone = r.ContactPhone ?? a.ContactPhone;
                a.ProductDescription = r.ProductDescription ?? a.ProductDescription; a.CustomerType = r.CustomerType ?? a.CustomerType;
                a.AverageOrderMinor = r.AverageOrderMinor ?? a.AverageOrderMinor; a.ExpectedMonthlyVolumeMinor = r.ExpectedMonthlyVolumeMinor ?? a.ExpectedMonthlyVolumeMinor;
                a.CountriesServedCsv = r.CountriesServedCsv ?? a.CountriesServedCsv; a.RefundPolicyUrl = r.RefundPolicyUrl ?? a.RefundPolicyUrl;
                a.TermsUrl = r.TermsUrl ?? a.TermsUrl; a.PrivacyUrl = r.PrivacyUrl ?? a.PrivacyUrl;
                if (a.Status == "APPLICATION_STARTED" || a.Status == "ACTION_REQUIRED") a.Status = a.Status;
            }, owners);
        });
        org.MapPost("/organization/application/submit", async (RequestContext ctx, MerchantService merchants) => await merchants.Submit(ctx.RequireOrg("compliance.write")));

        org.MapGet("/team", async (RequestContext ctx, AppDb db) =>
        {
            var orgId = ctx.RequireOrg("team.read");
            var members = await db.Memberships.Where(m => m.OrgId == orgId).ToListAsync();
            var ids = members.Select(m => m.UserId).ToList();
            var users = await db.Users.Where(u => ids.Contains(u.Id)).ToDictionaryAsync(u => u.Id);
            return new { @object = "list", data = members.Select(m => new { m.Id, m.Role, m.CreatedAt, user = new { users[m.UserId].Id, users[m.UserId].Name, users[m.UserId].Email, users[m.UserId].MfaEnabled } }), roles = Permissions.MerchantRoles };
        });
        org.MapPost("/team", async (MemberRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            var orgId = ctx.RequireOrg("team.manage");
            if (!Permissions.MerchantRoles.ContainsKey(r.Role) || r.Role == "owner") throw ApiException.Invalid("Unknown or non-assignable role.");
            var user = await db.Users.FirstOrDefaultAsync(u => u.Email == r.Email.Trim().ToLowerInvariant()) ?? throw new ApiException(404, "user_not_found", "Ask them to create an account first, then add them.");
            if (await db.Memberships.AnyAsync(m => m.OrgId == orgId && m.UserId == user.Id)) throw ApiException.Conflict("already_member", "Already a member.");
            return await uow.Run(async () =>
            {
                var m = new Membership { Id = Ids.New("mem"), CreatedAt = uow.Now, OrgId = orgId, UserId = user.Id, Role = r.Role };
                db.Memberships.Add(m);
                uow.Audit("team.add", "membership", m.Id, after: new { user.Email, r.Role });
                await Task.CompletedTask;
                return m;
            });
        });
        org.MapPatch("/team/{id}", async (string id, MemberRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            var orgId = ctx.RequireOrg("team.manage");
            if (!Permissions.MerchantRoles.ContainsKey(r.Role) || r.Role == "owner") throw ApiException.Invalid("Unknown or non-assignable role.");
            return await uow.Run(async () =>
            {
                var m = await db.Memberships.FirstOrDefaultAsync(x => x.Id == id && x.OrgId == orgId) ?? throw ApiException.NotFound("member");
                if (m.Role == "owner") throw ApiException.Forbidden("Ownership changes require the ownership-transfer process.");
                var before = m.Role;
                m.Role = r.Role;
                uow.Audit("team.role_change", "membership", m.Id, new { role = before }, new { role = r.Role });
                await Task.CompletedTask;
                return m;
            });
        });
        org.MapDelete("/team/{id}", async (string id, RequestContext ctx, AppDb db, Uow uow) =>
        {
            var orgId = ctx.RequireOrg("team.manage");
            await uow.Run(async () =>
            {
                var m = await db.Memberships.FirstOrDefaultAsync(x => x.Id == id && x.OrgId == orgId) ?? throw ApiException.NotFound("member");
                if (m.Role == "owner") throw ApiException.Forbidden("The owner cannot be removed.");
                db.Memberships.Remove(m);
                uow.Audit("team.remove", "membership", m.Id);
            });
            return Results.NoContent();
        });

        org.MapGet("/payout_destinations", async (RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("payouts.read");
            return new { @object = "list", data = await db.PayoutDestinations.OrderByDescending(d => d.CreatedAt).ToListAsync() };
        });
        org.MapPost("/payout_destinations", async (DestinationRequest r, RequestContext ctx, MerchantService merchants, IClock clock) =>
        {
            var orgId = ctx.RequireOrg("payouts.destination");
            ctx.RequireStepUp(clock); // payout bank changes need recent re-authentication (§201)
            return await merchants.AddPayoutDestination(orgId, r.Country, r.Currency, r.AccountHolder, r.BankName, r.AccountNumber, r.RoutingNumber, r.Swift);
        });

        org.MapGet("/email_templates", async (RequestContext ctx, AppDb db) =>
        {
            var orgId = ctx.RequireOrg("org.manage");
            return new { @object = "list", data = await db.EmailTemplates.Where(t => t.OrgId == orgId).OrderByDescending(t => t.CreatedAt).ToListAsync() };
        });
        org.MapPost("/email_templates", async (TemplateRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            var orgId = ctx.RequireOrg("org.manage");
            return await uow.Run(async () =>
            {
                var previous = await db.EmailTemplates.Where(t => t.OrgId == orgId && t.Key == r.Key).ToListAsync();
                foreach (var p in previous) p.Active = false;
                var t = new EmailTemplate { Id = Ids.New("etpl"), CreatedAt = uow.Now, OrgId = orgId, Key = r.Key, Subject = r.Subject, Body = r.Body, Version = previous.Count + 1 };
                db.EmailTemplates.Add(t);
                uow.Audit("email_template.version", "email_template", t.Id, after: new { r.Key, t.Version });
                return t;
            });
        });

        // ───────── Developers (§59) ─────────
        var dev = app.MapGroup("/v1").WithTags("Developers");
        dev.MapGet("/api_keys", async (RequestContext ctx, AppDb db) =>
        {
            var orgId = ctx.RequireOrg("developers.read");
            return new { @object = "list", data = await db.ApiKeys.Where(k => k.OrgId == orgId).OrderByDescending(k => k.CreatedAt).ToListAsync() };
        });
        dev.MapPost("/api_keys", async (ApiKeyRequest r, RequestContext ctx, MerchantService merchants, IClock clock) =>
        {
            var orgId = ctx.RequireOrg("developers.write");
            if (ctx.Livemode) ctx.RequireStepUp(clock);
            var (key, secret) = await merchants.CreateApiKey(orgId, ctx.Livemode, r.Type, r.Name, r.Permissions, r.AllowedIps);
            return Results.Json(new { api_key = key, secret, note = "Copy the secret now; it is not shown again." }, statusCode: 201);
        });
        dev.MapDelete("/api_keys/{id}", async (string id, RequestContext ctx, AppDb db, Uow uow) =>
        {
            var orgId = ctx.RequireOrg("developers.write");
            await uow.Run(async () =>
            {
                var k = await db.ApiKeys.FirstOrDefaultAsync(x => x.Id == id && x.OrgId == orgId) ?? throw ApiException.NotFound("api key");
                k.RevokedAt = uow.Now;
                db.SecurityEvents.Add(new SecurityEvent { Id = Ids.New("sev"), CreatedAt = uow.Now, UserId = ctx.User?.Id, OrgId = orgId, Type = "api_key_deleted", Ip = ctx.Ip, Detail = k.DisplayKey });
                uow.Audit("api_key.revoke", "api_key", k.Id);
            });
            return Results.NoContent();
        });
        dev.MapGet("/webhook_endpoints", async (RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("developers.read");
            return new { @object = "list", data = await db.WebhookEndpoints.OrderByDescending(w => w.CreatedAt).ToListAsync() };
        });
        dev.MapPost("/webhook_endpoints", async (WebhookRequest r, RequestContext ctx, MerchantService merchants) =>
        {
            ctx.RequireOrg("developers.write");
            var (ep, secret) = await merchants.CreateWebhook(r.Url, r.EnabledEvents ?? "*", r.Description, ctx.Livemode);
            return Results.Json(new { webhook_endpoint = ep, secret }, statusCode: 201);
        });
        dev.MapPatch("/webhook_endpoints/{id}", async (string id, WebhookRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("developers.write");
            await UrlGuard.Ensure(r.Url, ctx.Livemode);
            return await uow.Run(async () =>
            {
                var e = await db.WebhookEndpoints.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("webhook endpoint");
                e.Url = r.Url;
                e.EnabledEventsCsv = r.EnabledEvents ?? e.EnabledEventsCsv;
                e.Description = r.Description ?? e.Description;
                if (e.Status == "failing") e.Status = "enabled";
                uow.Audit("webhook.update", "webhook_endpoint", e.Id);
                return e;
            });
        });
        dev.MapDelete("/webhook_endpoints/{id}", async (string id, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("developers.write");
            await uow.Run(async () =>
            {
                var e = await db.WebhookEndpoints.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("webhook endpoint");
                e.Status = "disabled";
                uow.Audit("webhook.disable", "webhook_endpoint", e.Id);
            });
            return Results.NoContent();
        });
        dev.MapPost("/webhook_endpoints/{id}/rotate_secret", async (string id, RotateRequest r, RequestContext ctx, MerchantService merchants) =>
        {
            ctx.RequireOrg("developers.write");
            return new { secret = await merchants.RotateWebhookSecret(id, r.GraceHours), previous_secret_valid_hours = r.GraceHours };
        });
        dev.MapPost("/webhook_endpoints/{id}/test", async (string id, RequestContext ctx, AppDb db, Uow uow, WebhookSender sender) =>
        {
            ctx.RequireOrg("developers.write");
            var ep = await db.WebhookEndpoints.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("webhook endpoint");
            var org = await db.Organizations.FirstAsync(o => o.Id == ep.OrgId);
            var delivery = await uow.Run(async () =>
            {
                var e = new Event { Id = Ids.New("evt"), CreatedAt = uow.Now, OrgId = ep.OrgId, Livemode = ep.Livemode, Type = "test.ping", ObjectType = "organization", ObjectId = org.Id, DataJson = Json.Serialize(new { message = "Test event from the dashboard", organization = org.Id }) };
                db.Events.Add(e);
                var d = new WebhookDelivery { Id = Ids.New("whd"), CreatedAt = uow.Now, EventId = e.Id, EndpointId = ep.Id, Status = "pending", NextAttemptAt = uow.Now, IsReplay = true };
                db.WebhookDeliveries.Add(d);
                await Task.CompletedTask;
                return d;
            });
            await sender.Deliver(delivery);
            return delivery;
        });
        dev.MapGet("/webhook_deliveries", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("developers.read");
            var q = db.WebhookDeliveries.AsQueryable();
            if (req.Query["event"].FirstOrDefault() is { } ev) q = q.Where(d => d.EventId == ev);
            if (req.Query["endpoint"].FirstOrDefault() is { } ep) q = q.Where(d => d.EndpointId == ep);
            if (req.Query["status"].FirstOrDefault() is { } st) q = q.Where(d => d.Status == st);
            return await Paging.List(q, req);
        });
        dev.MapGet("/events", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            var orgId = ctx.RequireOrg("developers.read");
            var q = db.Events.Where(e => e.OrgId == orgId && e.Livemode == ctx.Livemode);
            if (req.Query["type"].FirstOrDefault() is { } t) q = t.EndsWith('*') ? q.Where(e => e.Type.StartsWith(t.TrimEnd('*'))) : q.Where(e => e.Type == t);
            if (req.Query["object_id"].FirstOrDefault() is { } o) q = q.Where(e => e.ObjectId == o);
            return await Paging.List(q, req);
        });
        dev.MapGet("/events/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            var orgId = ctx.RequireOrg("developers.read");
            var e = await db.Events.FirstOrDefaultAsync(x => x.Id == id && x.OrgId == orgId && x.Livemode == ctx.Livemode) ?? throw ApiException.NotFound("event");
            return new { @event = e, deliveries = await db.WebhookDeliveries.Where(d => d.EventId == id).OrderBy(d => d.CreatedAt).ToListAsync() };
        });
        dev.MapPost("/events/{id}/replay", async (string id, HttpRequest req, RequestContext ctx, AppDb db, Uow uow, WebhookSender sender) =>
        {
            var orgId = ctx.RequireOrg("developers.write");
            var e = await db.Events.FirstOrDefaultAsync(x => x.Id == id && x.OrgId == orgId && x.Livemode == ctx.Livemode) ?? throw ApiException.NotFound("event");
            var endpointId = req.Query["endpoint"].FirstOrDefault();
            var endpoints = await db.WebhookEndpoints.Where(w => w.Status != "disabled" && (endpointId == null || w.Id == endpointId)).ToListAsync();
            var deliveries = await uow.Run(async () =>
            {
                // Replays keep the original event id but get a fresh delivery id (§132).
                var list = endpoints.Select(ep => new WebhookDelivery { Id = Ids.New("whd"), CreatedAt = uow.Now, EventId = e.Id, EndpointId = ep.Id, Status = "pending", NextAttemptAt = uow.Now, IsReplay = true }).ToList();
                db.WebhookDeliveries.AddRange(list);
                uow.Audit("event.replay", "event", e.Id);
                await Task.CompletedTask;
                return list;
            });
            foreach (var d in deliveries) await sender.Deliver(d);
            return new { @object = "list", data = deliveries };
        });
        dev.MapGet("/logs", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            var orgId = ctx.RequireOrg("developers.read");
            var q = db.ApiRequestLogs.Where(l => l.OrgId == orgId && l.Livemode == ctx.Livemode);
            if (int.TryParse(req.Query["status"], out var st)) q = q.Where(l => l.Status == st);
            return new { @object = "list", data = await q.OrderByDescending(l => l.Id).Take(Math.Clamp(int.TryParse(req.Query["limit"], out var n) ? n : 50, 1, 200)).ToListAsync() };
        });
    }
}
