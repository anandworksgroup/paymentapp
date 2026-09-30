using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Billing;
using PaymentApp.Api.Modules.Ledger;
using PaymentApp.Api.Modules.Payments;
using PaymentApp.Api.Modules.Payouts;
using PaymentApp.Api.Modules.Reports;
using PaymentApp.Api.Modules.Wallet;

namespace PaymentApp.Api.Endpoints;

public record RefundRequest(string Payment, long? Amount, string? Reason);
public record EvidenceItem(string Type, string Text, string? FileId = null);
public record EvidenceRequest(List<EvidenceItem> Evidence, bool Submit);
public record ReviewRequest(bool Approve, string? Note);
public record SubscriptionRequest(string Customer, List<SubItem> Items, string? PaymentMethod, string? Coupon, int? TrialDays, string? CollectionMethod, int? DaysUntilDue,
    string? TestClock, Dictionary<string, string>? Metadata);
public record SubItem(string Price, long Quantity = 1);
public record ChangePlanRequest(string Price, long Quantity = 1, bool Preview = false);
public record CancelRequest(bool AtPeriodEnd = true, string? Reason = null);
public record InvoiceRequest(string Customer, string Currency, List<InvoiceLineRequest> Lines, int? DaysUntilDue, string? PurchaseOrder, string? Memo, bool AutoFinalize = true);
public record UsageRequest(string Customer, string EventName, long Quantity, DateTime? Timestamp, string IdempotencyKey, string? CorrectsEventId);
public record UsageBatch(List<UsageRequest> Events);
public record CreditRequest(string Customer, string Operation, long Amount, string? CreditType, string? IdempotencyKey, string? Description);
public record ClockRequest(DateTime FrozenTime, string? Name);
public record PayoutRequest(string Currency, long? Amount);
public record WalletMoveRequest(string Currency, long Amount);

public static class MoneyEndpoints
{
    public static void Map(WebApplication app)
    {
        var pay = app.MapGroup("/v1").WithTags("Payments");
        pay.MapGet("/payments", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("payments.read");
            var q = db.Payments.AsQueryable();
            if (req.Query["status"].FirstOrDefault() is { } s) q = q.Where(p => p.Status == s);
            if (req.Query["customer"].FirstOrDefault() is { } c) q = q.Where(p => p.CustomerId == c);
            if (req.Query["country"].FirstOrDefault() is { } co) q = q.Where(p => p.Country == co);
            if (req.Query["currency"].FirstOrDefault() is { } cu) q = q.Where(p => p.Currency == cu);
            if (req.Query["method"].FirstOrDefault() is { } m) q = q.Where(p => p.PaymentMethodType == m);
            if (req.Query["provider"].FirstOrDefault() is { } pr) q = q.Where(p => p.ProviderId == pr);
            if (req.Query["review"].FirstOrDefault() is { } rv) q = q.Where(p => p.ReviewStatus == rv);
            if (Paging.Date(req, "from") is { } from) q = q.Where(p => p.CreatedAt >= from);
            if (Paging.Date(req, "to") is { } to) q = q.Where(p => p.CreatedAt < to);
            if (req.Query["search"].FirstOrDefault() is { Length: > 2 } term) q = q.Where(p => p.Id == term || p.CustomerEmail == term.ToLower() || p.Last4 == term || p.OrderId == term || p.InvoiceId == term);
            return await Paging.List(q, req);
        });
        pay.MapGet("/payments/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("payments.read");
            var p = await db.Payments.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("payment");
            var ledgerTxns = await db.LedgerTransactions.Where(t => t.SourceId == id || (t.SourceType == "refund" && db.Refunds.Where(r => r.PaymentId == id).Select(r => r.Id).Contains(t.SourceId))
                                                                     || (t.SourceType == "dispute" && db.Disputes.Where(d => d.PaymentId == id).Select(d => d.Id).Contains(t.SourceId))).ToListAsync();
            var txIds = ledgerTxns.Select(t => t.Id).ToList();
            var entries = await db.LedgerEntries.Where(e => txIds.Contains(e.TransactionId)).ToListAsync();
            var accounts = await db.LedgerAccounts.Where(a => entries.Select(e => e.AccountId).Contains(a.Id)).ToDictionaryAsync(a => a.Id);
            return new
            {
                payment = p,
                fee_breakdown = new { customer_paid = p.AmountCaptured, tax = p.TaxAmount, platform_fee = p.FeeAmount, refunded = p.AmountRefunded, disputed = p.AmountDisputed, net_to_merchant = p.NetAmount - (p.AmountRefunded == 0 ? 0 : p.AmountRefunded - Money.Ratio(p.TaxAmount, p.AmountRefunded, Math.Max(1, p.Amount), p.Currency)), currency = p.Currency },
                attempts = await db.PaymentAttempts.Where(a => a.PaymentId == id).OrderBy(a => a.CreatedAt).ToListAsync(),
                refunds = await db.Refunds.Where(r => r.PaymentId == id).OrderBy(r => r.CreatedAt).ToListAsync(),
                disputes = await db.Disputes.Where(d => d.PaymentId == id).ToListAsync(),
                order = p.OrderId == null ? null : await db.Orders.FirstOrDefaultAsync(o => o.Id == p.OrderId),
                customer = p.CustomerId == null ? null : await db.Customers.FirstOrDefaultAsync(c => c.Id == p.CustomerId),
                timeline = await db.StateTransitions.Where(t => t.ObjectId == id || txIds.Contains(t.ObjectId)).OrderBy(t => t.CreatedAt).ToListAsync(),
                ledger = ledgerTxns.OrderBy(t => t.CreatedAt).Select(t => new
                {
                    t.Id, t.Type, t.Description, t.CreatedAt,
                    entries = entries.Where(e => e.TransactionId == t.Id).Select(e => new { account = accounts[e.AccountId].Code, owner = accounts[e.AccountId].OwnerType, e.Direction, e.Amount, e.Currency }),
                }),
                events = await db.Events.Where(e => e.ObjectId == id).OrderBy(e => e.Sequence).Select(e => new { e.Id, e.Type, e.CreatedAt }).ToListAsync(),
            };
        });
        pay.MapPost("/payments/{id}/review", async (string id, ReviewRequest r, RequestContext ctx, AppDb db, Uow uow, PaymentService payments) =>
        {
            ctx.RequireOrg("payments.refund");
            var p = await db.Payments.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("payment");
            if (p.ReviewStatus != "pending") throw ApiException.Conflict("not_in_review", "This payment is not awaiting review.");
            if (!r.Approve)
            {
                await uow.Run(async () => { p.ReviewStatus = "declined"; uow.Audit("payment.review_decline", "payment", p.Id, reason: r.Note); await Task.CompletedTask; });
                await payments.CreateRefund(p.Id, null, "fraudulent");
                return await db.Payments.FirstAsync(x => x.Id == id);
            }
            return await uow.Run(async () =>
            {
                p.ReviewStatus = "approved";
                foreach (var t in await db.BalanceTransactions.Where(t => t.SourceId == p.Id && t.HeldForReview).ToListAsync()) t.HeldForReview = false;
                uow.Audit("payment.review_approve", "payment", p.Id, reason: r.Note);
                uow.Emit("payment.review_approved", p);
                return p;
            });
        });
        pay.MapPost("/refunds", async (RefundRequest r, RequestContext ctx, PaymentService payments, AppDb db, IConfiguration config, IClock clock) =>
        {
            ctx.RequireOrg("payments.refund");
            var p = await db.Payments.FirstOrDefaultAsync(x => x.Id == r.Payment) ?? throw ApiException.NotFound("payment");
            // Large refunds need a recently re-authenticated user (§201).
            var threshold = config.GetValue<long>("Risk:RefundStepUpUsdMinor", 100_000);
            if (FxTable.ToUsd(r.Amount ?? p.Amount, p.Currency) >= threshold && ctx.ApiKey == null) ctx.RequireStepUp(clock);
            return Results.Json(await payments.CreateRefund(r.Payment, r.Amount, r.Reason), statusCode: 201);
        }).RequireRateLimiting("financial");
        pay.MapGet("/refunds", async (HttpRequest req, RequestContext ctx, AppDb db) => { ctx.RequireOrg("payments.read"); return await Paging.List(db.Refunds, req); });
        pay.MapGet("/refunds/{id}", async (string id, RequestContext ctx, AppDb db) => { ctx.RequireOrg("payments.read"); return await db.Refunds.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("refund"); });
        pay.MapGet("/disputes", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("disputes.read");
            var q = db.Disputes.AsQueryable();
            if (req.Query["status"].FirstOrDefault() is { } s) q = q.Where(d => d.Status == s);
            return await Paging.List(q, req);
        });
        pay.MapGet("/disputes/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("disputes.read");
            var d = await db.Disputes.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("dispute");
            var p = await db.Payments.FirstAsync(x => x.Id == d.PaymentId);
            var order = p.OrderId == null ? null : await db.Orders.FirstOrDefaultAsync(o => o.Id == p.OrderId);
            return new
            {
                dispute = d, payment = p, evidence = await db.DisputeEvidence.Where(e => e.DisputeId == id).OrderBy(e => e.CreatedAt).ToListAsync(),
                // Pre-assembled evidence the platform already holds (§37): purchase, terms, usage, IP, receipt.
                suggested_evidence = new
                {
                    purchase = new { p.Id, p.CreatedAt, p.Amount, p.Currency, p.CustomerEmail, p.CardBrand, p.Last4, p.ThreeDsResult },
                    terms_accepted = order?.AcceptedTermsVersion, ip = p.Ip,
                    entitlements = await db.Entitlements.Where(e => e.SourceId == p.OrderId || e.SourceId == p.InvoiceId).ToListAsync(),
                    usage_events = p.CustomerId == null ? 0 : await db.UsageEvents.CountAsync(u => u.CustomerId == p.CustomerId),
                },
            };
        });
        pay.MapPost("/disputes/{id}/evidence", async (string id, EvidenceRequest r, RequestContext ctx, PaymentService payments, AppDb db) =>
        {
            ctx.RequireOrg("disputes.write");
            foreach (var e in r.Evidence.Where(e => e.FileId != null))
                if (!await db.Files.AnyAsync(f => f.Id == e.FileId && f.OrgId == ctx.OrgId && f.Livemode == ctx.Livemode && f.Purpose == "dispute_evidence"))
                    throw ApiException.Invalid($"File {e.FileId} is not a dispute_evidence upload of this account.");
            return await payments.SubmitEvidence(id, r.Evidence.Select(e => (e.Type, e.Text, e.FileId)), r.Submit);
        });
        pay.MapGet("/orders", async (HttpRequest req, RequestContext ctx, AppDb db) => { ctx.RequireOrg("payments.read"); return await Paging.List(db.Orders, req); });
        pay.MapGet("/orders/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("payments.read");
            var o = await db.Orders.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("order");
            return new { order = o, payments = await db.Payments.Where(p => p.OrderId == id).OrderBy(p => p.CreatedAt).ToListAsync() };
        });
        // Provider → platform webhooks (§227): authenticated by the provider's signature, not merchant credentials.
        app.MapPost("/v1/providers/{providerId}/webhooks", async (string providerId, HttpRequest req, PaymentService payments) =>
        {
            using var reader = new StreamReader(req.Body);
            var body = await reader.ReadToEndAsync();
            var pe = await payments.HandleProviderWebhook(providerId, body, req.Headers["Provider-Signature"].ToString());
            return new { received = true, id = pe.Id, status = pe.Status };
        }).WithTags("Providers");

        // ───────── Billing ─────────
        var bill = app.MapGroup("/v1").WithTags("Billing");
        bill.MapGet("/subscriptions", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("subscriptions.read");
            var q = db.Subscriptions.AsQueryable();
            if (req.Query["status"].FirstOrDefault() is { } s) q = q.Where(x => x.Status == s);
            if (req.Query["customer"].FirstOrDefault() is { } c) q = q.Where(x => x.CustomerId == c);
            return await Paging.List(q, req);
        });
        bill.MapGet("/subscriptions/{id}", async (string id, RequestContext ctx, AppDb db, CreditService credits) =>
        {
            ctx.RequireOrg("subscriptions.read");
            var s = await db.Subscriptions.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("subscription");
            var items = await db.SubscriptionItems.Where(i => i.SubscriptionId == id && !i.Deleted).ToListAsync();
            var prices = await db.Prices.Where(p => items.Select(i => i.PriceId).Contains(p.Id)).ToListAsync();
            var meterNames = await db.Meters.Where(m => prices.Select(p => p.MeterId).Contains(m.Id)).Select(m => m.EventName).ToListAsync();
            return new
            {
                subscription = s, items, prices, customer = await db.Customers.FirstOrDefaultAsync(c => c.Id == s.CustomerId),
                invoices = await db.Invoices.Where(i => i.SubscriptionId == id).OrderByDescending(i => i.CreatedAt).ToListAsync(),
                current_usage = await db.UsageEvents.Where(u => u.CustomerId == s.CustomerId && meterNames.Contains(u.EventName) && u.InvoiceId == null)
                    .GroupBy(u => u.EventName).Select(g => new { event_name = g.Key, quantity = g.Sum(x => x.Quantity) }).ToListAsync(),
                credits = (await credits.Balance(s.CustomerId, "credits")).Available,
                timeline = await db.StateTransitions.Where(t => t.ObjectId == id).OrderBy(t => t.CreatedAt).ToListAsync(),
            };
        });
        bill.MapPost("/subscriptions", async (SubscriptionRequest r, RequestContext ctx, BillingService billing) =>
        {
            ctx.RequireOrg("subscriptions.write");
            var s = await billing.Create(r.Customer, r.Items.Select(i => (i.Price, i.Quantity)).ToList(), r.PaymentMethod, r.Coupon, r.TrialDays,
                r.CollectionMethod ?? "charge_automatically", r.DaysUntilDue ?? 30, r.TestClock, r.Metadata == null ? null : Json.Serialize(r.Metadata));
            return Results.Json(s, statusCode: 201);
        });
        bill.MapPost("/subscriptions/{id}/change", async (string id, ChangePlanRequest r, RequestContext ctx, BillingService billing) =>
        {
            ctx.RequireOrg("subscriptions.write");
            return await billing.ChangePlan(id, r.Price, r.Quantity, r.Preview);
        });
        bill.MapPost("/subscriptions/{id}/cancel", async (string id, CancelRequest r, RequestContext ctx, BillingService billing) => { ctx.RequireOrg("subscriptions.write"); return await billing.Cancel(id, r.AtPeriodEnd, r.Reason); });
        bill.MapPost("/subscriptions/{id}/pause", async (string id, RequestContext ctx, BillingService billing) => { ctx.RequireOrg("subscriptions.write"); return await billing.Pause(id, true); });
        bill.MapPost("/subscriptions/{id}/resume", async (string id, RequestContext ctx, BillingService billing) => { ctx.RequireOrg("subscriptions.write"); return await billing.Pause(id, false); });

        bill.MapGet("/invoices", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("invoices.read");
            var q = db.Invoices.AsQueryable();
            if (req.Query["status"].FirstOrDefault() is { } s) q = q.Where(x => x.Status == s);
            if (req.Query["customer"].FirstOrDefault() is { } c) q = q.Where(x => x.CustomerId == c);
            if (req.Query["subscription"].FirstOrDefault() is { } sub) q = q.Where(x => x.SubscriptionId == sub);
            return await Paging.List(q, req);
        });
        bill.MapGet("/invoices/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("invoices.read");
            var inv = await db.Invoices.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("invoice");
            return new
            {
                invoice = inv, lines = await db.InvoiceLines.Where(l => l.InvoiceId == id).OrderBy(l => l.Sort).ToListAsync(),
                credit_notes = await db.CreditNotes.Where(c => c.InvoiceId == id).ToListAsync(),
                payments = await db.Payments.Where(p => p.InvoiceId == id).OrderBy(p => p.CreatedAt).ToListAsync(),
                calculation_inputs = Json.Raw(inv.CalculationInputsJson),
                tax_records = await db.TaxRecords.Where(t => t.InvoiceId == id).ToListAsync(),
            };
        });
        bill.MapPost("/invoices", async (InvoiceRequest r, RequestContext ctx, BillingService billing) =>
        {
            ctx.RequireOrg("invoices.write");
            return Results.Json(await billing.CreateManualInvoice(r.Customer, r.Lines, r.Currency, r.DaysUntilDue ?? 30, r.PurchaseOrder, r.Memo, r.AutoFinalize), statusCode: 201);
        });
        bill.MapPost("/invoices/{id}/finalize", async (string id, RequestContext ctx, BillingService billing) => { ctx.RequireOrg("invoices.write"); return await billing.FinalizeInvoice(id); });
        bill.MapPost("/invoices/{id}/pay", async (string id, RequestContext ctx, AppDb db, BillingService billing) =>
        {
            ctx.RequireOrg("invoices.write");
            var inv = await db.Invoices.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("invoice");
            var p = await billing.ChargeInvoice(inv, offSession: true);
            return new { invoice = await db.Invoices.FirstAsync(x => x.Id == id), payment = p };
        }).RequireRateLimiting("financial");
        bill.MapPost("/invoices/{id}/void", async (string id, RequestContext ctx, BillingService billing) => { ctx.RequireOrg("invoices.write"); return await billing.VoidInvoice(id, false); });
        bill.MapPost("/invoices/{id}/mark_uncollectible", async (string id, RequestContext ctx, BillingService billing) => { ctx.RequireOrg("invoices.write"); return await billing.VoidInvoice(id, true); });
        bill.MapGet("/invoices/{id}/pdf", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("invoices.read");
            var inv = await db.Invoices.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("invoice");
            var bytes = await InvoicePdf.Render(db, inv);
            return Results.File(bytes, "application/pdf", $"{inv.Number}.pdf");
        });

        // Usage ingestion (§28, §29): idempotent per key, late events billed on the next invoice.
        bill.MapPost("/usage_events", async (UsageRequest r, RequestContext ctx, AppDb db, Uow uow, Modules.Growth.BudgetService budgets) =>
        {
            ctx.RequireOrg("usage.write");
            var result = await IngestUsage(db, uow, [r], budgets);
            if (result[0].Rejected is { } why) throw new ApiException(402, "usage_limit_exceeded", why);
            return Results.Json(result[0], statusCode: 201);
        });
        bill.MapPost("/usage_events/batch", async (UsageBatch b, RequestContext ctx, AppDb db, Uow uow, Modules.Growth.BudgetService budgets) =>
        {
            ctx.RequireOrg("usage.write");
            if (b.Events.Count is 0 or > 1000) throw ApiException.Invalid("A batch holds 1-1000 events.");
            var results = await IngestUsage(db, uow, b.Events, budgets);
            return new
            {
                @object = "list", accepted = results.Count(x => !x.Duplicate && x.Rejected == null), duplicates = results.Count(x => x.Duplicate),
                rejected = results.Count(x => x.Rejected != null), data = results,
            };
        });
        bill.MapGet("/usage/summary", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("usage.read");
            var q = db.UsageEvents.AsQueryable();
            if (req.Query["customer"].FirstOrDefault() is { } c) q = q.Where(u => u.CustomerId == c);
            if (req.Query["event_name"].FirstOrDefault() is { } e) q = q.Where(u => u.EventName == e);
            if (Paging.Date(req, "from") is { } from) q = q.Where(u => u.Timestamp >= from);
            if (Paging.Date(req, "to") is { } to) q = q.Where(u => u.Timestamp < to);
            var rows = await q.ToListAsync();
            return new
            {
                @object = "usage_summary",
                by_event = rows.GroupBy(u => u.EventName).Select(g => new { event_name = g.Key, quantity = g.Sum(x => x.Quantity), events = g.Count(), unbilled = g.Where(x => x.InvoiceId == null).Sum(x => x.Quantity) }),
                by_day = rows.GroupBy(u => u.Timestamp.Date).OrderBy(g => g.Key).Select(g => new { date = g.Key.ToString("yyyy-MM-dd"), quantity = g.Sum(x => x.Quantity) }),
            };
        });
        bill.MapGet("/credits/{customer}", async (string customer, HttpRequest req, RequestContext ctx, AppDb db, CreditService credits) =>
        {
            ctx.RequireOrg("credits.read");
            var type = req.Query["credit_type"].FirstOrDefault() ?? "credits";
            var (available, reserved) = await credits.Balance(customer, type);
            return new { @object = "credit_balance", customer, credit_type = type, available, reserved, entries = await db.CreditLedger.Where(e => e.CustomerId == customer && e.CreditType == type).OrderByDescending(e => e.CreatedAt).Take(50).ToListAsync() };
        });
        bill.MapPost("/credits", async (CreditRequest r, RequestContext ctx, AppDb db, CreditService credits) =>
        {
            ctx.RequireOrg("credits.write");
            _ = await db.Customers.FirstOrDefaultAsync(c => c.Id == r.Customer) ?? throw ApiException.NotFound("customer");
            return await credits.Apply(r.Customer, r.CreditType ?? "credits", r.Operation, r.Amount, r.IdempotencyKey, "api", null, r.Description);
        }).RequireRateLimiting("financial");
        bill.MapGet("/entitlements", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("customers.read");
            var q = db.Entitlements.AsQueryable();
            if (req.Query["customer"].FirstOrDefault() is { } c) q = q.Where(e => e.CustomerId == c);
            if (req.Query["status"].FirstOrDefault() is { } s) q = q.Where(e => e.Status == s);
            return await Paging.List(q, req);
        });
        bill.MapPost("/test_clocks", async (ClockRequest r, RequestContext ctx, AppDb db, Uow uow) =>
        {
            ctx.RequireOrg("subscriptions.write");
            if (ctx.Livemode) throw ApiException.Invalid("Test clocks exist only in test mode.");
            return Results.Json(await uow.Run(async () =>
            {
                var c = new TestClock { Id = Ids.New("clock"), CreatedAt = uow.Now, Name = r.Name ?? "Test clock", FrozenTime = DateTime.SpecifyKind(r.FrozenTime, DateTimeKind.Utc) };
                db.TestClocks.Add(c);
                await Task.CompletedTask;
                return c;
            }), statusCode: 201);
        });
        bill.MapPost("/test_clocks/{id}/advance", async (string id, ClockRequest r, RequestContext ctx, AppDb db, BillingService billing) =>
        {
            ctx.RequireOrg("subscriptions.write");
            var c = await db.TestClocks.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("test clock");
            return await billing.AdvanceClock(c, DateTime.SpecifyKind(r.FrozenTime, DateTimeKind.Utc));
        });
        bill.MapGet("/test_clocks/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("subscriptions.read");
            return await db.TestClocks.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("test clock");
        });

        // ───────── Finance ─────────
        var fin = app.MapGroup("/v1").WithTags("Finance");
        fin.MapGet("/balance", async (RequestContext ctx, TreasuryService treasury) => await treasury.Balance(ctx.RequireOrg("balance.read"), ctx.Livemode));
        fin.MapGet("/balance_transactions", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("balance.read");
            var q = db.BalanceTransactions.AsQueryable();
            if (req.Query["type"].FirstOrDefault() is { } t) q = q.Where(x => x.Type == t);
            if (req.Query["payout"].FirstOrDefault() is { } p) q = q.Where(x => x.PayoutId == p);
            return await Paging.List(q, req);
        });
        fin.MapPost("/balance/transfer_to_wallet", async (WalletMoveRequest r, RequestContext ctx, WalletService wallet, IClock clock) =>
        {
            var orgId = ctx.RequireOrg("wallet.transfer");
            ctx.RequireStepUp(clock);
            return await wallet.MoveMerchantProceeds(orgId, ctx.Livemode, r.Currency, r.Amount);
        }).RequireRateLimiting("financial");
        fin.MapGet("/payouts", async (HttpRequest req, RequestContext ctx, AppDb db) => { ctx.RequireOrg("payouts.read"); return await Paging.List(db.Payouts, req); });
        fin.MapGet("/payouts/{id}", async (string id, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("payouts.read");
            var p = await db.Payouts.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("payout");
            return new
            {
                payout = p, destination = await db.PayoutDestinations.FirstOrDefaultAsync(d => d.Id == p.DestinationId),
                balance_transactions = await db.BalanceTransactions.Where(t => t.PayoutId == id).OrderBy(t => t.CreatedAt).ToListAsync(),
                timeline = await db.StateTransitions.Where(t => t.ObjectId == id).OrderBy(t => t.CreatedAt).ToListAsync(),
            };
        });
        fin.MapPost("/payouts", async (PayoutRequest r, RequestContext ctx, TreasuryService treasury) =>
        {
            var orgId = ctx.RequireOrg("payouts.manage");
            return Results.Json(await treasury.CreatePayout(orgId, ctx.Livemode, Money.Normalize(r.Currency), r.Amount, automatic: false), statusCode: 201);
        }).RequireRateLimiting("financial");
        fin.MapGet("/ledger/accounts", async (RequestContext ctx, AppDb db, LedgerService ledger) =>
        {
            var orgId = ctx.RequireOrg("ledger.read");
            var accounts = await db.LedgerAccounts.Where(a => a.OwnerType == "org" && a.OwnerId == orgId && a.Livemode == ctx.Livemode).ToListAsync();
            var list = new List<object>();
            foreach (var a in accounts) list.Add(new { a.Id, a.Code, a.Currency, a.Kind, balance = await ledger.Balance(a) });
            return new { @object = "list", data = list };
        });
        fin.MapGet("/ledger/entries", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            var orgId = ctx.RequireOrg("ledger.read");
            var accountIds = await db.LedgerAccounts.Where(a => a.OwnerType == "org" && a.OwnerId == orgId && a.Livemode == ctx.Livemode).ToDictionaryAsync(a => a.Id);
            var q = db.LedgerEntries.Where(e => accountIds.Keys.Contains(e.AccountId));
            if (req.Query["account"].FirstOrDefault() is { } acct) q = q.Where(e => e.AccountId == acct);
            var entries = await q.OrderByDescending(e => e.CreatedAt).Take(Math.Clamp(int.TryParse(req.Query["limit"], out var n) ? n : 100, 1, 500)).ToListAsync();
            var txIds = entries.Select(e => e.TransactionId).Distinct().ToList();
            var txs = await db.LedgerTransactions.Where(t => txIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id);
            return new
            {
                @object = "list",
                data = entries.Select(e => new { e.Id, e.CreatedAt, account = accountIds[e.AccountId].Code, e.Direction, e.Amount, e.Currency, transaction = e.TransactionId, type = txs[e.TransactionId].Type, description = txs[e.TransactionId].Description, source_type = txs[e.TransactionId].SourceType, source_id = txs[e.TransactionId].SourceId }),
            };
        });
        fin.MapGet("/statements", async (HttpRequest req, RequestContext ctx, TreasuryService treasury, AppDb db) =>
        {
            var orgId = ctx.RequireOrg("reports.read");
            var month = DateTime.TryParse(req.Query["month"] + "-01", out var m) ? DateTime.SpecifyKind(m, DateTimeKind.Utc) : new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
            var currency = req.Query["currency"].FirstOrDefault() ?? (await db.Organizations.FirstAsync(o => o.Id == orgId)).DefaultCurrency;
            return await treasury.Statement(orgId, ctx.Livemode, Money.Normalize(currency), month, month.AddMonths(1));
        });
        fin.MapGet("/tax/summary", async (HttpRequest req, RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("tax.read");
            var q = db.TaxRecords.AsQueryable();
            if (Paging.Date(req, "from") is { } from) q = q.Where(t => t.CreatedAt >= from);
            if (Paging.Date(req, "to") is { } to) q = q.Where(t => t.CreatedAt < to);
            var rows = await q.ToListAsync();
            return new
            {
                @object = "tax_summary",
                note = "The platform is the Merchant of Record and files and remits these taxes. Figures are traceable to invoices/orders via tax records.",
                by_jurisdiction = rows.GroupBy(r => new { r.Country, r.TaxType, r.Currency }).Select(g => new
                {
                    g.Key.Country, g.Key.TaxType, g.Key.Currency, taxable_sales = g.Where(x => !x.ReverseCharge && !x.Exempt).Sum(x => x.TaxableAmount),
                    tax_collected = g.Sum(x => x.TaxAmount), reverse_charge_sales = g.Where(x => x.ReverseCharge).Sum(x => x.TaxableAmount), records = g.Count(),
                }),
                registrations = await db.TaxRules.Select(r => r.Country).Distinct().ToListAsync(),
            };
        });
        fin.MapGet("/tax/records", async (HttpRequest req, RequestContext ctx, AppDb db) => { ctx.RequireOrg("tax.read"); return await Paging.List(db.TaxRecords, req); });

        var rep = app.MapGroup("/v1/reports").WithTags("Reports");
        rep.MapGet("/dashboard", async (HttpRequest req, RequestContext ctx, ReportsService reports, AppDb db) =>
        {
            var orgId = ctx.RequireOrg("analytics.read");
            var to = Paging.Date(req, "to") ?? DateTime.UtcNow.AddMinutes(1);
            var from = Paging.Date(req, "from") ?? to.AddDays(-30);
            var currency = req.Query["currency"].FirstOrDefault() ?? (await db.Organizations.FirstAsync(o => o.Id == orgId)).DefaultCurrency;
            return await reports.Dashboard(orgId, ctx.Livemode, from, to, Money.Normalize(currency), req.Query["country"].FirstOrDefault(), req.Query["product"].FirstOrDefault());
        });
        rep.MapGet("/attention", async (RequestContext ctx, ReportsService reports) => await reports.Attention(ctx.RequireOrg("payments.read")));
        rep.MapGet("/payments.csv", async (RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("reports.read");
            var rows = await db.Payments.OrderByDescending(p => p.CreatedAt).Take(10_000).ToListAsync();
            var csv = Csv.Write(rows, ("id", p => p.Id), ("created_at", p => p.CreatedAt), ("status", p => p.Status), ("amount", p => p.Amount), ("currency", p => p.Currency),
                ("tax", p => p.TaxAmount), ("fee", p => p.FeeAmount), ("net", p => p.NetAmount), ("refunded", p => p.AmountRefunded), ("customer", p => p.CustomerId),
                ("country", p => p.Country), ("method", p => p.PaymentMethodType), ("provider", p => p.ProviderId), ("source", p => p.CheckoutSessionId ?? p.InvoiceId));
            return Results.Text(csv, "text/csv");
        });
        rep.MapGet("/balance_transactions.csv", async (RequestContext ctx, AppDb db) =>
        {
            ctx.RequireOrg("reports.read");
            var rows = await db.BalanceTransactions.OrderByDescending(p => p.CreatedAt).Take(10_000).ToListAsync();
            return Results.Text(Csv.Write(rows, ("id", t => t.Id), ("created_at", t => t.CreatedAt), ("type", t => t.Type), ("amount", t => t.Amount), ("fee", t => t.Fee),
                ("net", t => t.Net), ("currency", t => t.Currency), ("status", t => t.Status), ("source", t => t.SourceId), ("payout", t => t.PayoutId), ("ledger_transaction", t => t.LedgerTransactionId)), "text/csv");
        });
    }

    public record UsageResult(string Id, string IdempotencyKey, bool Duplicate, bool Late, string? Rejected = null);

    private static async Task<List<UsageResult>> IngestUsage(AppDb db, Uow uow, List<UsageRequest> events, Modules.Growth.BudgetService budgets)
    {
        return await uow.Run(async () =>
        {
            var results = new List<UsageResult>();
            var keys = events.Select(e => e.IdempotencyKey).ToList();
            if (keys.Any(string.IsNullOrWhiteSpace)) throw ApiException.Invalid("Every usage event needs an idempotency_key.");
            var existing = await db.UsageEvents.Where(u => keys.Contains(u.IdempotencyKey)).ToDictionaryAsync(u => u.IdempotencyKey);
            var customers = events.Select(e => e.Customer).Distinct().ToList();
            var known = await db.Customers.Where(c => customers.Contains(c.Id)).Select(c => c.Id).ToListAsync();
            var meters = await db.Meters.Select(m => m.EventName).ToListAsync();
            var subs = await db.Subscriptions.Where(s => customers.Contains(s.CustomerId) && s.Status != "CANCELLED").ToListAsync();
            var seen = new HashSet<string>();
            var pendingBudget = new Dictionary<string, long>();
            foreach (var e in events)
            {
                if (existing.TryGetValue(e.IdempotencyKey, out var dup) || !seen.Add(e.IdempotencyKey)) { results.Add(new(dup?.Id ?? "", e.IdempotencyKey, true, false)); continue; }
                if (!known.Contains(e.Customer)) throw ApiException.NotFound($"customer '{e.Customer}'");
                if (!meters.Contains(e.EventName)) throw ApiException.Invalid($"No meter for event '{e.EventName}'. Create one with POST /v1/meters.");
                if (e.Quantity < 0 && e.CorrectsEventId == null) throw ApiException.Invalid("Negative quantities are only allowed as corrections (corrects_event_id).");
                var ts = e.Timestamp?.ToUniversalTime() ?? uow.Now;
                if (ts > uow.Now.AddMinutes(5)) throw ApiException.Invalid("Usage timestamps cannot be in the future.");
                if (e.Quantity > 0 && await budgets.Check(e.Customer, e.EventName, e.Quantity, ts, pendingBudget) is { } rejected)
                {
                    results.Add(new("", e.IdempotencyKey, false, false, rejected));
                    continue;
                }
                var sub = subs.FirstOrDefault(s => s.CustomerId == e.Customer);
                var late = sub != null && ts < sub.CurrentPeriodStart;
                var u = new UsageEvent
                {
                    Id = Ids.New("ue"), CreatedAt = uow.Now, CustomerId = e.Customer, EventName = e.EventName, Quantity = e.Quantity, Timestamp = ts,
                    IdempotencyKey = e.IdempotencyKey, SubscriptionId = sub?.Id, CorrectsEventId = e.CorrectsEventId, Late = late,
                };
                db.UsageEvents.Add(u);
                results.Add(new(u.Id, e.IdempotencyKey, false, late));
            }
            if (results.Any(r => !r.Duplicate && r.Rejected == null))
                uow.Emit("usage.recorded", new Meter { Id = "batch", OrgId = uow.Ctx.OrgId!, Livemode = uow.Ctx.Livemode, EventName = string.Join(",", events.Select(e => e.EventName).Distinct()) });
            return results;
        });
    }
}
