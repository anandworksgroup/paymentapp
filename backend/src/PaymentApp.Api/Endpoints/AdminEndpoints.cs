using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Compliance;
using PaymentApp.Api.Modules.Ledger;
using PaymentApp.Api.Modules.Merchants;
using PaymentApp.Api.Modules.Payments;
using PaymentApp.Api.Modules.Payouts;

namespace PaymentApp.Api.Endpoints;

public record DecisionRequest(bool Approve, string Reason);
public record CaseRequest(string SubjectType, string SubjectId, string Title, string? Priority, List<string>? Alerts, string? Type);
public record NoteRequest(string Kind, string Body, bool Finalize);
public record EvidenceRefRequest(string RefType, string RefId, string Description);
public record CaseDecisionRequest(string Decision, string Reason);
public record ApprovalCreateRequest(string Action, string TargetType, string TargetId, Dictionary<string, object>? Payload, string Reason, string? CaseId);
public record ApprovalDecisionRequest(bool Approve, string? Note);
public record AlertConclusionRequest(string Conclusion, string Note);
public record AssignRequest(string? AssignedTo);
public record ProviderUpdateRequest(bool? Enabled, int? Priority, bool? ForceOutage, int? FeeBps);
public record FeeRequest(string? OrgId, string? Country, string? Method, int PercentBps, long FixedMinor, string FixedCurrency, long? MinimumMinor, long? MaximumMinor, int InternationalBps);
public record TaxRuleRequest(string Country, string? TaxCategory, string? CustomerType, string TaxType, int RateBps, bool ReverseChargeB2B, string Label, DateTime? EffectiveFrom);
public record RuleUpdateRequest(bool? Enabled, string? Severity, string? Action, Dictionary<string, long>? Params);
public record CountryRequest(bool? CheckoutEnabled, bool? WalletEnabled, bool? PayoutsEnabled, bool? MerchantOnboardingEnabled, string? PaymentMethodsCsv, int? WalletKycLevelRequired);
public record ScreeningEntryRequest(string Name, string? Aliases, string EntryType, string? DateOfBirth, string? Country, string? Program);
public record ReconResolveRequest(string Resolution);
public record KycDecisionRequest(bool Approve, int Level, string Reason);

public static class AdminEndpoints
{
    public static void Map(WebApplication app)
    {
        var a = app.MapGroup("/v1/admin").WithTags("Admin");
        // Every admin endpoint reads across tenants, explicitly and only here.
        a.AddEndpointFilter(async (ic, next) =>
        {
            var db = ic.HttpContext.RequestServices.GetRequiredService<AppDb>();
            using (db.Tenant.Elevate()) return await next(ic);
        });

        a.MapGet("/overview", async (RequestContext ctx, AppDb db, IClock clock) =>
        {
            ctx.RequireAdmin("admin.overview");
            var day = clock.UtcNow.AddDays(-1);
            var payments = await db.Payments.Where(p => p.CreatedAt >= day).ToListAsync();
            var transfers = await db.Transfers.Where(t => t.CreatedAt >= day).ToListAsync();
            return new
            {
                active_users = await db.Users.CountAsync(u => u.LastActivityAt >= clock.UtcNow.AddDays(-30)),
                active_merchants = await db.Organizations.CountAsync(o => o.Status == "APPROVED"),
                daily_transactions = payments.Count + transfers.Count,
                daily_payment_volume_usd = payments.Where(p => p.AmountCaptured > 0).Sum(p => FxTable.ToUsd(p.Amount, p.Currency)),
                daily_wallet_volume_usd = transfers.Where(t => t.Status == "COMPLETED").Sum(t => FxTable.ToUsd(t.SourceAmount, t.SourceCurrency)),
                cross_border_volume_usd = transfers.Where(t => t.SenderCountry != null && t.RecipientCountry != null && t.SenderCountry != t.RecipientCountry).Sum(t => FxTable.ToUsd(t.SourceAmount, t.SourceCurrency)),
                failed_transactions = payments.Count(p => p.Status == "FAILED") + transfers.Count(t => t.Status == "FAILED"),
                payment_success_rate = payments.Count == 0 ? 100 : Math.Round(payments.Count(p => p.AmountCaptured > 0) * 100.0 / payments.Count, 1),
                aml_alerts_open = await db.Alerts.CountAsync(x => x.Type == "aml" && (x.Status == "NEW" || x.Status == "IN_REVIEW" || x.Status == "QUEUED")),
                sanctions_alerts_open = await db.Alerts.CountAsync(x => (x.Type == "sanctions" || x.Type == "pep") && (x.Status == "NEW" || x.Status == "IN_REVIEW")),
                open_cases = await db.Cases.CountAsync(c => c.Status != "CLOSED"),
                high_priority_cases = await db.Cases.CountAsync(c => c.Status != "CLOSED" && (c.Priority == "HIGH" || c.Priority == "CRITICAL")),
                pending_kyc = await db.Users.CountAsync(u => u.KycStatus == "REVIEW"),
                pending_kyb = await db.Organizations.CountAsync(o => o.Status == "UNDER_REVIEW"),
                transfers_on_hold = await db.Transfers.CountAsync(t => t.Status == "HELD"),
                payouts_on_hold = await db.Payouts.CountAsync(p => p.Status == "ON_HOLD"),
                pending_approvals = await db.Approvals.CountAsync(x => x.Status == "pending"),
                recon_exceptions_open = await db.ReconExceptions.CountAsync(e => e.Status == "open"),
                providers = await db.Providers.Select(p => new { p.Id, p.Name, p.HealthState, p.Enabled, p.Livemode }).ToListAsync(),
                webhook_backlog = await db.WebhookDeliveries.CountAsync(d => d.Status == "pending" || d.Status == "retrying"),
                outbox_backlog = await db.Outbox.CountAsync(o => o.ProcessedAt == null),
            };
        });

        a.MapGet("/search", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.users.read");
            var q = req.Query["q"].ToString().Trim();
            if (q.Length < 3) throw ApiException.Invalid("Search needs at least 3 characters.");
            var lower = q.ToLowerInvariant();
            var unmask = ctx.AdminPermissions.Contains("admin.pii.unmask");
            return new
            {
                users = (await db.Users.Where(u => u.Id == q || u.Email.Contains(lower) || u.Name.ToLower().Contains(lower) || u.Phone == q).Take(10).ToListAsync())
                    .Select(u => new { u.Id, u.Name, email = unmask ? u.Email : Mask.Email(u.Email), u.Status, u.KycLevel }),
                merchants = await db.Organizations.Where(o => o.Id == q || o.Name.ToLower().Contains(lower)).Take(10).Select(o => new { o.Id, o.Name, o.Status }).ToListAsync(),
                payments = await db.Payments.Where(p => p.Id == q || p.ProviderTransactionId == q || p.CustomerEmail == lower).Take(10).Select(p => new { p.Id, p.OrgId, p.Amount, p.Currency, p.Status }).ToListAsync(),
                transfers = await db.Transfers.Where(t => t.Id == q).Take(5).ToListAsync(),
                wallets = await db.Wallets.Where(w => w.Id == q || w.Handle == lower).Take(5).ToListAsync(),
                cases = await db.Cases.Where(c => c.Id == q).Take(5).ToListAsync(),
                devices = await db.Devices.Where(d => d.Id == q).Take(5).ToListAsync(),
                ip_sessions = await db.Sessions.Where(s => s.Ip == q).Select(s => new { s.UserId, s.CreatedAt }).Take(20).ToListAsync(),
                invoices = await db.Invoices.Where(i => i.Id == q || i.Number == q).Take(5).Select(i => new { i.Id, i.OrgId, i.Number, i.Status }).ToListAsync(),
                subscriptions = await db.Subscriptions.Where(s => s.Id == q).Take(5).Select(s => new { s.Id, s.OrgId, s.Status }).ToListAsync(),
            };
        });

        // ───────── Merchants ─────────
        a.MapGet("/merchants", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.merchants.read");
            var q = db.Organizations.AsQueryable();
            if (req.Query["status"].FirstOrDefault() is { } s) q = q.Where(o => o.Status == s);
            return await Paging.List(q, req);
        });
        a.MapGet("/merchants/{id}", async (string id, RequestContext ctx, AppDb db, TreasuryService treasury) =>
        {
            ctx.RequireAdmin("admin.merchants.read");
            var org = await db.Organizations.FirstOrDefaultAsync(o => o.Id == id) ?? throw ApiException.NotFound("organization");
            await LogAccess(db, ctx, "organization", id, "profile");
            var payments = db.Payments.Where(p => p.OrgId == id);
            return new
            {
                organization = org,
                application = await db.MerchantApplications.FirstOrDefaultAsync(x => x.OrgId == id),
                beneficial_owners = await db.BeneficialOwners.Where(b => b.OrgId == id).ToListAsync(),
                members = await db.Memberships.Where(m => m.OrgId == id).Join(db.Users, m => m.UserId, u => u.Id, (m, u) => new { m.Role, u.Id, u.Name, email = Mask.Email(u.Email) }).ToListAsync(),
                balance_test = await treasury.Balance(id, false),
                balance_live = await treasury.Balance(id, true),
                volume = new
                {
                    payments = await payments.CountAsync(), succeeded = await payments.CountAsync(p => p.AmountCaptured > 0),
                    refunds = await db.Refunds.CountAsync(r => r.OrgId == id), disputes = await db.Disputes.CountAsync(d => d.OrgId == id),
                },
                payouts = await db.Payouts.Where(p => p.OrgId == id).OrderByDescending(p => p.CreatedAt).Take(20).ToListAsync(),
                cases = await db.Cases.Where(c => c.SubjectType == "org" && c.SubjectId == id).ToListAsync(),
                audit = await db.AuditLogs.Where(x => x.OrgId == id).OrderByDescending(x => x.Seq).Take(50).ToListAsync(),
            };
        });
        a.MapPost("/merchants/{id}/decision", async (string id, DecisionRequest r, RequestContext ctx, MerchantService merchants) =>
            await merchants.Decide(id, r.Approve, r.Reason, ctx.RequireAdmin("admin.merchants.decide")));

        // ───────── Users (§75-§78) ─────────
        a.MapGet("/users", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.users.read");
            var q = db.Users.AsQueryable();
            if (req.Query["status"].FirstOrDefault() is { } s) q = q.Where(u => u.Status == s);
            if (req.Query["kyc_status"].FirstOrDefault() is { } k) q = q.Where(u => u.KycStatus == k);
            var page = await Paging.List(q, req);
            return page;
        });
        a.MapGet("/users/{id}", async (string id, HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.users.read");
            var u = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("user");
            var unmask = ctx.AdminPermissions.Contains("admin.pii.unmask") && req.Query["unmask"] == "true";
            await LogAccess(db, ctx, "user", id, unmask ? "full_profile_unmasked" : "profile");
            var wallet = await db.Wallets.FirstOrDefaultAsync(w => w.OwnerType == "user" && w.OwnerId == id);
            var transfers = wallet == null ? [] : await db.Transfers.Where(t => t.SenderWalletId == wallet.Id || t.RecipientWalletId == wallet.Id).OrderByDescending(t => t.CreatedAt).Take(200).ToListAsync();
            var incoming = transfers.Where(t => t.RecipientWalletId == wallet?.Id && t.Status == "COMPLETED").ToList();
            var outgoing = transfers.Where(t => t.SenderWalletId == wallet?.Id && t.Status is "COMPLETED" or "PROCESSING").ToList();
            return new
            {
                identity = new
                {
                    u.Id, u.Name, email = unmask ? u.Email : Mask.Email(u.Email), phone = unmask ? u.Phone : Mask.Tail(u.Phone), u.Country, u.Nationality,
                    date_of_birth = unmask ? u.DateOfBirth : (u.DateOfBirth == null ? null : u.DateOfBirth[..4] + "-**-**"), address = unmask ? u.Address : (u.Address == null ? null : "••••"),
                    u.CreatedAt, u.LastLoginAt, u.Status, u.PlatformRole, u.MfaEnabled,
                },
                verification = new { u.KycLevel, u.KycStatus, u.KycVerifiedAt, checks = await db.KycChecks.Where(k => k.UserId == id).OrderByDescending(k => k.CreatedAt).ToListAsync() },
                risk = new { u.RiskScore, u.RiskLevel },
                wallet,
                money_profile = new
                {
                    total_incoming_usd = incoming.Sum(t => FxTable.ToUsd(t.DestinationAmount, t.DestinationCurrency)),
                    total_outgoing_usd = outgoing.Sum(t => FxTable.ToUsd(t.SourceAmount, t.SourceCurrency)),
                    withdrawals = outgoing.Count(t => t.Type == "withdrawal"),
                    counterparties = transfers.Select(t => t.SenderWalletId == wallet?.Id ? t.RecipientWalletId : t.SenderWalletId).Where(x => x != null).Distinct().Count(),
                    currencies = transfers.Select(t => t.SourceCurrency).Union(transfers.Select(t => t.DestinationCurrency)).Distinct(),
                    countries = transfers.Select(t => t.RecipientCountry).Union(transfers.Select(t => t.SenderCountry)).Where(c => c != null).Distinct(),
                    average_transaction_usd = transfers.Count == 0 ? 0 : (long)transfers.Average(t => FxTable.ToUsd(t.SourceAmount, t.SourceCurrency)),
                    top_funding_sources = incoming.GroupBy(t => t.Type == "funding" ? t.FundingSource ?? "external" : t.Type).Select(g => new { source = g.Key, count = g.Count(), usd = g.Sum(t => FxTable.ToUsd(t.DestinationAmount, t.DestinationCurrency)) }),
                },
                transfers,
                bank_accounts = (await db.BankAccounts.Where(b => b.OwnerId == id).ToListAsync()).Select(b => new { b.Id, b.BankName, b.Country, b.Currency, last4 = b.Last4, b.VerificationStatus, b.NameMatch, b.CreatedAt, b.RemovedAt }),
                devices = await db.Devices.Where(d => d.UserId == id).ToListAsync(),
                sessions = await db.Sessions.Where(s => s.UserId == id).OrderByDescending(s => s.CreatedAt).Take(20).Select(s => new { s.Id, s.CreatedAt, s.Ip, s.UserAgent, s.RevokedAt }).ToListAsync(),
                alerts = await db.Alerts.Where(x => x.SubjectId == id).OrderByDescending(x => x.CreatedAt).ToListAsync(),
                cases = await db.Cases.Where(c => c.SubjectId == id).ToListAsync(),
                memberships = await db.Memberships.Where(m => m.UserId == id).ToListAsync(),
            };
        });
        a.MapGet("/users/{id}/timeline", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.users.read");
            await LogAccess(db, ctx, "user", id, "timeline");
            var wallet = await db.Wallets.FirstOrDefaultAsync(w => w.OwnerType == "user" && w.OwnerId == id);
            var items = new List<(DateTime At, string Kind, string Text, string? Ref)>();
            var user = await db.Users.FirstAsync(u => u.Id == id);
            items.Add((user.CreatedAt, "account", "Account created", user.Id));
            foreach (var e in await db.SecurityEvents.Where(e => e.UserId == id).ToListAsync()) items.Add((e.CreatedAt, "security", e.Type.Replace('_', ' ') + (e.Ip != null ? $" from {e.Ip}" : ""), e.Id));
            foreach (var k in await db.KycChecks.Where(k => k.UserId == id).ToListAsync()) items.Add((k.CreatedAt, "kyc", $"KYC level {k.LevelRequested} {k.Result}", k.Id));
            foreach (var b in await db.BankAccounts.Where(b => b.OwnerId == id).ToListAsync()) items.Add((b.CreatedAt, "bank", $"Bank account ****{b.Last4} added ({b.Country})", b.Id));
            if (wallet != null)
                foreach (var t in await db.Transfers.Where(t => t.SenderWalletId == wallet.Id || t.RecipientWalletId == wallet.Id).ToListAsync())
                    items.Add((t.CreatedAt, "money", $"{t.Type} {(t.SenderWalletId == wallet.Id ? "out" : "in")} {Money.Format(t.SenderWalletId == wallet.Id ? t.SourceAmount : t.DestinationAmount, t.SenderWalletId == wallet.Id ? t.SourceCurrency : t.DestinationCurrency)} — {t.Status}", t.Id));
            foreach (var al in await db.Alerts.Where(x => x.SubjectId == id).ToListAsync()) items.Add((al.CreatedAt, "alert", $"Alert: {al.Summary} ({al.Severity})", al.Id));
            foreach (var c in await db.Cases.Where(x => x.SubjectId == id).ToListAsync()) items.Add((c.CreatedAt, "case", $"Case opened: {c.Title}", c.Id));
            foreach (var au in await db.AuditLogs.Where(x => x.ObjectId == id).ToListAsync()) items.Add((au.At, "admin", $"{au.Action} by {au.ActorId}{(au.Reason != null ? $": {au.Reason}" : "")}", au.Id));
            return new { @object = "timeline", data = items.OrderBy(i => i.At).Select(i => new { at = i.At, kind = i.Kind, text = i.Text, @ref = i.Ref }) };
        });
        a.MapGet("/users/{id}/fund_flow", async (string id, HttpRequest req, RequestContext ctx, FundFlowService flow, AppDb db) =>
        {
            ctx.RequireAdmin("admin.aml.read");
            await LogAccess(db, ctx, "user", id, "fund_flow");
            var to = Paging.Date(req, "to") ?? DateTime.UtcNow.AddMinutes(1);
            return await flow.Graph(id, Paging.Date(req, "from") ?? to.AddDays(-90), to);
        });
        a.MapGet("/users/{id}/network", async (string id, RequestContext ctx, FundFlowService flow, AppDb db) =>
        {
            ctx.RequireAdmin("admin.aml.read");
            await LogAccess(db, ctx, "user", id, "network");
            return await flow.Network(id);
        });
        a.MapPost("/users/{id}/kyc_decision", async (string id, KycDecisionRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireAdmin("admin.kyc.decide");
            return await uow.Run(async () =>
            {
                var u = await db.Users.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("user");
                if (u.KycStatus != "REVIEW") throw ApiException.Conflict("invalid_state", "No KYC review is pending.");
                var to = r.Approve ? "VERIFIED" : "REJECTED";
                uow.Transition("kyc", u.Id, u.KycStatus, to, reason: r.Reason);
                u.KycStatus = to;
                if (r.Approve) { u.KycLevel = Math.Max(u.KycLevel, r.Level); u.KycVerifiedAt = uow.Now; }
                uow.Audit("kyc.decide", "user", u.Id, after: new { to, r.Level }, reason: r.Reason);
                await Task.CompletedTask;
                return u;
            });
        });

        a.MapGet("/transfers", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.transactions.read");
            var q = db.Transfers.AsQueryable();
            if (req.Query["status"].FirstOrDefault() is { } s) q = q.Where(t => t.Status == s);
            if (req.Query["type"].FirstOrDefault() is { } ty) q = q.Where(t => t.Type == ty);
            if (req.Query["wallet"].FirstOrDefault() is { } w) q = q.Where(t => t.SenderWalletId == w || t.RecipientWalletId == w);
            if (req.Query["from_country"].FirstOrDefault() is { } fc) q = q.Where(t => t.SenderCountry == fc);
            if (req.Query["to_country"].FirstOrDefault() is { } tc) q = q.Where(t => t.RecipientCountry == tc);
            if (req.Query["bank_account"].FirstOrDefault() is { } ba) q = q.Where(t => t.BankAccountId == ba);
            return await Paging.List(q, req);
        });
        a.MapGet("/transfers/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.transactions.read");
            var t = await db.Transfers.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("transfer");
            var ltx = t.LedgerTransactionId == null ? null : await db.LedgerTransactions.FirstOrDefaultAsync(l => l.Id == t.LedgerTransactionId);
            var related = await db.LedgerTransactions.Where(l => l.SourceId == id).ToListAsync();
            var entries = await db.LedgerEntries.Where(e => related.Select(r => r.Id).Contains(e.TransactionId)).ToListAsync();
            var accounts = await db.LedgerAccounts.Where(x => entries.Select(e => e.AccountId).Contains(x.Id)).ToDictionaryAsync(x => x.Id);
            return new
            {
                transfer = t, internal_reason = t.InternalReason,
                sender = t.SenderWalletId == null ? null : await db.Wallets.FirstOrDefaultAsync(w => w.Id == t.SenderWalletId),
                recipient = t.RecipientWalletId == null ? null : await db.Wallets.FirstOrDefaultAsync(w => w.Id == t.RecipientWalletId),
                bank_account = t.BankAccountId == null ? null : await db.BankAccounts.FirstOrDefaultAsync(b => b.Id == t.BankAccountId),
                fx_quote = t.FxQuoteId == null ? null : await db.FxQuotes.FirstOrDefaultAsync(q => q.Id == t.FxQuoteId),
                screening = await db.ScreeningChecks.Where(s => s.SubjectId == t.RecipientWalletId || s.AlertId != null && db.Alerts.Any(al => al.Id == s.AlertId && al.TransferId == id)).ToListAsync(),
                alerts = await db.Alerts.Where(x => x.TransferId == id).ToListAsync(),
                ledger = related.Select(l => new { l.Id, l.Type, l.CreatedAt, entries = entries.Where(e => e.TransactionId == l.Id).Select(e => new { account = accounts[e.AccountId].Code, owner = accounts[e.AccountId].OwnerId, e.Direction, e.Amount, e.Currency }) }),
                lineage = new { parent = t.ParentTransferId, ledger_transaction = ltx?.Id },
                timeline = await db.StateTransitions.Where(x => x.ObjectId == id).OrderBy(x => x.CreatedAt).ToListAsync(),
            };
        });
        a.MapGet("/transfers/{id}/trace", async (string id, HttpRequest req, RequestContext ctx, FundFlowService flow) =>
        {
            ctx.RequireAdmin("admin.aml.read");
            return await flow.Trace(id, int.TryParse(req.Query["hops"], out var h) ? Math.Clamp(h, 1, 5) : 3, int.TryParse(req.Query["window_days"], out var d) ? Math.Clamp(d, 1, 90) : 7);
        });
        a.MapGet("/payments", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.transactions.read");
            var q = db.Payments.AsQueryable();
            if (req.Query["status"].FirstOrDefault() is { } s) q = q.Where(p => p.Status == s);
            if (req.Query["org"].FirstOrDefault() is { } o) q = q.Where(p => p.OrgId == o);
            return await Paging.List(q, req);
        });

        // ───────── AML alerts & cases (§62-§68, §160-§164) ─────────
        a.MapGet("/alerts", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.aml.read");
            var q = db.Alerts.AsQueryable();
            if (req.Query["status"].FirstOrDefault() is { } s) q = s == "open" ? q.Where(x => x.Status == "NEW" || x.Status == "QUEUED" || x.Status == "IN_REVIEW" || x.Status == "ESCALATED") : q.Where(x => x.Status == s);
            if (req.Query["type"].FirstOrDefault() is { } t) q = q.Where(x => x.Type == t);
            if (req.Query["severity"].FirstOrDefault() is { } sv) q = q.Where(x => x.Severity == sv);
            return await Paging.List(q, req);
        });
        a.MapGet("/alerts/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.aml.read");
            var al = await db.Alerts.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("alert");
            var rule = await db.MonitoringRules.FirstOrDefaultAsync(r => r.Key == al.RuleKey);
            return new
            {
                alert = al, rule, transfer = al.TransferId == null ? null : await db.Transfers.FirstOrDefaultAsync(t => t.Id == al.TransferId),
                screening = await db.ScreeningChecks.Where(s => s.AlertId == id).ToListAsync(),
                subject = al.SubjectType == "user" ? (object?)await db.Users.Where(u => u.Id == al.SubjectId).Select(u => new { u.Id, u.Name, u.Country, u.KycLevel, u.Status, u.DateOfBirth }).FirstOrDefaultAsync() : await db.Organizations.FirstOrDefaultAsync(o => o.Id == al.SubjectId),
            };
        });
        a.MapPost("/alerts/{id}/assign", async (string id, AssignRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireAdmin("admin.aml.write");
            return await uow.Run(async () =>
            {
                var al = await db.Alerts.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("alert");
                al.AssignedTo = r.AssignedTo ?? ctx.ActorId;
                if (al.Status is "NEW" or "QUEUED") al.Status = "IN_REVIEW";
                uow.Audit("alert.assign", "alert", al.Id, after: new { al.AssignedTo });
                return al;
            });
        });
        a.MapPost("/alerts/{id}/conclude", async (string id, AlertConclusionRequest r, RequestContext ctx, AppDb db, Uow uow, ComplianceService compliance) =>
        {
            ctx.RequireAdmin("admin.aml.write");
            if (r.Conclusion is not ("FALSE_POSITIVE" or "TRUE_MATCH" or "INCONCLUSIVE")) throw ApiException.Invalid("conclusion must be FALSE_POSITIVE, TRUE_MATCH or INCONCLUSIVE.");
            if (string.IsNullOrWhiteSpace(r.Note) || r.Note.Length < 10) throw ApiException.Invalid("Record the reasoning (at least 10 characters).");
            var al = await db.Alerts.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("alert");
            // Confirming a sanctions match is consequential and goes through four-eyes approval (§68, §190).
            if (r.Conclusion == "TRUE_MATCH" && al.Type is "sanctions" or "pep")
                return (object)await compliance.RequestApproval("confirm_sanctions_match", "alert", al.Id, new { }, r.Note, al.CaseId);
            return await uow.Run(async () =>
            {
                al.Conclusion = r.Conclusion;
                al.ConclusionNote = r.Note;
                al.Status = r.Conclusion == "FALSE_POSITIVE" ? "FALSE_POSITIVE" : r.Conclusion == "TRUE_MATCH" ? "ESCALATED" : "RESOLVED";
                al.ResolvedAt = uow.Now;
                al.ResolvedBy = ctx.ActorId;
                var check = await db.ScreeningChecks.FirstOrDefaultAsync(s => s.AlertId == al.Id);
                if (check != null && r.Conclusion == "FALSE_POSITIVE") { check.Result = "false_positive"; check.ReviewedBy = ctx.ActorId; }
                uow.Audit("alert.conclude", "alert", al.Id, after: new { r.Conclusion }, reason: r.Note, caseId: al.CaseId);
                return (object)al;
            });
        });

        a.MapGet("/cases", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.aml.read");
            var q = db.Cases.AsQueryable();
            if (req.Query["status"].FirstOrDefault() is { } s) q = s == "open" ? q.Where(c => c.Status != "CLOSED") : q.Where(c => c.Status == s);
            if (req.Query["assigned_to"].FirstOrDefault() is { } asg) q = q.Where(c => c.AssignedTo == asg);
            return await Paging.List(q, req);
        });
        a.MapPost("/cases", async (CaseRequest r, RequestContext ctx, ComplianceService compliance) =>
        {
            ctx.RequireAdmin("admin.aml.write");
            return Results.Json(await compliance.OpenCase(r.SubjectType, r.SubjectId, r.Title, r.Priority ?? "MEDIUM", r.Alerts ?? [], r.Type ?? "aml"), statusCode: 201);
        });
        a.MapGet("/cases/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.aml.read");
            var c = await db.Cases.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("case");
            await LogAccess(db, ctx, "case", id, "case_file");
            return new
            {
                @case = c,
                alerts = await db.Alerts.Where(x => x.CaseId == id).ToListAsync(),
                notes = await db.CaseNotes.Where(n => n.CaseId == id).OrderBy(n => n.CreatedAt).ToListAsync(),
                evidence = await db.CaseEvidence.Where(e => e.CaseId == id).OrderBy(e => e.CreatedAt).ToListAsync(),
                approvals = await db.Approvals.Where(x => x.CaseId == id).OrderBy(x => x.CreatedAt).ToListAsync(),
                history = await db.AuditLogs.Where(x => x.CaseId == id).OrderBy(x => x.Seq).ToListAsync(),
                sla = new { due_at = c.DueAt, overdue = c.Status != "CLOSED" && c.DueAt < DateTime.UtcNow },
            };
        });
        a.MapPost("/cases/{id}/assign", async (string id, AssignRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireAdmin("admin.aml.write");
            return await uow.Run(async () =>
            {
                var c = await db.Cases.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("case");
                c.AssignedTo = r.AssignedTo ?? ctx.ActorId;
                c.UpdatedAt = uow.Now;
                uow.Audit("case.assign", "case", c.Id, after: new { c.AssignedTo }, caseId: c.Id);
                return c;
            });
        });
        a.MapPost("/cases/{id}/notes", async (string id, NoteRequest r, RequestContext ctx, ComplianceService compliance) =>
        {
            ctx.RequireAdmin("admin.aml.write");
            return await compliance.AddNote(id, r.Kind, r.Body, r.Finalize);
        });
        a.MapPost("/case_notes/{id}/finalize", async (string id, RequestContext ctx, ComplianceService compliance) => { ctx.RequireAdmin("admin.aml.write"); return await compliance.FinalizeNote(id); });
        a.MapPost("/cases/{id}/evidence", async (string id, EvidenceRefRequest r, RequestContext ctx, ComplianceService compliance) =>
        {
            ctx.RequireAdmin("admin.aml.write");
            return await compliance.AddEvidence(id, r.RefType, r.RefId, r.Description);
        });
        a.MapPost("/cases/{id}/decision", async (string id, CaseDecisionRequest r, RequestContext ctx, ComplianceService compliance) =>
        {
            ctx.RequireAdmin("admin.aml.write");
            if (r.Decision is "FALSE_POSITIVE" or "NO_FURTHER_ACTION" or "CONTINUE_MONITORING") ctx.RequireAdmin("admin.aml.write");
            return await compliance.Decide(id, r.Decision, r.Reason);
        });
        a.MapGet("/cases/{id}/report", async (string id, RequestContext ctx, ComplianceService compliance, Uow uow) =>
        {
            ctx.RequireAdmin("admin.export");
            var json = await compliance.BuildReportPackage(id);
            await uow.Run(async () => { uow.Audit("case.export", "case", id, after: new { sha256 = Crypto.Sha256Hex(json) }, caseId: id); await Task.CompletedTask; });
            return Results.Text(json, "application/json");
        });

        // ───────── Four-eyes approvals (§68, §205, §206) ─────────
        a.MapGet("/approvals", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.overview");
            var q = db.Approvals.AsQueryable();
            if (req.Query["status"].FirstOrDefault() is { } s) q = q.Where(x => x.Status == s);
            return await Paging.List(q, req);
        });
        a.MapPost("/approvals", async (ApprovalCreateRequest r, RequestContext ctx, ComplianceService compliance) =>
        {
            // Requesting needs the underlying capability; approving needs a *different* person with it.
            var perm = ComplianceService.ApprovalPermission.GetValueOrDefault(r.Action) ?? throw ApiException.Invalid("Unknown action.");
            ctx.RequireAdmin(perm is "admin.freeze" or "admin.restrict" ? "admin.restrict" : perm);
            return Results.Json(await compliance.RequestApproval(r.Action, r.TargetType, r.TargetId, r.Payload ?? new Dictionary<string, object>(), r.Reason, r.CaseId), statusCode: 201);
        });
        a.MapPost("/approvals/{id}/decision", async (string id, ApprovalDecisionRequest r, RequestContext ctx, ComplianceService compliance, IClock clock) =>
        {
            ctx.RequireAdmin("admin.approve");
            ctx.RequireStepUp(clock);
            return await compliance.DecideApproval(id, r.Approve, r.Note, ctx);
        });

        // ───────── Sanctions & screening (§58-§60, §166) ─────────
        a.MapGet("/screening/lists", async (RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.aml.read");
            var lists = await db.ScreeningLists.ToListAsync();
            return new { @object = "list", data = lists.Select(l => new { l.Id, l.Name, l.Source, l.Version, l.Active, entries = db.ScreeningEntries.Count(e => e.ListId == l.Id) }) };
        });
        a.MapGet("/screening/lists/{id}/entries", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.aml.read");
            return new { @object = "list", data = await db.ScreeningEntries.Where(e => e.ListId == id).ToListAsync() };
        });
        a.MapPost("/screening/lists/{id}/entries", async (string id, ScreeningEntryRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireAdmin("admin.config.manage");
            return await uow.Run(async () =>
            {
                var list = await db.ScreeningLists.FirstOrDefaultAsync(l => l.Id == id) ?? throw ApiException.NotFound("screening list");
                var e = new ScreeningEntry { Id = Ids.New("sent"), CreatedAt = uow.Now, ListId = id, Name = r.Name, AliasesCsv = r.Aliases, EntryType = r.EntryType, DateOfBirth = r.DateOfBirth, Country = r.Country, Program = r.Program };
                db.ScreeningEntries.Add(e);
                // Every list change bumps the version so each decision records exactly what it was screened against.
                list.Version = uow.Now.ToString("yyyyMMdd.HHmmss");
                uow.Audit("screening.entry_add", "screening_list", id, after: new { r.Name, list.Version });
                await Task.CompletedTask;
                return e;
            });
        });
        a.MapGet("/screening/checks", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.aml.read");
            var q = db.ScreeningChecks.AsQueryable();
            if (req.Query["result"].FirstOrDefault() is { } r) q = q.Where(c => c.Result == r);
            return await Paging.List(q, req);
        });
        a.MapPost("/screening/rescreen", async (RequestContext ctx, AppDb db, ScreeningService screening) =>
        {
            // Periodic / list-update rescreening of verified users and beneficial owners (§167).
            ctx.RequireAdmin("admin.aml.write");
            var users = await db.Users.Where(u => u.KycStatus == "VERIFIED" && u.Status != "CLOSED").ToListAsync();
            var owners = await db.BeneficialOwners.ToListAsync();
            var hits = 0;
            foreach (var u in users) if ((await screening.Screen("user", u.Id, u.Name, u.DateOfBirth, u.Country, "periodic_rescreen")).Result != "clear") hits++;
            foreach (var o in owners) if ((await screening.Screen("beneficial_owner", o.Id, o.Name, o.DateOfBirth, o.Nationality, "periodic_rescreen")).Result != "clear") hits++;
            return new { screened = users.Count + owners.Count, potential_matches = hits };
        });

        // ───────── Ledger, reconciliation, payouts (§42, §155, §203) ─────────
        a.MapGet("/ledger/integrity", async (RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.ledger.read");
            var audit = await AuditChain.VerifyAsync(db);
            return new { ledger = await LedgerService.VerifyIntegrity(db), audit_chain = new { valid = audit.Valid, rows_checked = audit.Checked, broken_at_seq = audit.BrokenAtSeq } };
        });
        a.MapGet("/ledger/accounts", async (HttpRequest req, RequestContext ctx, AppDb db, LedgerService ledger) =>
        {
            ctx.RequireAdmin("admin.ledger.read");
            var q = db.LedgerAccounts.AsQueryable();
            if (req.Query["owner_type"].FirstOrDefault() is { } ot) q = q.Where(x => x.OwnerType == ot);
            if (req.Query["owner"].FirstOrDefault() is { } o) q = q.Where(x => x.OwnerId == o);
            var accounts = await q.OrderBy(x => x.OwnerType).ThenBy(x => x.Code).Take(500).ToListAsync();
            var list = new List<object>();
            foreach (var acct in accounts) list.Add(new { acct.Id, acct.OwnerType, acct.OwnerId, acct.Code, acct.Currency, acct.Livemode, acct.Kind, balance = await ledger.Balance(acct) });
            return new { @object = "list", data = list };
        });
        a.MapGet("/ledger/transactions/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.ledger.read");
            var t = await db.LedgerTransactions.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("ledger transaction");
            var entries = await db.LedgerEntries.Where(e => e.TransactionId == id).ToListAsync();
            var accounts = await db.LedgerAccounts.Where(x => entries.Select(e => e.AccountId).Contains(x.Id)).ToDictionaryAsync(x => x.Id);
            return new
            {
                transaction = t,
                entries = entries.Select(e => new { e.Id, account = accounts[e.AccountId], e.Direction, e.Amount, e.Currency }),
                children = await db.LedgerTransactions.Where(x => x.ParentTransactionId == id || x.ReversesTransactionId == id).ToListAsync(),
            };
        });
        a.MapPost("/reconciliation/run", async (RequestContext ctx, ReconciliationService recon) => { ctx.RequireAdmin("admin.recon.resolve"); return await recon.Run(ctx.ActorId); });
        a.MapGet("/reconciliation/runs", async (HttpRequest req, RequestContext ctx, AppDb db) => { ctx.RequireAdmin("admin.recon.read"); return await Paging.List(db.ReconRuns, req); });
        a.MapGet("/reconciliation/exceptions", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.recon.read");
            var q = db.ReconExceptions.AsQueryable();
            if (req.Query["status"].FirstOrDefault() is { } s) q = q.Where(e => e.Status == s);
            return await Paging.List(q, req);
        });
        a.MapPost("/reconciliation/exceptions/{id}/resolve", async (string id, ReconResolveRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireAdmin("admin.recon.resolve");
            if (string.IsNullOrWhiteSpace(r.Resolution)) throw ApiException.Invalid("Describe the resolution (e.g. the adjustment id).");
            return await uow.Run(async () =>
            {
                var e = await db.ReconExceptions.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("exception");
                e.Status = "resolved";
                e.Resolution = r.Resolution;
                e.ResolvedBy = ctx.ActorId;
                e.ResolvedAt = uow.Now;
                uow.Audit("reconciliation.resolve", "reconciliation_exception", e.Id, reason: r.Resolution);
                await Task.CompletedTask;
                return e;
            });
        });
        a.MapGet("/payouts", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.transactions.read");
            var q = db.Payouts.AsQueryable();
            if (req.Query["status"].FirstOrDefault() is { } s) q = q.Where(p => p.Status == s);
            return await Paging.List(q, req);
        });

        // ───────── Providers & configuration (§70, §120, §171) ─────────
        a.MapGet("/providers", async (RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.overview");
            var since = DateTime.UtcNow.AddHours(-24);
            var providers = await db.Providers.ToListAsync();
            var samples = await db.ProviderHealthSamples.Where(s => s.CreatedAt >= since).ToListAsync();
            return new
            {
                @object = "list",
                data = providers.Select(p => new
                {
                    provider = p,
                    last_24h = new
                    {
                        attempts = samples.Count(s => s.ProviderId == p.Id),
                        success_rate = samples.Count(s => s.ProviderId == p.Id) == 0 ? (double?)null : Math.Round(samples.Count(s => s.ProviderId == p.Id && s.Success) * 100.0 / samples.Count(s => s.ProviderId == p.Id), 1),
                        avg_latency_ms = samples.Where(s => s.ProviderId == p.Id).Select(s => (double?)s.LatencyMs).Average(),
                        errors = samples.Where(s => s.ProviderId == p.Id && !s.Success).GroupBy(s => s.ErrorType).ToDictionary(g => g.Key ?? "unknown", g => g.Count()),
                    },
                }),
            };
        });
        a.MapPatch("/providers/{id}", async (string id, ProviderUpdateRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireAdmin("admin.providers.manage");
            return await uow.Run(async () =>
            {
                var p = await db.Providers.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("provider");
                var before = new { p.Enabled, p.Priority, p.ForceOutage, p.FeeBps };
                if (r.Enabled != null) p.Enabled = r.Enabled.Value;
                if (r.Priority != null) p.Priority = r.Priority.Value;
                if (r.ForceOutage != null) p.ForceOutage = r.ForceOutage.Value;
                if (r.FeeBps != null) p.FeeBps = r.FeeBps.Value;
                uow.Audit("provider.update", "provider", p.Id, before, new { p.Enabled, p.Priority, p.ForceOutage, p.FeeBps });
                await Task.CompletedTask;
                return p;
            });
        });
        a.MapGet("/config/fees", async (RequestContext ctx, AppDb db) => { ctx.RequireAdmin("admin.overview"); return new { @object = "list", data = await db.FeeSchedules.OrderBy(f => f.Priority).ToListAsync() }; });
        a.MapPost("/config/fees", async (FeeRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireAdmin("admin.config.manage");
            return await uow.Run(async () =>
            {
                var prior = await db.FeeSchedules.Where(f => f.Active && f.OrgId == r.OrgId && f.Country == r.Country && f.Method == r.Method).ToListAsync();
                foreach (var p in prior) p.Active = false;
                var f = new FeeSchedule
                {
                    Id = Ids.New("fee"), CreatedAt = uow.Now, OrgId = r.OrgId, Country = r.Country, Method = r.Method, PercentBps = r.PercentBps, FixedMinor = r.FixedMinor,
                    FixedCurrency = Money.Normalize(r.FixedCurrency), MinimumMinor = r.MinimumMinor, MaximumMinor = r.MaximumMinor, InternationalBps = r.InternationalBps,
                    Version = prior.Select(p => p.Version).DefaultIfEmpty(0).Max() + 1,
                };
                db.FeeSchedules.Add(f);
                uow.Audit("config.fee_schedule", "fee_schedule", f.Id, prior.Select(p => new { p.Id, p.PercentBps, p.FixedMinor }).ToList(), new { f.PercentBps, f.FixedMinor, f.Version });
                return f;
            });
        });
        a.MapGet("/config/tax_rules", async (RequestContext ctx, AppDb db) => { ctx.RequireAdmin("admin.overview"); return new { @object = "list", data = await db.TaxRules.OrderBy(r => r.Country).ThenByDescending(r => r.Version).ToListAsync() }; });
        a.MapPost("/config/tax_rules", async (TaxRuleRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            // Versioned: the prior rule is end-dated, never edited, so historical invoices keep their rule (§266).
            ctx.RequireAdmin("admin.config.manage");
            return await uow.Run(async () =>
            {
                var effective = r.EffectiveFrom?.ToUniversalTime() ?? uow.Now;
                var category = r.TaxCategory ?? "*";
                var customerType = r.CustomerType ?? "*";
                var prior = await db.TaxRules.Where(x => x.Country == r.Country.ToUpperInvariant() && x.TaxCategory == category && x.CustomerType == customerType && x.EffectiveTo == null).ToListAsync();
                foreach (var p in prior) p.EffectiveTo = effective;
                var rule = new TaxRule
                {
                    Id = Ids.New("txr"), CreatedAt = uow.Now, Country = r.Country.ToUpperInvariant(), TaxCategory = category, CustomerType = customerType, TaxType = r.TaxType,
                    RateBps = r.RateBps, ReverseChargeB2B = r.ReverseChargeB2B, Label = r.Label, EffectiveFrom = effective, Version = prior.Select(p => p.Version).DefaultIfEmpty(0).Max() + 1,
                };
                db.TaxRules.Add(rule);
                uow.Audit("config.tax_rule", "tax_rule", rule.Id, prior.Select(p => new { p.Id, p.RateBps, p.Version }).ToList(), new { rule.RateBps, rule.Version, rule.EffectiveFrom });
                return rule;
            });
        });
        a.MapGet("/config/monitoring_rules", async (RequestContext ctx, AppDb db) => { ctx.RequireAdmin("admin.aml.read"); return new { @object = "list", data = await db.MonitoringRules.OrderBy(r => r.Key).ToListAsync() }; });
        a.MapPatch("/config/monitoring_rules/{key}", async (string key, RuleUpdateRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireAdmin("admin.config.manage");
            return await uow.Run(async () =>
            {
                var rule = await db.MonitoringRules.FirstOrDefaultAsync(x => x.Key == key) ?? throw ApiException.NotFound("monitoring rule");
                var before = new { rule.Enabled, rule.Severity, rule.Action, rule.ParamsJson, rule.Version };
                if (r.Enabled != null) rule.Enabled = r.Enabled.Value;
                if (r.Severity != null) rule.Severity = r.Severity;
                if (r.Action is "hold" or "alert") rule.Action = r.Action;
                if (r.Params != null)
                {
                    var merged = Json.Deserialize<Dictionary<string, long>>(rule.ParamsJson) ?? new();
                    foreach (var (k, v) in r.Params) merged[k] = v;
                    rule.ParamsJson = Json.Serialize(merged);
                }
                rule.Version++;
                uow.Audit("config.monitoring_rule", "monitoring_rule", rule.Id, before, new { rule.Enabled, rule.Severity, rule.Action, rule.ParamsJson, rule.Version });
                await Task.CompletedTask;
                return rule;
            });
        });
        a.MapGet("/config/countries", async (RequestContext ctx, AppDb db) => { ctx.RequireAdmin("admin.overview"); return new { @object = "list", data = await db.Countries.OrderBy(c => c.Country).ToListAsync() }; });
        a.MapPatch("/config/countries/{code}", async (string code, CountryRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireAdmin("admin.config.manage");
            return await uow.Run(async () =>
            {
                var c = await db.Countries.FirstOrDefaultAsync(x => x.Country == code.ToUpperInvariant()) ?? throw ApiException.NotFound("country");
                var before = new { c.CheckoutEnabled, c.WalletEnabled, c.PayoutsEnabled, c.MerchantOnboardingEnabled, c.PaymentMethodsCsv };
                c.CheckoutEnabled = r.CheckoutEnabled ?? c.CheckoutEnabled; c.WalletEnabled = r.WalletEnabled ?? c.WalletEnabled; c.PayoutsEnabled = r.PayoutsEnabled ?? c.PayoutsEnabled;
                c.MerchantOnboardingEnabled = r.MerchantOnboardingEnabled ?? c.MerchantOnboardingEnabled; c.PaymentMethodsCsv = r.PaymentMethodsCsv ?? c.PaymentMethodsCsv;
                c.WalletKycLevelRequired = r.WalletKycLevelRequired ?? c.WalletKycLevelRequired;
                uow.Audit("config.country", "country_capability", c.Id, before, new { c.CheckoutEnabled, c.WalletEnabled, c.PayoutsEnabled, c.MerchantOnboardingEnabled, c.PaymentMethodsCsv });
                await Task.CompletedTask;
                return c;
            });
        });
        a.MapGet("/config/limits", async (RequestContext ctx, AppDb db) => { ctx.RequireAdmin("admin.overview"); return new { @object = "list", data = await db.WalletLimits.ToListAsync() }; });
        a.MapGet("/config/fx_rates", async (RequestContext ctx, AppDb db) => { ctx.RequireAdmin("admin.overview"); return new { @object = "list", data = await db.FxRates.OrderByDescending(r => r.AsOf).Take(100).ToListAsync() }; });

        // ───────── Audit (§87, §140, §232, §296) ─────────
        a.MapGet("/audit_logs", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.audit.read");
            var q = db.AuditLogs.AsQueryable();
            if (req.Query["actor"].FirstOrDefault() is { } actor) q = q.Where(x => x.ActorId == actor);
            if (req.Query["object"].FirstOrDefault() is { } obj) q = q.Where(x => x.ObjectId == obj);
            if (req.Query["action"].FirstOrDefault() is { } act) q = q.Where(x => x.Action.StartsWith(act));
            if (req.Query["org"].FirstOrDefault() is { } org) q = q.Where(x => x.OrgId == org);
            if (req.Query["ip"].FirstOrDefault() is { } ip) q = q.Where(x => x.Ip == ip);
            if (Paging.Date(req, "from") is { } from) q = q.Where(x => x.At >= from);
            if (Paging.Date(req, "to") is { } to) q = q.Where(x => x.At < to);
            if (long.TryParse(req.Query["before_seq"], out var before)) q = q.Where(x => x.Seq < before);
            var rows = await q.OrderByDescending(x => x.Seq).Take(Math.Clamp(int.TryParse(req.Query["limit"], out var n) ? n : 50, 1, 200)).ToListAsync();
            return new { @object = "list", data = rows, next_before_seq = rows.LastOrDefault()?.Seq };
        });
        a.MapGet("/audit_logs/export", async (HttpRequest req, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireAdmin("admin.export");
            var reason = req.Query["reason"].ToString();
            if (reason.Length < 5) throw ApiException.Invalid("Exports require a reason (§136).");
            var q = db.AuditLogs.AsQueryable();
            if (req.Query["object"].FirstOrDefault() is { } obj) q = q.Where(x => x.ObjectId == obj || x.CaseId == obj);
            if (req.Query["org"].FirstOrDefault() is { } org) q = q.Where(x => x.OrgId == org);
            var rows = await q.OrderBy(x => x.Seq).Take(50_000).ToListAsync();
            await uow.Run(async () => { uow.Audit("audit.export", "audit_log", null, after: new { rows = rows.Count, filter = req.QueryString.Value }, reason: reason); await Task.CompletedTask; });
            return Results.Text(Csv.Write(rows, ("seq", r => r.Seq), ("at", r => r.At), ("actor_type", r => r.ActorType), ("actor", r => r.ActorId), ("role", r => r.ActorRole), ("org", r => r.OrgId),
                ("action", r => r.Action), ("object_type", r => r.ObjectType), ("object", r => r.ObjectId), ("reason", r => r.Reason), ("case", r => r.CaseId), ("approval", r => r.ApprovalId),
                ("ip", r => r.Ip), ("request_id", r => r.RequestId), ("hash", r => r.Hash)), "text/csv");
        });
        a.MapGet("/data_access_logs", async (HttpRequest req, RequestContext ctx, AppDb db) => { ctx.RequireAdmin("admin.audit.read"); return await Paging.List(db.DataAccessLogs, req); });
        a.MapGet("/system_health", async (RequestContext ctx, AppDb db, IClock clock) =>
        {
            ctx.RequireAdmin("admin.overview");
            var hour = clock.UtcNow.AddHours(-1);
            var logs = await db.ApiRequestLogs.Where(l => l.At >= hour).ToListAsync();
            var latencies = logs.Select(l => l.LatencyMs).OrderBy(x => x).ToList();
            int Pct(double p) => latencies.Count == 0 ? 0 : latencies[Math.Min(latencies.Count - 1, (int)(latencies.Count * p))];
            return new
            {
                api = new { requests_last_hour = logs.Count, error_rate_pct = logs.Count == 0 ? 0 : Math.Round(logs.Count(l => l.Status >= 500) * 100.0 / logs.Count, 2), p50_ms = Pct(0.5), p95_ms = Pct(0.95) },
                outbox = new { backlog = await db.Outbox.CountAsync(o => o.ProcessedAt == null), failed = await db.Outbox.CountAsync(o => o.LastError != null) },
                webhooks = new { pending = await db.WebhookDeliveries.CountAsync(d => d.Status == "pending" || d.Status == "retrying"), dead = await db.WebhookDeliveries.CountAsync(d => d.Status == "dead") },
                providers = await db.Providers.Select(p => new { p.Id, p.HealthState, p.Enabled }).ToListAsync(),
                ledger_exceptions = await db.ReconExceptions.CountAsync(e => e.Status == "open"),
                database = db.Database.ProviderName,
            };
        });
    }

    /// <summary>Access to sensitive records is itself audited (§134, §298).</summary>
    private static async Task LogAccess(AppDb db, RequestContext ctx, string type, string id, string fields)
    {
        db.DataAccessLogs.Add(new DataAccessLog { Id = Ids.New("dal"), CreatedAt = DateTime.UtcNow, AdminUserId = ctx.ActorId, ObjectType = type, ObjectId = id, Fields = fields, Ip = ctx.Ip });
        await db.SaveChangesAsync();
    }
}
