using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Marketplace;
using PaymentApp.Api.Modules.Operations;

namespace PaymentApp.Api.Endpoints;

public record SellerRequest(string Name, string Email, string Country, string Currency, int? CommissionBps);
public record SellerPayoutAccountRequest(string BankName, string Currency, string AccountNumber);
public record SellerPayoutRequest(string Currency);
public record PeriodRequest(string Period);
public record ImportRequest(string Type, string Format, string Content, bool DryRun = true);
public record MergeRequest(string Into);
public record TicketRequest(string Subject, string Category, string Body, string? RelatedObjectId, string? Priority);
public record TicketMessageRequest(string Body, bool Internal = false);
public record TicketUpdateRequest(string? Status, string? AssignedTo, string? Priority);
public record IncidentRequest(string Title, string Severity, string AffectedServices, string CustomerImpact, string Message);
public record IncidentUpdateRequest(string Status, string Message);
public record FlagRequest(string? Description, bool? Enabled, int? RolloutPercent, string? OrgIds, string? Countries, string? Environment);
public record DomainRequest(string Hostname, string Purpose);
public record SellerDecisionRequest(bool Approve, string Reason);

/// <summary>Marketplace, month-end close, imports, support, incidents, feature flags and custom domains.</summary>
public static class OperationsEndpoints
{
    public static void Map(WebApplication app)
    {
        // ───────── Marketplace sellers (§101) ─────────
        var sel = app.MapGroup("/v1/sellers").WithTags("Marketplace");
        sel.MapGet("/", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("customers.read");
            var q = db.Sellers.AsQueryable();
            if (req.Query["status"].FirstOrDefault() is { Length: > 0 } s) q = q.Where(x => x.Status == s);
            return new { @object = "list", data = await q.OrderByDescending(x => x.CreatedAt).Take(200).ToListAsync() };
        });
        sel.MapPost("/", async (SellerRequest r, RequestContext ctx, MarketplaceService market, FlagService flags) =>
        {
            var orgId = ctx.RequireOrg("customers.write");
            await flags.Require("marketplace", orgId);
            return Results.Json(await market.Onboard(orgId, r.Name, r.Email, r.Country, r.Currency, r.CommissionBps ?? 1000), statusCode: 201);
        });
        sel.MapGet("/{id}", async (string id, RequestContext ctx, AppDb db, MarketplaceService market) =>
        {
            ctx.RequireOrg("customers.read");
            var s = await db.Sellers.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("seller");
            return new
            {
                seller = s, balance = await market.Balance(id, ctx.Livemode),
                balance_transactions = await db.SellerBalanceTransactions.Where(t => t.SellerId == id).OrderByDescending(t => t.CreatedAt).Take(100).ToListAsync(),
                payouts = await db.SellerPayouts.Where(p => p.SellerId == id).OrderByDescending(p => p.CreatedAt).ToListAsync(),
                payments = await db.Payments.Where(p => p.SellerId == id).OrderByDescending(p => p.CreatedAt).Take(50)
                    .Select(p => new { p.Id, p.Amount, p.TaxAmount, p.FeeAmount, p.ApplicationFeeAmount, p.SellerAmount, p.Currency, p.Status, p.CreatedAt }).ToListAsync(),
            };
        });
        sel.MapPost("/{id}/payout_account", async (string id, SellerPayoutAccountRequest r, RequestContext ctx, MarketplaceService market, IClock clock) =>
        {
            ctx.RequireOrg("payouts.destination");
            ctx.RequireStepUp(clock);
            return await market.SetPayoutAccount(id, r.BankName, r.Currency, r.AccountNumber);
        });
        sel.MapPost("/{id}/payouts", async (string id, SellerPayoutRequest r, RequestContext ctx, MarketplaceService market) =>
        {
            ctx.RequireOrg("payouts.manage");
            return Results.Json(await market.CreatePayout(id, ctx.Livemode, Money.Normalize(r.Currency)), statusCode: 201);
        }).RequireRateLimiting("financial");
        app.MapPost("/v1/admin/sellers/{id}/decision", async (string id, SellerDecisionRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireAdmin("admin.merchants.decide");
            if (string.IsNullOrWhiteSpace(r.Reason)) throw ApiException.Invalid("A reason is required.");
            using var _ = db.Tenant.Elevate();
            return await uow.Run(async () =>
            {
                var s = await db.Sellers.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("seller");
                var before = s.Status;
                s.Status = r.Approve ? "active" : "rejected";
                s.DecisionReason = r.Reason;
                uow.Transition("seller", s.Id, before, s.Status, s.OrgId, r.Reason);
                uow.Audit(r.Approve ? "seller.approve" : "seller.reject", "seller", s.Id, reason: r.Reason, orgId: s.OrgId);
                await Task.CompletedTask;
                return s;
            });
        }).WithTags("Admin");
        app.MapGet("/v1/admin/sellers", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.merchants.read");
            using var _ = db.Tenant.Elevate();
            var q = db.Sellers.AsQueryable();
            if (req.Query["status"].FirstOrDefault() is { Length: > 0 } s) q = q.Where(x => x.Status == s);
            return new { @object = "list", data = await q.OrderByDescending(x => x.CreatedAt).Take(200).ToListAsync() };
        }).WithTags("Admin");

        // ───────── Month-end close (§230, §231) ─────────
        var per = app.MapGroup("/v1/accounting_periods").WithTags("Finance");
        per.MapGet("/", async (RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("ledger.read");
            return new { @object = "list", data = await db.AccountingPeriods.OrderByDescending(p => p.Period).ToListAsync() };
        });
        per.MapGet("/preview", async (HttpRequest req, RequestContext ctx, PeriodCloseService close) =>
            await close.Preview(ctx.RequireOrg("ledger.read"), ctx.Livemode, req.Query["period"].ToString()));
        per.MapPost("/", async (PeriodRequest r, RequestContext ctx, PeriodCloseService close, IClock clock) =>
        {
            var orgId = ctx.RequireOrg("payouts.manage");
            ctx.RequireStepUp(clock);
            return Results.Json(await close.Close(orgId, ctx.Livemode, r.Period), statusCode: 201);
        });
        per.MapGet("/{id}/verify", async (string id, RequestContext ctx, PeriodCloseService close) => { ctx.RequireOrg("ledger.read"); return await close.Verify(id); });

        // ───────── Imports and merge (§186-§189) ─────────
        var imp = app.MapGroup("/v1/imports").WithTags("Imports");
        imp.MapPost("/", async (ImportRequest r, RequestContext ctx, ImportService imports) =>
        {
            ctx.RequireOrg(r.Type == "products" ? "products.write" : "customers.write");
            return Results.Json(await imports.Run(r.Type, r.Format, r.Content, r.DryRun), statusCode: 201);
        });
        imp.MapGet("/", async (HttpRequest req, RequestContext ctx, AppDb db) => { ctx.RequireOrg("customers.read"); return await Paging.List(db.Imports, req); });
        imp.MapGet("/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("customers.read");
            return await db.Imports.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("import");
        });
        app.MapPost("/v1/customers/{id}/merge", async (string id, MergeRequest r, RequestContext ctx, ImportService imports) =>
        {
            ctx.RequireOrg("customers.write");
            return await imports.Merge(id, r.Into);
        }).WithTags("Catalog & Customers");
        app.MapGet("/v1/customers/duplicates", async (RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("customers.read");
            var rows = await db.Customers.Where(c => c.MergedIntoId == null && c.AnonymizedAt == null).Select(c => new { c.Id, c.Email, c.Name, c.Phone, c.CreatedAt }).ToListAsync();
            var groups = rows.Where(c => c.Email != null).GroupBy(c => c.Email!.Trim().ToLowerInvariant()).Where(g => g.Count() > 1).Select(g => new { match = "email", value = g.Key, customers = g.OrderBy(c => c.CreatedAt) })
                .Concat(rows.Where(c => !string.IsNullOrEmpty(c.Phone)).GroupBy(c => new string(c.Phone!.Where(char.IsDigit).ToArray())).Where(g => g.Key.Length >= 7 && g.Count() > 1).Select(g => new { match = "phone", value = g.Key, customers = g.OrderBy(c => c.CreatedAt) }));
            return new { @object = "duplicate_candidates", data = groups, note = "Candidates only — review before merging." };
        }).WithTags("Catalog & Customers");

        // ───────── Support (§110, §207) ─────────
        var sup = app.MapGroup("/v1/support/tickets").WithTags("Support");
        sup.MapPost("/", async (TicketRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            var (orgId, user) = ctx.RequireMember();
            if (string.IsNullOrWhiteSpace(r.Subject) || string.IsNullOrWhiteSpace(r.Body)) throw ApiException.Invalid("Subject and message are required.");
            var categories = new[] { "bug", "payment_issue", "tax_issue", "checkout_issue", "feature_request", "account", "other" };
            if (!categories.Contains(r.Category)) throw ApiException.Invalid("Unknown category.");
            return Results.Json(await uow.Run(async () =>
            {
                var t = new SupportTicket { Id = Ids.New("tkt"), CreatedAt = uow.Now, UpdatedAt = uow.Now, OrgId = orgId, CreatedByUserId = user.Id, Subject = r.Subject.Trim(), Category = r.Category, RelatedObjectId = r.RelatedObjectId, Priority = r.Priority is "high" or "urgent" ? r.Priority : "normal" };
                db.SupportTickets.Add(t);
                db.TicketMessages.Add(new TicketMessage { Id = Ids.New("tmsg"), CreatedAt = uow.Now, TicketId = t.Id, AuthorId = user.Id, AuthorType = "merchant", Body = r.Body.Trim() });
                await Task.CompletedTask;
                return t;
            }), statusCode: 201);
        });
        sup.MapGet("/", async (RequestContext ctx, AppDb db) =>
        {
            var (orgId, _) = ctx.RequireMember();
            return new { @object = "list", data = await db.SupportTickets.Where(t => t.OrgId == orgId).OrderByDescending(t => t.UpdatedAt).Take(100).ToListAsync() };
        });
        sup.MapGet("/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            var (orgId, _) = ctx.RequireMember();
            var t = await db.SupportTickets.FirstOrDefaultAsync(x => x.Id == id && x.OrgId == orgId) ?? throw ApiException.NotFound("ticket");
            // Internal staff notes never reach the merchant.
            return new { ticket = t, messages = await db.TicketMessages.Where(m => m.TicketId == id && !m.Internal).OrderBy(m => m.CreatedAt).ToListAsync() };
        });
        sup.MapPost("/{id}/messages", async (string id, TicketMessageRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            var (orgId, user) = ctx.RequireMember();
            return await uow.Run(async () =>
            {
                var t = await db.SupportTickets.FirstOrDefaultAsync(x => x.Id == id && x.OrgId == orgId) ?? throw ApiException.NotFound("ticket");
                if (t.Status == "closed") throw ApiException.Conflict("ticket_closed", "This ticket is closed. Open a new one.");
                var m = new TicketMessage { Id = Ids.New("tmsg"), CreatedAt = uow.Now, TicketId = id, AuthorId = user.Id, AuthorType = "merchant", Body = r.Body.Trim() };
                db.TicketMessages.Add(m);
                t.Status = "open";
                t.UpdatedAt = uow.Now;
                await Task.CompletedTask;
                return m;
            });
        });
        sup.MapPost("/{id}/close", async (string id, RequestContext ctx, AppDb db) =>
        {
            var (orgId, _) = ctx.RequireMember();
            var t = await db.SupportTickets.FirstOrDefaultAsync(x => x.Id == id && x.OrgId == orgId) ?? throw ApiException.NotFound("ticket");
            t.Status = "closed";
            t.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return t;
        });
        var adminSup = app.MapGroup("/v1/admin/support/tickets").WithTags("Admin");
        adminSup.MapGet("/", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.support");
            var q = db.SupportTickets.AsQueryable();
            if (req.Query["status"].FirstOrDefault() is { Length: > 0 } s) q = q.Where(t => t.Status == s);
            var tickets = await q.OrderByDescending(t => t.UpdatedAt).Take(200).ToListAsync();
            var orgs = await db.Organizations.Where(o => tickets.Select(t => t.OrgId).Contains(o.Id)).ToDictionaryAsync(o => o.Id, o => o.Name);
            return new { @object = "list", data = tickets.Select(t => new { ticket = t, organization = orgs.GetValueOrDefault(t.OrgId) }) };
        });
        adminSup.MapGet("/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.support");
            var t = await db.SupportTickets.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("ticket");
            var org = await db.Organizations.FirstAsync(o => o.Id == t.OrgId);
            // Controlled account context for the agent (§110): status and recent failures, not full data.
            var recentFailures = await db.Payments.IgnoreQueryFilters().Where(p => p.OrgId == t.OrgId && p.Status == "FAILED").OrderByDescending(p => p.CreatedAt).Take(5)
                .Select(p => new { p.Id, p.FailureCode, p.CreatedAt }).ToListAsync();
            return new
            {
                ticket = t, messages = await db.TicketMessages.Where(m => m.TicketId == id).OrderBy(m => m.CreatedAt).ToListAsync(),
                account = new { org.Id, org.Name, org.Status, org.GoLiveState, org.Restriction, org.Country, recent_failed_payments = recentFailures },
            };
        });
        adminSup.MapPost("/{id}/messages", async (string id, TicketMessageRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            var staff = ctx.RequireAdmin("admin.support");
            return await uow.Run(async () =>
            {
                var t = await db.SupportTickets.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("ticket");
                var m = new TicketMessage { Id = Ids.New("tmsg"), CreatedAt = uow.Now, TicketId = id, AuthorId = staff.Id, AuthorType = "staff", Body = r.Body.Trim(), Internal = r.Internal };
                db.TicketMessages.Add(m);
                if (!r.Internal)
                {
                    t.Status = "awaiting_merchant";
                    db.Notifications.Add(new Notification { Id = Ids.New("ntf"), CreatedAt = uow.Now, OrgId = t.OrgId, Channel = "in_app", Recipient = $"org:{t.OrgId}", Template = "support_reply", Subject = $"Support replied: {t.Subject}", Body = r.Body.Length > 200 ? r.Body[..200] + "…" : r.Body, Category = "account", Status = "delivered", ObjectType = "support_ticket", ObjectId = t.Id });
                }
                t.AssignedTo ??= staff.Id;
                t.UpdatedAt = uow.Now;
                uow.Audit("support.reply", "support_ticket", t.Id, after: new { r.Internal }, orgId: t.OrgId);
                await Task.CompletedTask;
                return m;
            });
        });
        adminSup.MapPatch("/{id}", async (string id, TicketUpdateRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireAdmin("admin.support");
            return await uow.Run(async () =>
            {
                var t = await db.SupportTickets.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("ticket");
                if (r.Status is not (null or "open" or "awaiting_merchant" or "resolved" or "closed")) throw ApiException.Invalid("Unknown status.");
                t.Status = r.Status ?? t.Status; t.AssignedTo = r.AssignedTo ?? t.AssignedTo; t.Priority = r.Priority ?? t.Priority;
                t.UpdatedAt = uow.Now;
                uow.Audit("support.update", "support_ticket", t.Id, after: new { t.Status, t.AssignedTo, t.Priority }, orgId: t.OrgId);
                await Task.CompletedTask;
                return t;
            });
        });

        // ───────── Incidents and status (§111) ─────────
        app.MapGet("/v1/public/status", async (AppDb db) =>
        {
            var active = await db.Incidents.Where(i => i.Status != "resolved").OrderByDescending(i => i.StartedAt).ToListAsync();
            var providers = await db.Providers.Where(p => p.Enabled && !p.Livemode).Select(p => new { p.Name, p.HealthState }).ToListAsync();
            return new
            {
                @object = "status", overall = active.Any(i => i.Severity == "critical") ? "major_outage" : active.Count > 0 ? "degraded" : "operational",
                incidents = active.Select(i => new { i.Id, i.Title, i.Severity, i.Status, affected = i.AffectedServicesCsv.Split(',', StringSplitOptions.RemoveEmptyEntries), i.CustomerImpact, i.StartedAt }),
                payment_providers = providers,
            };
        }).WithTags("Public checkout");
        app.MapGet("/v1/incidents", async (RequestContext ctx, AppDb db) =>
        {
            ctx.RequireUser();
            var since = DateTime.UtcNow.AddDays(-14);
            var incidents = await db.Incidents.Where(i => i.Status != "resolved" || i.ResolvedAt >= since).OrderByDescending(i => i.StartedAt).Take(20).ToListAsync();
            var ids = incidents.Select(i => i.Id).ToList();
            var updates = await db.IncidentUpdates.Where(u => ids.Contains(u.IncidentId)).OrderBy(u => u.CreatedAt).ToListAsync();
            return new { @object = "list", data = incidents.Select(i => new { incident = i, updates = updates.Where(u => u.IncidentId == i.Id).Select(u => new { u.Status, u.Message, u.CreatedAt }) }) };
        }).WithTags("Me");
        app.MapPost("/v1/admin/incidents", async (IncidentRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            var staff = ctx.RequireAdmin("admin.incidents");
            if (r.Severity is not ("minor" or "major" or "critical")) throw ApiException.Invalid("severity must be minor, major or critical.");
            return Results.Json(await uow.Run(async () =>
            {
                var i = new Incident { Id = Ids.New("inc"), CreatedAt = uow.Now, Title = r.Title, Severity = r.Severity, AffectedServicesCsv = r.AffectedServices, CustomerImpact = r.CustomerImpact, StartedAt = uow.Now, CreatedBy = staff.Id };
                db.Incidents.Add(i);
                db.IncidentUpdates.Add(new IncidentUpdate { Id = Ids.New("incu"), CreatedAt = uow.Now, IncidentId = i.Id, Status = "investigating", Message = r.Message, AuthorId = staff.Id });
                uow.Audit("incident.open", "incident", i.Id, after: new { r.Title, r.Severity });
                await Task.CompletedTask;
                return i;
            }), statusCode: 201);
        }).WithTags("Admin");
        app.MapPost("/v1/admin/incidents/{id}/updates", async (string id, IncidentUpdateRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            var staff = ctx.RequireAdmin("admin.incidents");
            if (r.Status is not ("investigating" or "identified" or "monitoring" or "resolved")) throw ApiException.Invalid("Unknown status.");
            return await uow.Run(async () =>
            {
                var i = await db.Incidents.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("incident");
                i.Status = r.Status;
                if (r.Status == "resolved") i.ResolvedAt = uow.Now;
                db.IncidentUpdates.Add(new IncidentUpdate { Id = Ids.New("incu"), CreatedAt = uow.Now, IncidentId = id, Status = r.Status, Message = r.Message, AuthorId = staff.Id });
                uow.Audit("incident.update", "incident", id, after: new { r.Status });
                await Task.CompletedTask;
                return i;
            });
        }).WithTags("Admin");
        app.MapGet("/v1/admin/incidents", async (RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.overview");
            return new { @object = "list", data = await db.Incidents.OrderByDescending(i => i.StartedAt).Take(100).ToListAsync() };
        }).WithTags("Admin");

        // ───────── Feature flags (§119) ─────────
        app.MapGet("/v1/features", async (RequestContext ctx, AppDb db, IWebHostEnvironment env) =>
        {
            ctx.RequireUser();
            var flags = await db.FeatureFlags.ToListAsync();
            var country = ctx.OrgId == null ? null : await db.Organizations.Where(o => o.Id == ctx.OrgId).Select(o => o.Country).FirstOrDefaultAsync();
            return new { @object = "features", features = flags.ToDictionary(f => f.Key, f => FlagService.Evaluate(f, ctx.OrgId, country, env.EnvironmentName)) };
        }).WithTags("Me");
        app.MapGet("/v1/admin/feature_flags", async (RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.overview");
            return new { @object = "list", data = await db.FeatureFlags.OrderBy(f => f.Key).ToListAsync() };
        }).WithTags("Admin");
        app.MapPut("/v1/admin/feature_flags/{key}", async (string key, FlagRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireAdmin("admin.config.manage");
            if (!System.Text.RegularExpressions.Regex.IsMatch(key, "^[a-z][a-z0-9_]{1,63}$")) throw ApiException.Invalid("key must be lowercase snake_case.");
            if (r.RolloutPercent is < 0 or > 100) throw ApiException.Invalid("rollout_percent must be 0-100.");
            return await uow.Run(async () =>
            {
                var f = await db.FeatureFlags.FirstOrDefaultAsync(x => x.Key == key);
                var before = f == null ? null : new { f.Enabled, f.RolloutPercent, f.OrgIdsCsv, f.CountriesCsv, f.Environment };
                if (f == null) { f = new FeatureFlag { Id = Ids.New("flag"), CreatedAt = uow.Now, Key = key }; db.FeatureFlags.Add(f); }
                f.Description = r.Description ?? f.Description; f.Enabled = r.Enabled ?? f.Enabled; f.RolloutPercent = r.RolloutPercent ?? f.RolloutPercent;
                f.OrgIdsCsv = r.OrgIds ?? f.OrgIdsCsv; f.CountriesCsv = r.Countries?.ToUpperInvariant() ?? f.CountriesCsv; f.Environment = r.Environment ?? f.Environment;
                f.UpdatedAt = uow.Now;
                uow.Audit("config.feature_flag", "feature_flag", f.Id, before, new { f.Enabled, f.RolloutPercent, f.OrgIdsCsv, f.CountriesCsv, f.Environment });
                await Task.CompletedTask;
                return f;
            });
        }).WithTags("Admin");

        // ───────── Custom domains (§176, §177) ─────────
        var dom = app.MapGroup("/v1/domains").WithTags("Domains");
        dom.MapGet("/", async (RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("org.manage");
            var list = await db.Domains.Where(d => d.Status != "REVOKED").OrderByDescending(d => d.CreatedAt).ToListAsync();
            return new { @object = "list", data = list.Select(d => new { domain = d, dns = Instructions(d) }) };
        });
        dom.MapPost("/", async (DomainRequest r, RequestContext ctx, DomainService domains, FlagService flags) =>
        {
            var orgId = ctx.RequireOrg("org.manage");
            await flags.Require("custom_domains", orgId);
            var d = await domains.Add(r.Hostname, r.Purpose);
            return Results.Json(new { domain = d, dns = Instructions(d) }, statusCode: 201);
        });
        dom.MapPost("/{id}/verify", async (string id, RequestContext ctx, DomainService domains) =>
        {
            ctx.RequireOrg("org.manage");
            var d = await domains.Verify(id);
            return new { domain = d, dns = Instructions(d) };
        });
        dom.MapDelete("/{id}", async (string id, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("org.manage");
            await uow.Run(async () =>
            {
                var d = await db.Domains.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("domain");
                uow.Transition("domain", d.Id, d.Status, "REVOKED");
                d.Status = "REVOKED";
                uow.Audit("domain.revoke", "domain", d.Id);
            });
            return Results.NoContent();
        });
    }

    private static object Instructions(CustomDomain d) => new[]
    {
        new { type = "TXT", name = DomainService.ChallengeName(d.Hostname), value = d.VerificationToken, purpose = "Proves you control the domain" },
        new { type = "CNAME", name = d.Hostname, value = "checkout.paymentapp.example", purpose = "Routes buyers to the hosted pages (serving on custom domains needs the edge/TLS setup in production)" },
    };
}
