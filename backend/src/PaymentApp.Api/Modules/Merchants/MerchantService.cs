using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Compliance;
using PaymentApp.Api.Modules.Platform;

namespace PaymentApp.Api.Modules.Merchants;

public class MerchantService(AppDb db, Uow uow, ScreeningService screening, FieldEncryptor encryptor, IConfiguration config)
{
    public static readonly string[] ProhibitedIndustries = ["weapons", "gambling", "adult", "drugs", "crypto_exchange", "multi_level_marketing", "debt_collection"];
    public static readonly string[] RestrictedIndustries = ["pharmacy", "financial_services", "dating", "travel"];

    public async Task<Organization> CreateOrganization(User owner, string name, string country, string currency)
    {
        if (string.IsNullOrWhiteSpace(name)) throw ApiException.Invalid("name is required.");
        currency = Money.Normalize(currency);
        country = country.ToUpperInvariant();
        var cap = await db.Countries.FirstOrDefaultAsync(c => c.Country == country);
        if (cap is { MerchantOnboardingEnabled: false }) throw new ApiException(400, "country_unsupported", "Merchant onboarding is not available in this country yet.");
        var orgId = Ids.New("org");
        using var _ = db.Tenant.Use(orgId, false);
        return await uow.Run(async () =>
        {
            var org = new Organization
            {
                Id = orgId, CreatedAt = uow.Now, Name = name.Trim(), Country = country, DefaultCurrency = currency, SupportEmail = owner.Email,
                InvoicePrefix = new string(name.ToUpperInvariant().Where(char.IsLetter).Take(4).ToArray()).PadRight(3, 'X'),
            };
            db.Organizations.Add(org);
            db.Memberships.Add(new Membership { Id = Ids.New("mem"), CreatedAt = uow.Now, OrgId = org.Id, UserId = owner.Id, Role = "owner" });
            db.MerchantApplications.Add(new MerchantApplication { Id = Ids.New("mapp"), CreatedAt = uow.Now, UpdatedAt = uow.Now, OrgId = org.Id, LegalName = name.Trim(), Country = country, ContactEmail = owner.Email });
            uow.Transition("organization", org.Id, null, org.Status, org.Id);
            uow.Audit("organization.create", "organization", org.Id, after: new { org.Name, org.Country }, orgId: org.Id);
            await Task.CompletedTask;
            return org;
        });
    }

    public async Task<MerchantApplication> UpdateApplication(string orgId, Action<MerchantApplication> apply, IReadOnlyList<BeneficialOwner>? owners)
    {
        return await uow.Run(async () =>
        {
            var app = await db.MerchantApplications.FirstAsync(a => a.OrgId == orgId);
            if (app.Status is "UNDER_REVIEW" or "APPROVED" or "REJECTED") throw ApiException.Conflict("application_locked", $"The application is {app.Status} and can no longer be edited.");
            apply(app);
            app.UpdatedAt = uow.Now;
            if (owners != null)
            {
                db.BeneficialOwners.RemoveRange(await db.BeneficialOwners.Where(b => b.OrgId == orgId).ToListAsync());
                foreach (var o in owners) { o.Id = Ids.New("bo"); o.CreatedAt = uow.Now; o.OrgId = orgId; db.BeneficialOwners.Add(o); }
            }
            uow.Audit("application.update", "merchant_application", app.Id, orgId: orgId);
            return app;
        });
    }

    /// <summary>Automated checks, then manual review (§9, §156). No merchant enters production without approval.</summary>
    public async Task<MerchantApplication> Submit(string orgId)
    {
        var app = await db.MerchantApplications.FirstAsync(a => a.OrgId == orgId);
        if (app.Status is "UNDER_REVIEW" or "APPROVED") return app;
        var owners = await db.BeneficialOwners.Where(b => b.OrgId == orgId).ToListAsync();
        var missing = new List<string>();
        void Need(string? v, string field) { if (string.IsNullOrWhiteSpace(v)) missing.Add(field); }
        Need(app.LegalName, "legal_name"); Need(app.Website, "website"); Need(app.Industry, "industry"); Need(app.Country, "country");
        Need(app.RegisteredAddress, "registered_address"); Need(app.RegistrationNumber, "registration_number"); Need(app.ProductDescription, "product_description");
        Need(app.RefundPolicyUrl, "refund_policy_url"); Need(app.TermsUrl, "terms_url"); Need(app.PrivacyUrl, "privacy_url");
        if (owners.Count == 0) missing.Add("beneficial_owners");
        if (owners.Sum(o => o.OwnershipBps) > 10_000) missing.Add("beneficial_owners (ownership exceeds 100%)");

        var checks = new List<object>();
        var score = 10;
        var screenedClear = true;
        var legal = await screening.Screen("organization", orgId, app.LegalName ?? "", null, app.Country, "kyb");
        checks.Add(new { check = "business_screening", result = legal.Result, legal.Score });
        screenedClear &= legal.Result == "clear";
        foreach (var o in owners)
        {
            var r = await screening.Screen("beneficial_owner", o.Id, o.Name, o.DateOfBirth, o.Nationality, "kyb_owner");
            checks.Add(new { check = "owner_screening", owner = o.Name, result = r.Result, r.Score });
            screenedClear &= r.Result == "clear";
            o.ScreeningStatus = r.Result;
            o.VerificationStatus = r.Result == "clear" ? "verified" : "review";
        }
        var industry = app.Industry?.ToLowerInvariant() ?? "";
        if (ProhibitedIndustries.Contains(industry)) { checks.Add(new { check = "restricted_business", result = "prohibited", industry }); score += 80; }
        else if (RestrictedIndustries.Contains(industry)) { checks.Add(new { check = "restricted_business", result = "restricted", industry }); score += 30; }
        else checks.Add(new { check = "restricted_business", result = "allowed", industry });
        if (!screenedClear) score += 40;
        if (app.ExpectedMonthlyVolumeMinor > 50_000_000) score += 15;

        return await uow.Run(async () =>
        {
            var org = await db.Organizations.FirstAsync(o => o.Id == orgId);
            app.ChecksJson = Json.Serialize(checks);
            app.RiskScore = Math.Min(100, score);
            app.SubmittedAt = uow.Now;
            var to = missing.Count > 0 ? "ACTION_REQUIRED" : ProhibitedIndustries.Contains(industry) ? "REJECTED" : "UNDER_REVIEW";
            app.RequiredActions = missing.Count > 0 ? string.Join(", ", missing) : null;
            if (to == "REJECTED") { app.DecisionReason = "Business category is not supported under the platform's acceptable use policy."; app.DecidedAt = uow.Now; app.DecidedBy = "automated_policy"; }
            uow.Transition("merchant_application", app.Id, app.Status, to, orgId);
            uow.Transition("organization", org.Id, org.Status, to, orgId);
            app.Status = to;
            org.Status = to;
            org.RiskScore = app.RiskScore;
            org.RiskLevel = app.RiskScore >= 60 ? "high" : app.RiskScore >= 30 ? "medium" : "low";
            uow.Emit(to == "ACTION_REQUIRED" ? "compliance.action_required" : "merchant.updated", org, org.Id, false);
            uow.Audit("application.submit", "merchant_application", app.Id, after: new { to, app.RiskScore, missing }, orgId: orgId);
            await Task.CompletedTask;
            return app;
        });
    }

    public async Task<Organization> Decide(string orgId, bool approve, string reason, User admin)
    {
        if (string.IsNullOrWhiteSpace(reason)) throw ApiException.Invalid("A decision reason is required.");
        using var _ = db.Tenant.Use(orgId, false);
        return await uow.Run(async () =>
        {
            var org = await db.Organizations.FirstOrDefaultAsync(o => o.Id == orgId) ?? throw ApiException.NotFound("organization");
            var app = await db.MerchantApplications.FirstAsync(a => a.OrgId == orgId);
            if (app.Status != "UNDER_REVIEW") throw ApiException.Conflict("invalid_state", $"Application is {app.Status}.");
            var hits = await db.BeneficialOwners.AnyAsync(b => b.OrgId == orgId && b.ScreeningStatus != "clear");
            if (approve && hits) throw ApiException.Conflict("screening_unresolved", "Resolve screening matches before approving.");
            var to = approve ? "APPROVED" : "REJECTED";
            uow.Transition("merchant_application", app.Id, app.Status, to, orgId, reason);
            uow.Transition("organization", org.Id, org.Status, to, orgId, reason);
            app.Status = to;
            app.DecidedAt = uow.Now;
            app.DecidedBy = admin.Id;
            app.DecisionReason = reason;
            org.Status = to;
            if (approve && org.GoLiveState == "TEST") org.GoLiveState = "READY";
            uow.Emit("merchant.updated", org, org.Id, false);
            uow.Audit(approve ? "merchant.approve" : "merchant.reject", "organization", org.Id, after: new { to }, reason: reason, orgId: org.Id);
            return org;
        });
    }

    /// <summary>Setup checklist (§222, §223) — the same rules gate production activation (§224).</summary>
    public async Task<object> Checklist(string orgId)
    {
        var org = await db.Organizations.FirstAsync(o => o.Id == orgId);
        var app = await db.MerchantApplications.FirstAsync(a => a.OrgId == orgId);
        bool anyTest<T>(IQueryable<T> q) where T : TenantEntity => q.IgnoreQueryFilters().Any(x => x.OrgId == orgId);
        var items = new List<(string Key, string Label, string State)>
        {
            ("business_verification", "Complete business verification", app.Status == "APPROVED" ? "done" : app.Status is "UNDER_REVIEW" or "SUBMITTED" ? "in_progress" : app.Status == "ACTION_REQUIRED" ? "attention" : "todo"),
            ("payout_account", "Add payout account", await db.PayoutDestinations.AnyAsync(d => d.OrgId == orgId) ? "done" : "todo"),
            ("product", "Create a product", anyTest(db.Products) ? "done" : "todo"),
            ("price", "Create a price", anyTest(db.Prices) ? "done" : "todo"),
            ("checkout", "Create a checkout or payment link", anyTest(db.CheckoutSessions) || anyTest(db.PaymentLinks) ? "done" : "todo"),
            ("webhook", "Configure a webhook endpoint", anyTest(db.WebhookEndpoints) ? "done" : "optional"),
            ("test_payment", "Make a test payment", db.Payments.IgnoreQueryFilters().Any(p => p.OrgId == orgId && !p.Livemode && p.Status == "SUCCEEDED") ? "done" : "todo"),
            ("go_live", "Activate production", org.GoLiveState == "PRODUCTION" ? "done" : "todo"),
        };
        return new
        {
            @object = "setup_checklist", go_live_state = org.GoLiveState, status = org.Status,
            items = items.Select(i => new { key = i.Key, label = i.Label, state = i.State }),
            can_go_live = items.Where(i => i.Key != "go_live" && i.Key != "webhook").All(i => i.State == "done"),
        };
    }

    public async Task<Organization> GoLive(string orgId)
    {
        dynamic list = await Checklist(orgId);
        if (!(bool)list.can_go_live) throw new ApiException(400, "setup_incomplete", "Finish the setup checklist before activating production.");
        return await uow.Run(async () =>
        {
            var org = await db.Organizations.FirstAsync(o => o.Id == orgId);
            uow.Transition("go_live", org.Id, org.GoLiveState, "PRODUCTION", orgId);
            org.GoLiveState = "PRODUCTION";
            uow.Audit("organization.go_live", "organization", org.Id, orgId: orgId);
            await Task.CompletedTask;
            return org;
        });
    }

    public async Task<(ApiKey Key, string Secret)> CreateApiKey(string orgId, bool livemode, string type, string name, string[]? permissions, string? allowedIps)
    {
        if (type is not ("secret" or "restricted" or "publishable")) throw ApiException.Invalid("type must be secret, restricted or publishable.");
        if (type == "restricted")
        {
            if (permissions == null || permissions.Length == 0) throw ApiException.Invalid("Restricted keys need at least one permission.");
            var unknown = permissions.Except(Permissions.Merchant).ToList();
            if (unknown.Count > 0) throw ApiException.Invalid($"Unknown permissions: {string.Join(", ", unknown)}");
        }
        var prefix = type switch { "secret" => "sk", "restricted" => "rk", _ => "pk" } + (livemode ? "_live_" : "_test_");
        var secret = prefix + Crypto.RandomToken(24);
        var key = await uow.Run(async () =>
        {
            var k = new ApiKey
            {
                Id = Ids.New("key"), CreatedAt = uow.Now, OrgId = orgId, Livemode = livemode, Type = type, Name = name, DisplayKey = $"{prefix}…{secret[^4..]}",
                KeyHash = Crypto.Sha256Hex(secret), PublishableValue = type == "publishable" ? secret : null,
                PermissionsJson = type == "restricted" ? Json.Serialize(permissions) : null, AllowedIpsCsv = allowedIps, CreatedBy = uow.Ctx.ActorId,
            };
            db.ApiKeys.Add(k);
            db.SecurityEvents.Add(new SecurityEvent { Id = Ids.New("sev"), CreatedAt = uow.Now, UserId = uow.Ctx.User?.Id, OrgId = orgId, Type = "api_key_created", Ip = uow.Ctx.Ip, Detail = k.DisplayKey });
            uow.Audit("api_key.create", "api_key", k.Id, after: new { type, livemode, name }, orgId: orgId);
            await Task.CompletedTask;
            return k;
        });
        return (key, secret);
    }

    public async Task<(WebhookEndpoint Endpoint, string Secret)> CreateWebhook(string url, string events, string? description, bool livemode)
    {
        await UrlGuard.Ensure(url, livemode);
        var secret = "whsec_" + Crypto.RandomToken(24);
        var ep = await uow.Run(async () =>
        {
            var e = new WebhookEndpoint { Id = Ids.New("we"), CreatedAt = uow.Now, Url = url, EnabledEventsCsv = string.IsNullOrWhiteSpace(events) ? "*" : events, Description = description, SecretEnc = encryptor.Encrypt(secret) };
            db.WebhookEndpoints.Add(e);
            uow.Audit("webhook.create", "webhook_endpoint", e.Id, after: new { url, events });
            await Task.CompletedTask;
            return e;
        });
        return (ep, secret);
    }

    /// <summary>Rotation keeps the old secret valid for a grace period, signing with both (§160).</summary>
    public async Task<string> RotateWebhookSecret(string endpointId, int graceHours)
    {
        var secret = "whsec_" + Crypto.RandomToken(24);
        await uow.Run(async () =>
        {
            var e = await db.WebhookEndpoints.FirstOrDefaultAsync(x => x.Id == endpointId) ?? throw ApiException.NotFound("webhook endpoint");
            e.PreviousSecretEnc = graceHours > 0 ? e.SecretEnc : null;
            e.PreviousSecretExpiresAt = graceHours > 0 ? uow.Now.AddHours(Math.Min(graceHours, 72)) : null;
            e.SecretEnc = encryptor.Encrypt(secret);
            uow.Audit("webhook.rotate_secret", "webhook_endpoint", e.Id, after: new { graceHours });
        });
        return secret;
    }

    public async Task<PayoutDestination> AddPayoutDestination(string orgId, string country, string currency, string holder, string bankName, string accountNumber, string? routing, string? swift)
    {
        accountNumber = new string(accountNumber.Where(char.IsLetterOrDigit).ToArray()).ToUpperInvariant();
        if (accountNumber.Length is < 6 or > 34) throw ApiException.Invalid("account_number looks invalid.");
        currency = Money.Normalize(currency);
        return await uow.Run(async () =>
        {
            foreach (var d in await db.PayoutDestinations.Where(d => d.Currency == currency && d.IsDefault).ToListAsync()) d.IsDefault = false;
            var dest = new PayoutDestination
            {
                Id = Ids.New("pd"), CreatedAt = uow.Now, BankCountry = country.ToUpperInvariant(), Currency = currency, AccountHolder = holder, BankName = bankName,
                AccountNumberEnc = encryptor.Encrypt(accountNumber), Last4 = accountNumber[^4..], RoutingNumber = routing, Swift = swift, IsDefault = true,
            };
            db.PayoutDestinations.Add(dest);
            db.SecurityEvents.Add(new SecurityEvent { Id = Ids.New("sev"), CreatedAt = uow.Now, UserId = uow.Ctx.User?.Id, OrgId = orgId, Type = "payout_account_changed", Ip = uow.Ctx.Ip, Detail = $"****{dest.Last4}" });
            uow.Audit("payout_destination.add", "payout_destination", dest.Id, after: new { dest.BankCountry, dest.Currency, dest.Last4 }, orgId: orgId);
            await Task.CompletedTask;
            return dest;
        });
    }

    /// <summary>Account closure (§158): stop new business, keep records, revoke access.</summary>
    public async Task<object> Close(string orgId, string reason)
    {
        var openDisputes = await db.Disputes.IgnoreQueryFilters().CountAsync(d => d.OrgId == orgId && (d.Status == "needs_response" || d.Status == "under_review"));
        var pendingPayouts = await db.Payouts.IgnoreQueryFilters().CountAsync(p => p.OrgId == orgId && (p.Status == "PENDING" || p.Status == "PROCESSING" || p.Status == "ON_HOLD"));
        return await uow.Run(async () =>
        {
            var org = await db.Organizations.FirstAsync(o => o.Id == orgId);
            uow.Transition("organization", org.Id, org.Status, "CLOSED", orgId, reason);
            org.Status = "CLOSED";
            org.ClosedAt = uow.Now;
            foreach (var k in await db.ApiKeys.Where(k => k.OrgId == orgId && k.RevokedAt == null).ToListAsync()) k.RevokedAt = uow.Now;
            var subs = await db.Subscriptions.IgnoreQueryFilters().Where(s => s.OrgId == orgId && (s.Status == "ACTIVE" || s.Status == "TRIALING" || s.Status == "PAST_DUE")).ToListAsync();
            foreach (var s in subs) s.CancelAtPeriodEnd = true;
            uow.Audit("organization.close", "organization", org.Id, reason: reason, orgId: orgId);
            await Task.CompletedTask;
            return (object)new
            {
                @object = "account_closure", status = "CLOSED", subscriptions_set_to_end = subs.Count, open_disputes = openDisputes, pending_payouts = pendingPayouts,
                records = "Financial and tax records are retained per legal retention rules; personal data follows the privacy policy.",
            };
        });
    }
}
