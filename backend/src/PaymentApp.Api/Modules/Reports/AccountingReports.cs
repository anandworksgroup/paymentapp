using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Modules.Engines;

namespace PaymentApp.Api.Modules.Reports;

/// <summary>
/// Finance-grade reporting on top of the operational data: revenue recognition (§263), the merchant's
/// journal for accounting systems (§99), cohorts (§259) and churn by type (§258). Methodology is returned
/// with each report so nobody mistakes an estimate for booked revenue (§260-§262).
/// </summary>
public class AccountingReports(AppDb db)
{
    public record JournalLine(DateTime Date, string JournalId, string Account, long Debit, long Credit, string Currency, string Memo, string SourceType, string SourceId);

    /// <summary>
    /// Ratable recognition: subscription invoice lines are recognized evenly (by the second) over their
    /// service period; one-time sales at the point of sale; refunds reduce revenue when they happen.
    /// Amounts exclude tax, which belongs to the tax authority.
    /// </summary>
    public async Task<object> RevenueRecognition(DateTime monthStart, string currency)
    {
        var monthEnd = monthStart.AddMonths(1);
        var paidInvoices = await db.Invoices.Where(i => i.Status == "PAID" && i.Currency == currency && i.PaidAt != null && i.PaidAt < monthEnd).Select(i => new { i.Id, i.PaidAt }).ToListAsync();
        var invoiceIds = paidInvoices.Select(i => i.Id).ToList();
        var paidAt = paidInvoices.ToDictionary(i => i.Id, i => i.PaidAt!.Value);
        var lines = await db.InvoiceLines.Where(l => invoiceIds.Contains(l.InvoiceId)).ToListAsync();
        var prices = await db.Prices.ToDictionaryAsync(p => p.Id, p => p.TaxBehavior);
        long recognized = 0, deferredEnd = 0, billings = 0;
        var byProduct = new Dictionary<string, long>();
        foreach (var l in lines)
        {
            var net = l.Amount - l.Discount - (l.PriceId != null && prices.GetValueOrDefault(l.PriceId) == "inclusive" ? l.Tax : 0);
            if (net == 0) continue;
            if (paidAt[l.InvoiceId] >= monthStart) billings += net;
            long inMonth;
            if (l.PeriodStart is { } ps && l.PeriodEnd is { } pe && pe > ps)
            {
                var total = (long)(pe - ps).TotalSeconds;
                long Overlap(DateTime a, DateTime b) => Math.Max(0, (long)((b < pe ? b : pe) - (a > ps ? a : ps)).TotalSeconds);
                var recognizedBefore = Money.Ratio(net, Overlap(DateTime.MinValue.AddYears(1), monthStart), total, currency);
                var recognizedThrough = Money.Ratio(net, Overlap(DateTime.MinValue.AddYears(1), monthEnd), total, currency);
                inMonth = recognizedThrough - recognizedBefore;
                deferredEnd += net - recognizedThrough;
            }
            else inMonth = paidAt[l.InvoiceId] >= monthStart ? net : 0;
            recognized += inMonth;
            if (inMonth != 0 && l.ProductId != null) byProduct[l.ProductId] = byProduct.GetValueOrDefault(l.ProductId) + inMonth;
        }
        // One-time checkout orders without an invoice are delivered at purchase.
        var orders = await db.Orders.Where(o => o.InvoiceId == null && o.Currency == currency && (o.Status == "paid" || o.Status == "partially_refunded" || o.Status == "refunded" || o.Status == "disputed" || o.Status == "chargeback")
                                                && o.UpdatedAt >= monthStart.AddMonths(-2)).ToListAsync();
        var orderPayments = await db.Payments.Where(p => orders.Select(o => o.PaymentId).Contains(p.Id) && p.AmountCaptured > 0).ToDictionaryAsync(p => p.Id, p => p.CreatedAt);
        foreach (var o in orders.Where(o => o.PaymentId != null && orderPayments.TryGetValue(o.PaymentId, out var at) && at >= monthStart && at < monthEnd))
        {
            var net = o.Items.Sum(i => i.Amount - i.Discount - (i.TaxInclusive ? i.Tax : 0));
            recognized += net;
            billings += net;
            foreach (var i in o.Items.Where(i => i.ProductId != null)) byProduct[i.ProductId!] = byProduct.GetValueOrDefault(i.ProductId!) + i.Amount - i.Discount - (i.TaxInclusive ? i.Tax : 0);
        }
        var refunds = await db.Refunds.Where(r => r.Status == "SUCCEEDED" && r.Currency == currency && r.CompletedAt >= monthStart && r.CompletedAt < monthEnd).SumAsync(r => (long?)(r.Amount - r.TaxAmount)) ?? 0;
        var names = await db.Products.Where(p => byProduct.Keys.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
        return new
        {
            @object = "revenue_recognition", month = monthStart.ToString("yyyy-MM"), currency, billings, recognized_revenue = recognized, refunds,
            net_recognized_revenue = recognized - refunds, deferred_revenue_end_of_month = deferredEnd,
            by_product = byProduct.OrderByDescending(x => x.Value).Select(x => new { product = x.Key, name = names.GetValueOrDefault(x.Key), recognized = x.Value }),
            methodology = "Subscription and usage invoice lines are recognized ratably by the second across their service period; one-time sales at the point of sale; refunds reduce revenue in the month they complete. Excludes tax. Management reporting — confirm the policy with your accountant before relying on it for statutory filings.",
        };
    }

    /// <summary>
    /// The merchant's books from its own point of view as a seller through a Merchant of Record: every
    /// balance transaction becomes a balanced journal against "Receivable from platform (MoR)" (§99).
    /// </summary>
    public async Task<List<JournalLine>> Journal(DateTime from, DateTime to)
    {
        var txns = await db.BalanceTransactions.Where(t => t.CreatedAt >= from && t.CreatedAt < to).OrderBy(t => t.CreatedAt).ToListAsync();
        const string Receivable = "Receivable from platform (MoR)";
        var lines = new List<JournalLine>();
        void Add(BalanceTransaction t, string debit, string credit, long amount, string memo)
        {
            if (amount == 0) return;
            if (amount < 0) { (debit, credit, amount) = (credit, debit, -amount); }
            lines.Add(new JournalLine(t.CreatedAt, t.Id, debit, amount, 0, t.Currency, memo, t.SourceType, t.SourceId));
            lines.Add(new JournalLine(t.CreatedAt, t.Id, credit, 0, amount, t.Currency, memo, t.SourceType, t.SourceId));
        }
        foreach (var t in txns)
        {
            switch (t.Type)
            {
                case "payment":
                    Add(t, Receivable, "Sales revenue", t.Amount, $"Sale {t.SourceId} (excl. tax remitted by platform)");
                    Add(t, "Platform fees", Receivable, t.Fee, $"Platform fee on {t.SourceId}");
                    break;
                case "refund": Add(t, "Sales refunds", Receivable, -t.Amount, $"Refund {t.SourceId}"); break;
                case "dispute":
                    Add(t, "Chargebacks", Receivable, -t.Amount, $"Chargeback {t.SourceId}");
                    Add(t, "Platform fees", Receivable, t.Fee, $"Dispute fee {t.SourceId}");
                    break;
                case "dispute_reversal": Add(t, Receivable, "Chargebacks", t.Amount, $"Dispute won {t.SourceId}"); break;
                case "payout": Add(t, "Bank", Receivable, -t.Amount, $"Payout {t.SourceId}"); break;
                case "payout_failure": Add(t, Receivable, "Bank", t.Amount, $"Payout returned {t.SourceId}"); break;
                case "transfer_to_wallet": Add(t, "Business wallet", Receivable, -t.Amount, $"Moved to business wallet {t.SourceId}"); break;
                case "affiliate_commission": Add(t, "Affiliate commissions", Receivable, -t.Amount, $"Commission paid through the platform {t.SourceId}"); break;
                case "affiliate_commission_reversal": Add(t, Receivable, "Affiliate commissions", t.Amount, $"Commission reversed {t.SourceId}"); break;
                case "adjustment": Add(t, Receivable, "Platform adjustments", t.Amount, t.Description ?? "Adjustment"); break;
                case "reserve_release": break; // movement inside the receivable (reserve → available); no P&L effect
                default: Add(t, Receivable, "Other platform movements", t.Net, $"{t.Type} {t.SourceId}"); break;
            }
        }
        return lines;
    }

    /// <summary>Customers grouped by month of first successful payment; retention = paid or subscribed in each later month.</summary>
    public async Task<object> Cohorts(int months, string currency)
    {
        var payments = await db.Payments.Where(p => p.AmountCaptured > 0 && p.CustomerId != null).Select(p => new { p.CustomerId, p.CreatedAt, p.Amount, p.TaxAmount, p.Currency }).ToListAsync();
        var subs = await db.Subscriptions.Where(s => s.Status != "INCOMPLETE").Select(s => new { s.CustomerId, s.CreatedAt, s.CanceledAt }).ToListAsync();
        static DateTime M(DateTime d) => new(d.Year, d.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var first = payments.GroupBy(p => p.CustomerId!).ToDictionary(g => g.Key, g => M(g.Min(p => p.CreatedAt)));
        var nowMonth = M(DateTime.UtcNow);
        var cohorts = first.GroupBy(kv => kv.Value).OrderBy(g => g.Key).Where(g => g.Key > nowMonth.AddMonths(-months)).Select(g =>
        {
            var customers = g.Select(kv => kv.Key).ToHashSet();
            var span = (nowMonth.Year - g.Key.Year) * 12 + nowMonth.Month - g.Key.Month;
            var retention = Enumerable.Range(0, span + 1).Select(offset =>
            {
                var start = g.Key.AddMonths(offset);
                var end = start.AddMonths(1);
                var active = customers.Count(c => payments.Any(p => p.CustomerId == c && p.CreatedAt >= start && p.CreatedAt < end)
                                                  || subs.Any(s => s.CustomerId == c && s.CreatedAt < end && (s.CanceledAt == null || s.CanceledAt >= end)));
                var revenue = payments.Where(p => customers.Contains(p.CustomerId!) && p.CreatedAt >= start && p.CreatedAt < end)
                    .Sum(p => p.Currency == currency ? p.Amount - p.TaxAmount : Money.Convert(p.Amount - p.TaxAmount, p.Currency, currency, Payments.FxTable.MidRateE9(p.Currency, currency)));
                return new { month_offset = offset, active_customers = active, retention_pct = Math.Round(active * 100.0 / customers.Count, 1), revenue };
            });
            return new { cohort = g.Key.ToString("yyyy-MM"), customers = customers.Count, retention };
        }).ToList();
        return new { @object = "cohort_analysis", currency, cohort_basis = "month of first successful payment", activity_definition = "a successful payment in the month, or a subscription active at month end", cohorts };
    }

    /// <summary>Logo vs revenue churn and voluntary vs involuntary (payment-failure) churn for a period (§258).</summary>
    public async Task<object> Churn(DateTime from, DateTime to, string currency)
    {
        var subs = await db.Subscriptions.ToListAsync();
        var items = await db.SubscriptionItems.Where(i => !i.Deleted).ToListAsync();
        var prices = await db.Prices.ToDictionaryAsync(p => p.Id);
        long Monthly(Subscription s) => items.Where(i => i.SubscriptionId == s.Id).Sum(i =>
        {
            var p = prices[i.PriceId];
            if (p.UsageType == "metered") return 0;
            var amount = PricingEngine.Amount(p, i.Quantity);
            var monthly = p.Interval switch
            {
                "year" => Money.Ratio(amount, 1, 12L * p.IntervalCount, p.Currency),
                "week" => Money.Ratio(amount, 52, 12L * p.IntervalCount, p.Currency),
                "day" => Money.Ratio(amount, 365, 12L * p.IntervalCount, p.Currency),
                _ => Money.Ratio(amount, 1, p.IntervalCount, p.Currency),
            };
            return p.Currency == currency ? monthly : Money.Convert(monthly, p.Currency, currency, Payments.FxTable.MidRateE9(p.Currency, currency));
        });
        var activeAtStart = subs.Where(s => s.Status != "INCOMPLETE" && s.CreatedAt < from && (s.CanceledAt == null || s.CanceledAt >= from)).ToList();
        var cancelled = subs.Where(s => s.CanceledAt >= from && s.CanceledAt < to).ToList();
        var involuntary = cancelled.Where(s => s.CancellationReason == "payment_failed").ToList();
        var voluntary = cancelled.Except(involuntary).ToList();
        var startMrr = activeAtStart.Sum(Monthly);
        var lostMrr = cancelled.Where(s => s.CreatedAt < from).Sum(Monthly);
        double Pct(long n, long d) => d == 0 ? 0 : Math.Round(n * 100.0 / d, 2);
        return new
        {
            @object = "churn", period_start = from, period_end = to, currency,
            subscriptions_at_start = activeAtStart.Count, cancelled = cancelled.Count,
            logo_churn_pct = Pct(cancelled.Count(s => s.CreatedAt < from), activeAtStart.Count),
            voluntary = voluntary.Count, involuntary = involuntary.Count,
            mrr_at_start = startMrr, mrr_lost = lostMrr, revenue_churn_pct = Pct(lostMrr, startMrr),
            reasons = cancelled.GroupBy(s => s.CancellationReason ?? "unspecified").Select(g => new { reason = g.Key, count = g.Count() }),
            retention_saves = await db.Events.CountAsync(e => e.Type == "subscription.retained" && e.CreatedAt >= from && e.CreatedAt < to && e.OrgId == db.Tenant.OrgId && e.Livemode == db.Tenant.Livemode),
            definitions = new
            {
                logo_churn = "Subscriptions active at period start that were cancelled during the period ÷ subscriptions active at start.",
                revenue_churn = "Monthly recurring amount of those cancellations ÷ MRR at period start (before discounts, excluding usage).",
                involuntary = "Cancelled after dunning was exhausted (payment_failed); everything else is voluntary.",
            },
        };
    }
}
