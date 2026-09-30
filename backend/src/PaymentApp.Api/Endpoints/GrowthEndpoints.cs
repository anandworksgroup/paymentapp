using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Growth;
using PaymentApp.Api.Modules.Reports;

namespace PaymentApp.Api.Endpoints;

public record AdminFileLinkRequest(string? Reason);

public record AffiliateRequest(string Name, string Email, string Code, string CommissionType, int? RateBps, long? FixedAmount, string? FixedCurrency, string? Duration, int? DurationMonths, int? HoldDays);
public record BudgetRequest(string? EventName, long MonthlyLimit, string? Mode, string? Thresholds);
public record ExperimentRequest(string Name, string PaymentLink, List<ExperimentVariant> Variants, string? Hypothesis);

/// <summary>Files, affiliates, usage budgets, finance reports and privacy exports.</summary>
public static class GrowthEndpoints
{
    public static void Map(WebApplication app)
    {
        // ───────── Files (§96) ─────────
        var files = app.MapGroup("/v1").WithTags("Files");
        files.MapPost("/files", async (IFormFile file, HttpRequest req, RequestContext ctx, FileService store) =>
        {
            var purpose = req.Form["purpose"].ToString();
            ctx.RequireOrg(purpose == "dispute_evidence" ? "disputes.write" : "compliance.write");
            if (purpose == "kyc_document") throw ApiException.Invalid("kyc_document uploads belong to the signed-in person: use POST /v1/me/files.");
            return Results.Json(await store.Save(file, purpose, ctx.OrgId, null, ctx.Livemode), statusCode: 201);
        }).DisableAntiforgery().RequireRateLimiting("financial");
        files.MapGet("/files", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            var orgId = ctx.RequireOrg("compliance.read");
            var q = db.Files.Where(f => f.OrgId == orgId && f.Livemode == ctx.Livemode);
            if (req.Query["purpose"].FirstOrDefault() is { Length: > 0 } p) q = q.Where(f => f.Purpose == p);
            return await Paging.List(q, req);
        });
        files.MapPost("/files/{id}/link", async (string id, RequestContext ctx, AppDb db, FileService store, Uow uow) =>
        {
            var orgId = ctx.RequireOrg("compliance.read");
            var f = await db.Files.FirstOrDefaultAsync(x => x.Id == id && x.OrgId == orgId && x.Livemode == ctx.Livemode) ?? throw ApiException.NotFound("file");
            return await Link(f, store, uow);
        });
        files.MapPost("/me/files", async (IFormFile file, RequestContext ctx, FileService store) =>
            Results.Json(await store.Save(file, "kyc_document", null, ctx.RequireUser().Id, false), statusCode: 201)).DisableAntiforgery().RequireRateLimiting("financial");
        // The signed link is the credential: short-lived, single file, no session needed (so it works in <a href>).
        app.MapGet("/v1/files/download/{token}", async (string token, FileService store, HttpResponse res) =>
        {
            var (f, content) = await store.Open(token);
            res.Headers["X-Content-Type-Options"] = "nosniff";
            res.Headers["Cache-Control"] = "no-store";
            return Results.File(content, f.ContentType, f.FileName);
        }).WithTags("Files");
        app.MapPost("/v1/admin/files/{id}/link", async (string id, AdminFileLinkRequest? r, RequestContext ctx, AppDb db, FileService store, Uow uow) =>
        {
            ctx.RequireAdmin("admin.merchants.read");
            using var _ = db.Tenant.Elevate();
            var f = await db.Files.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("file");
            if (f.Purpose == "kyc_document") ctx.RequireAdmin("admin.pii.unmask");
            db.DataAccessLogs.Add(new DataAccessLog { Id = Ids.New("dal"), CreatedAt = uow.Now, AdminUserId = ctx.ActorId, ObjectType = "file", ObjectId = f.Id, Action = "download_link", Fields = f.Purpose, Reason = r?.Reason?.Trim(), Ip = ctx.Ip });
            await db.SaveChangesAsync();
            return await Link(f, store, uow);
        }).WithTags("Admin");
        app.MapGet("/v1/admin/files", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireAdmin("admin.merchants.read");
            var q = db.Files.AsQueryable();
            if (req.Query["org"].FirstOrDefault() is { Length: > 0 } org) q = q.Where(f => f.OrgId == org);
            if (req.Query["user"].FirstOrDefault() is { Length: > 0 } user) q = q.Where(f => f.UserId == user);
            if (req.Query["purpose"].FirstOrDefault() is { Length: > 0 } purpose) q = q.Where(f => f.Purpose == purpose);
            return await Paging.List(q, req);
        }).WithTags("Admin");

        // ───────── Affiliates (§51) ─────────
        var aff = app.MapGroup("/v1/affiliates").WithTags("Affiliates");
        aff.MapGet("/", async (HttpRequest req, RequestContext ctx, AppDb db) => { ctx.RequireOrg("customers.read"); return await Paging.List(db.Affiliates, req); });
        aff.MapPost("/", async (AffiliateRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("customers.write");
            var code = r.Code.Trim().ToUpperInvariant();
            if (code.Length is < 3 or > 30 || !code.All(c => char.IsLetterOrDigit(c) || c == '-')) throw ApiException.Invalid("code must be 3-30 letters, digits or dashes.");
            if (r.CommissionType is not ("percentage" or "fixed")) throw ApiException.Invalid("commission_type must be percentage or fixed.");
            if (r.CommissionType == "percentage" && r.RateBps is null or < 1 or > 9000) throw ApiException.Invalid("rate_bps must be 1-9000 for percentage commissions.");
            if (r.CommissionType == "fixed" && (r.FixedAmount is null or < 1 || r.FixedCurrency == null)) throw ApiException.Invalid("fixed_amount and fixed_currency are required for fixed commissions.");
            if (r.Duration is not (null or "first_payment" or "recurring" or "months")) throw ApiException.Invalid("duration must be first_payment, recurring or months.");
            if (await db.Affiliates.AnyAsync(a => a.Code == code)) throw ApiException.Conflict("code_taken", "That referral code is in use.");
            return Results.Json(await uow.Run(async () =>
            {
                var a = new AffiliateAccount
                {
                    Id = Ids.New("aff"), CreatedAt = uow.Now, Name = r.Name, Email = r.Email.Trim().ToLowerInvariant(), Code = code, CommissionType = r.CommissionType,
                    RateBps = r.RateBps ?? 0, FixedAmount = r.FixedAmount ?? 0, FixedCurrency = r.FixedCurrency == null ? null : Money.Normalize(r.FixedCurrency),
                    Duration = r.Duration ?? "first_payment", DurationMonths = r.DurationMonths, HoldDays = Math.Clamp(r.HoldDays ?? 30, 0, 180),
                };
                db.Affiliates.Add(a);
                uow.Audit("affiliate.create", "affiliate", a.Id, after: new { a.Code, a.CommissionType, a.RateBps, a.FixedAmount });
                await Task.CompletedTask;
                return a;
            }), statusCode: 201);
        });
        aff.MapGet("/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("customers.read");
            var a = await db.Affiliates.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("affiliate");
            var commissions = await db.AffiliateCommissions.Where(c => c.AffiliateId == id).OrderByDescending(c => c.CreatedAt).ToListAsync();
            var referrals = await db.AffiliateReferrals.CountAsync(r => r.AffiliateId == id);
            return new
            {
                affiliate = a, clicks = a.Clicks, referred_customers = referrals,
                conversion_pct = a.Clicks == 0 ? (double?)null : Math.Round(referrals * 100.0 / a.Clicks, 1),
                totals = commissions.GroupBy(c => new { c.Currency, c.Status }).Select(g => new { g.Key.Currency, g.Key.Status, amount = g.Sum(c => c.Amount), count = g.Count() }),
                commissions,
            };
        });
        aff.MapPost("/{id}/pay", async (string id, RequestContext ctx, AffiliateService affiliates, IClock clock) =>
        {
            ctx.RequireOrg("payouts.manage");
            ctx.RequireStepUp(clock);
            return await affiliates.Pay(id);
        }).RequireRateLimiting("financial");
        aff.MapPost("/{id}/deactivate", async (string id, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("customers.write");
            return await uow.Run(async () =>
            {
                var a = await db.Affiliates.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("affiliate");
                a.Status = "inactive";
                uow.Audit("affiliate.deactivate", "affiliate", a.Id);
                await Task.CompletedTask;
                return a;
            });
        });

        // ───────── Usage budgets (§245, §246) ─────────
        var bud = app.MapGroup("/v1/customers/{customer}/budgets").WithTags("Billing");
        bud.MapGet("/", async (string customer, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("usage.read");
            var budgets = await db.CustomerBudgets.Where(b => b.CustomerId == customer).ToListAsync();
            var monthStart = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
            var list = new List<object>();
            foreach (var b in budgets)
            {
                var q = db.UsageEvents.Where(u => u.CustomerId == customer && u.Timestamp >= monthStart);
                if (b.EventName != "*") q = q.Where(u => u.EventName == b.EventName);
                var used = await q.SumAsync(u => (long?)u.Quantity) ?? 0;
                list.Add(new { budget = b, month_to_date = used, used_pct = b.MonthlyLimit == 0 ? 0 : Math.Round(used * 100.0 / b.MonthlyLimit, 1) });
            }
            return new { @object = "list", data = list };
        });
        bud.MapPost("/", async (string customer, BudgetRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("usage.write");
            _ = await db.Customers.FirstOrDefaultAsync(c => c.Id == customer) ?? throw ApiException.NotFound("customer");
            if (r.MonthlyLimit < 1) throw ApiException.Invalid("monthly_limit must be positive.");
            if (r.Mode is not (null or "soft" or "hard")) throw ApiException.Invalid("mode must be soft or hard.");
            var thresholds = r.Thresholds ?? "50,75,90,100";
            if (thresholds.Split(',').Any(t => !int.TryParse(t, out var n) || n is < 1 or > 100)) throw ApiException.Invalid("thresholds must be comma-separated percentages 1-100.");
            return Results.Json(await uow.Run(async () =>
            {
                var b = new CustomerBudget { Id = Ids.New("bud"), CreatedAt = uow.Now, CustomerId = customer, EventName = r.EventName ?? "*", MonthlyLimit = r.MonthlyLimit, Mode = r.Mode ?? "soft", ThresholdsCsv = thresholds };
                db.CustomerBudgets.Add(b);
                uow.Audit("budget.create", "customer_budget", b.Id, after: new { customer, b.EventName, b.MonthlyLimit, b.Mode });
                await Task.CompletedTask;
                return b;
            }), statusCode: 201);
        });
        bud.MapDelete("/{id}", async (string customer, string id, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("usage.write");
            await uow.Run(async () =>
            {
                var b = await db.CustomerBudgets.FirstOrDefaultAsync(x => x.Id == id && x.CustomerId == customer) ?? throw ApiException.NotFound("budget");
                b.Active = false;
                uow.Audit("budget.disable", "customer_budget", b.Id);
            });
            return Results.NoContent();
        });

        // ───────── Finance reports (§99, §258, §259, §263) ─────────
        var rep = app.MapGroup("/v1/reports").WithTags("Reports");
        rep.MapGet("/revenue_recognition", async (HttpRequest req, RequestContext ctx, AccountingReports reports, AppDb db) =>
        {
            var orgId = ctx.RequireOrg("reports.read");
            var month = DateTime.TryParse(req.Query["month"] + "-01", out var m) ? DateTime.SpecifyKind(m, DateTimeKind.Utc) : new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
            var currency = req.Query["currency"].FirstOrDefault() ?? (await db.Organizations.FirstAsync(o => o.Id == orgId)).DefaultCurrency;
            return await reports.RevenueRecognition(month, Money.Normalize(currency));
        });
        rep.MapGet("/journal", async (HttpRequest req, RequestContext ctx, AccountingReports reports) =>
        {
            ctx.RequireOrg("ledger.read");
            var (from, to) = Period(req);
            var lines = await reports.Journal(from, to);
            var byJournal = lines.GroupBy(l => (l.JournalId, l.Currency)).ToList();
            return new
            {
                @object = "journal", period_start = from, period_end = to, lines,
                balanced = byJournal.All(g => g.Sum(l => l.Debit) == g.Sum(l => l.Credit)),
                trial_balance = lines.GroupBy(l => new { l.Account, l.Currency }).Select(g => new { g.Key.Account, g.Key.Currency, debit = g.Sum(l => l.Debit), credit = g.Sum(l => l.Credit) }),
                format_note = "Generic double-entry journal. Map the account names to your chart of accounts when importing into QuickBooks, Xero, NetSuite or another ERP.",
            };
        });
        rep.MapGet("/journal.csv", async (HttpRequest req, RequestContext ctx, AccountingReports reports) =>
        {
            ctx.RequireOrg("ledger.read");
            var (from, to) = Period(req);
            var lines = await reports.Journal(from, to);
            return Results.Text(Csv.Write(lines, ("date", l => l.Date.ToString("yyyy-MM-dd")), ("journal_id", l => l.JournalId), ("account", l => l.Account), ("debit", l => Major(l.Debit, l.Currency)),
                ("credit", l => Major(l.Credit, l.Currency)), ("currency", l => l.Currency), ("memo", l => l.Memo), ("source_type", l => l.SourceType), ("source_id", l => l.SourceId)), "text/csv");
        });
        rep.MapGet("/cohorts", async (HttpRequest req, RequestContext ctx, AccountingReports reports, AppDb db) =>
        {
            var orgId = ctx.RequireOrg("analytics.read");
            var currency = req.Query["currency"].FirstOrDefault() ?? (await db.Organizations.FirstAsync(o => o.Id == orgId)).DefaultCurrency;
            return await reports.Cohorts(int.TryParse(req.Query["months"], out var n) ? Math.Clamp(n, 1, 24) : 12, Money.Normalize(currency));
        });
        rep.MapGet("/churn", async (HttpRequest req, RequestContext ctx, AccountingReports reports, AppDb db) =>
        {
            var orgId = ctx.RequireOrg("analytics.read");
            var (from, to) = Period(req);
            var currency = req.Query["currency"].FirstOrDefault() ?? (await db.Organizations.FirstAsync(o => o.Id == orgId)).DefaultCurrency;
            return await reports.Churn(from, to, Money.Normalize(currency));
        });

        // ───────── Checkout experiments (§108) ─────────
        var exp = app.MapGroup("/v1/experiments").WithTags("Experiments");
        exp.MapGet("/", async (HttpRequest req, RequestContext ctx, AppDb db) => { ctx.RequireOrg("analytics.read"); return await Paging.List(db.Experiments, req); });
        exp.MapPost("/", async (ExperimentRequest r, RequestContext ctx, AppDb db, Uow uow, Modules.Operations.FlagService flags) =>
        {
            await flags.Require("experiments", ctx.RequireOrg("checkout.write"));
            var link = await db.PaymentLinks.FirstOrDefaultAsync(l => l.Id == r.PaymentLink) ?? throw ApiException.NotFound("payment link");
            if (r.Variants.Count is < 2 or > 5) throw ApiException.Invalid("An experiment needs 2-5 variants; the first is the control.");
            if (r.Variants.Select(v => v.Key).Distinct().Count() != r.Variants.Count || r.Variants.Any(v => string.IsNullOrWhiteSpace(v.Key) || v.Weight < 1))
                throw ApiException.Invalid("Variant keys must be unique and weights positive.");
            var basePrice = await db.Prices.FirstAsync(p => p.Id == link.PriceId);
            foreach (var v in r.Variants)
            {
                if (v.PriceId != null)
                {
                    var p = await db.Prices.FirstOrDefaultAsync(x => x.Id == v.PriceId && x.Active) ?? throw ApiException.NotFound($"price {v.PriceId}");
                    if (p.Type != basePrice.Type) throw ApiException.Invalid("Variant prices must have the same type (one-time vs recurring) as the link price.");
                }
                v.CouponCode = v.CouponCode?.ToUpperInvariant();
                if (v.CouponCode != null && !await db.Coupons.AnyAsync(c => c.Code == v.CouponCode && c.Active)) throw ApiException.NotFound($"coupon {v.CouponCode}");
            }
            return Results.Json(await uow.Run(async () =>
            {
                var e = new Experiment { Id = Ids.New("exp"), CreatedAt = uow.Now, Name = r.Name, PaymentLinkId = link.Id, VariantsJson = Json.Serialize(r.Variants), Hypothesis = r.Hypothesis };
                db.Experiments.Add(e);
                uow.Audit("experiment.create", "experiment", e.Id, after: new { r.Name, link = link.Id, variants = r.Variants.Count });
                await Task.CompletedTask;
                return e;
            }), statusCode: 201);
        });
        exp.MapPost("/{id}/start", async (string id, RequestContext ctx, AppDb db, Uow uow, Modules.Operations.FlagService flags) =>
        {
            await flags.Require("experiments", ctx.RequireOrg("checkout.write"));
            return await uow.Run(async () =>
            {
                var e = await db.Experiments.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("experiment");
                if (e.Status != "draft") throw ApiException.Conflict("invalid_state", $"Experiment is {e.Status}.");
                if (await db.Experiments.AnyAsync(x => x.PaymentLinkId == e.PaymentLinkId && x.Status == "running")) throw ApiException.Conflict("experiment_running", "Another experiment is already running on this link.");
                e.Status = "running";
                e.StartedAt = uow.Now;
                uow.Audit("experiment.start", "experiment", e.Id);
                return e;
            });
        });
        exp.MapPost("/{id}/stop", async (string id, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("checkout.write");
            return await uow.Run(async () =>
            {
                var e = await db.Experiments.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("experiment");
                e.Status = "stopped";
                e.StoppedAt = uow.Now;
                uow.Audit("experiment.stop", "experiment", e.Id);
                return e;
            });
        });
        exp.MapGet("/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("analytics.read");
            var e = await db.Experiments.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("experiment");
            var prefix = e.Id + ":";
            var sessions = await db.CheckoutSessions.Where(s => s.ExperimentVariant != null && s.ExperimentVariant.StartsWith(prefix)).ToListAsync();
            var paymentIds = sessions.Where(s => s.PaymentId != null).Select(s => s.PaymentId).ToList();
            var payments = await db.Payments.Where(p => paymentIds.Contains(p.Id) && p.AmountCaptured > 0).ToDictionaryAsync(p => p.Id);
            var rows = e.Variants.Select(v =>
            {
                var mine = sessions.Where(s => s.ExperimentVariant == prefix + v.Key).ToList();
                var converted = mine.Count(s => s.Status == "complete");
                var revenue = mine.Where(s => s.PaymentId != null && payments.ContainsKey(s.PaymentId)).Sum(s => payments[s.PaymentId!].Amount - payments[s.PaymentId!].TaxAmount);
                return (Variant: v, Visits: mine.Count, Converted: converted, Revenue: revenue);
            }).ToList();
            var control = rows[0];
            return new
            {
                experiment = e,
                results = rows.Select(r => new
                {
                    variant = r.Variant.Key, price_id = r.Variant.PriceId, coupon_code = r.Variant.CouponCode, visits = r.Visits, conversions = r.Converted,
                    conversion_rate_pct = r.Visits == 0 ? 0 : Math.Round(r.Converted * 100.0 / r.Visits, 2),
                    revenue_excluding_tax = r.Revenue, revenue_per_visit = r.Visits == 0 ? 0 : r.Revenue / r.Visits,
                    lift_vs_control_pct = r.Variant.Key == control.Variant.Key || control.Visits == 0 || control.Converted == 0 ? (double?)null
                        : Math.Round(((double)r.Converted / Math.Max(1, r.Visits) / ((double)control.Converted / control.Visits) - 1) * 100, 1),
                    p_value = r.Variant.Key == control.Variant.Key ? null : TwoProportionP(control.Converted, control.Visits, r.Converted, r.Visits),
                }),
                reading_guide = "p < 0.05 suggests the difference is unlikely to be chance. Fix the sample size before starting and avoid stopping as soon as a result looks significant.",
            };
        });

        // ───────── Privacy (§74, §299) ─────────
        app.MapGet("/v1/customers/{id}/export", async (string id, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("customers.read");
            var c = await db.Customers.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("customer");
            var export = new
            {
                @object = "customer_data_export", generated_at = uow.Now, customer = c,
                payment_methods = await db.PaymentMethods.Where(p => p.CustomerId == id).Select(p => new { p.Id, p.Type, p.Brand, p.Last4, p.ExpMonth, p.ExpYear, p.CreatedAt }).ToListAsync(),
                orders = await db.Orders.Where(o => o.CustomerId == id).ToListAsync(),
                payments = await db.Payments.Where(p => p.CustomerId == id).ToListAsync(),
                subscriptions = await db.Subscriptions.Where(s => s.CustomerId == id).ToListAsync(),
                invoices = await db.Invoices.Where(i => i.CustomerId == id).ToListAsync(),
                entitlements = await db.Entitlements.Where(e => e.CustomerId == id).ToListAsync(),
                credit_ledger = await db.CreditLedger.Where(e => e.CustomerId == id).ToListAsync(),
                usage_by_event = await db.UsageEvents.Where(u => u.CustomerId == id).GroupBy(u => u.EventName).Select(g => new { event_name = g.Key, quantity = g.Sum(x => x.Quantity), events = g.Count() }).ToListAsync(),
                note = "Card numbers are never held by the platform; only brand, last 4 digits and expiry are stored.",
            };
            await uow.Run(async () => { uow.Audit("customer.export", "customer", id, reason: "data subject access"); await Task.CompletedTask; });
            return export;
        }).WithTags("Catalog & Customers");
        app.MapGet("/v1/me/export", async (RequestContext ctx, AppDb db, Uow uow) =>
        {
            var u = ctx.RequireUser();
            var wallet = await db.Wallets.FirstOrDefaultAsync(w => w.OwnerType == "user" && w.OwnerId == u.Id);
            var export = new
            {
                @object = "user_data_export", generated_at = uow.Now, user = u,
                sessions = await db.Sessions.Where(s => s.UserId == u.Id).Select(s => new { s.CreatedAt, s.Ip, s.UserAgent, s.RevokedAt }).ToListAsync(),
                devices = await db.Devices.Where(d => d.UserId == u.Id).ToListAsync(),
                security_events = await db.SecurityEvents.Where(e => e.UserId == u.Id).ToListAsync(),
                kyc_checks = await db.KycChecks.Where(k => k.UserId == u.Id).Select(k => new { k.CreatedAt, k.LevelRequested, k.DocumentType, k.Result }).ToListAsync(),
                wallet,
                transfers = wallet == null ? null : await db.Transfers.Where(t => t.SenderWalletId == wallet.Id || t.RecipientWalletId == wallet.Id)
                    .Select(t => new { t.Id, t.Type, t.Status, t.SourceAmount, t.SourceCurrency, t.DestinationAmount, t.DestinationCurrency, t.FeeAmount, t.CustomerMessage, t.CreatedAt }).ToListAsync(),
                bank_accounts = await db.BankAccounts.Where(b => b.OwnerId == u.Id).Select(b => new { b.Id, b.BankName, b.Country, b.Currency, b.Last4, b.CreatedAt, b.RemovedAt }).ToListAsync(),
                notifications = await db.Notifications.Where(n => n.UserId == u.Id).ToListAsync(),
                memberships = await db.Memberships.Where(m => m.UserId == u.Id).ToListAsync(),
            };
            await uow.Run(async () => { uow.Audit("user.export", "user", u.Id, reason: "data subject access"); await Task.CompletedTask; });
            return export;
        }).WithTags("Me");
    }

    /// <summary>Two-sided two-proportion z-test.</summary>
    public static double? TwoProportionP(int c1, int n1, int c2, int n2)
    {
        if (n1 < 1 || n2 < 1) return null;
        var p = (double)(c1 + c2) / (n1 + n2);
        var se = Math.Sqrt(p * (1 - p) * (1.0 / n1 + 1.0 / n2));
        if (se == 0) return null;
        var z = Math.Abs((double)c1 / n1 - (double)c2 / n2) / se;
        return Math.Round(2 * (1 - NormalCdf(z)), 4);
    }

    private static double NormalCdf(double x)
    {
        // Abramowitz-Stegun 7.1.26 erf approximation (~1e-7), ample for reporting.
        var u = x / Math.Sqrt(2);
        var t = 1 / (1 + 0.3275911 * u);
        var erf = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.Exp(-u * u);
        return 0.5 * (1 + erf);
    }

    private static async Task<object> Link(StoredFile f, FileService store, Uow uow)
    {
        var (token, expires) = store.SignLink(f, TimeSpan.FromMinutes(5));
        await uow.Run(async () => { uow.Audit("file.link", "file", f.Id, orgId: f.OrgId); await Task.CompletedTask; });
        return new { @object = "file_link", url = $"/v1/files/download/{token}", expires_at = expires, file = f };
    }

    private static (DateTime, DateTime) Period(HttpRequest req)
    {
        var to = Paging.Date(req, "to") ?? DateTime.UtcNow.AddMinutes(1);
        return (Paging.Date(req, "from") ?? to.AddDays(-30), to);
    }

    private static string Major(long minor, string currency)
    {
        if (minor == 0) return "";
        var exp = Money.Info(currency).Exponent;
        var div = (long)Math.Pow(10, exp);
        return exp == 0 ? minor.ToString() : $"{minor / div}.{(minor % div).ToString().PadLeft(exp, '0')}";
    }
}
