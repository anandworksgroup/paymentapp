using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Modules.Engines;
using PaymentApp.Api.Modules.Payments;
using PaymentApp.Api.Modules.Payouts;

namespace PaymentApp.Api.Modules.Reports;

/// <summary>
/// Merchant analytics (§10, §44, §45, §258-§262). Every figure is computed from operational tables and the
/// ledger on request — there are no client-side financial calculations (§334). Definitions are returned
/// alongside the numbers so MRR/ARR/LTV are never mistaken for accounting revenue.
/// </summary>
public class ReportsService(AppDb db, TreasuryService treasury)
{
    public static readonly object Definitions = new
    {
        gross_revenue = "Sum of successful payment amounts excluding tax, in the reporting currency at reference FX.",
        net_revenue = "Gross revenue minus refunds, chargebacks and platform fees.",
        mrr = "Sum over ACTIVE and PAST_DUE subscriptions of licensed recurring item prices normalized to one month (year÷12, week×52÷12, day×365÷12), before discounts, excluding usage.",
        arr = "MRR × 12. A run-rate indicator, not recognized revenue.",
        churn = "Subscriptions cancelled in the period ÷ subscriptions active at the start of the period.",
        conversion_rate = "Completed checkout sessions ÷ checkout sessions created in the period.",
        ltv = "ARPU ÷ monthly churn rate (estimate; not an accounting value).",
    };

    public async Task<object> Dashboard(string orgId, bool livemode, DateTime from, DateTime to, string reportingCurrency, string? country, string? productId)
    {
        var payments = await db.Payments.Where(p => p.CreatedAt >= from && p.CreatedAt < to).ToListAsync();
        if (country != null) payments = payments.Where(p => p.Country == country).ToList();
        if (productId != null)
        {
            var orderIds = (await db.Orders.Where(o => o.CreatedAt >= from.AddDays(-1)).ToListAsync()).Where(o => o.Items.Any(i => i.ProductId == productId)).Select(o => o.Id).ToHashSet();
            payments = payments.Where(p => p.OrderId != null && orderIds.Contains(p.OrderId)).ToList();
        }
        long R(long amount, string currency) => currency == reportingCurrency ? amount : Money.Convert(amount, currency, reportingCurrency, FxTable.MidRateE9(currency, reportingCurrency));
        var succeeded = payments.Where(p => p.AmountCaptured > 0).ToList();
        var gross = succeeded.Sum(p => R(p.Amount - p.TaxAmount, p.Currency));
        var tax = succeeded.Sum(p => R(p.TaxAmount, p.Currency));
        var fees = succeeded.Sum(p => R(p.FeeAmount, p.Currency));
        var refunds = (await db.Refunds.Where(r => r.Status == "SUCCEEDED" && r.CreatedAt >= from && r.CreatedAt < to).ToListAsync()).Sum(r => R(r.Amount - r.TaxAmount, r.Currency));
        var disputes = await db.Disputes.Where(d => d.CreatedAt >= from && d.CreatedAt < to).ToListAsync();
        var chargebacks = disputes.Where(d => d.Status != "won").Sum(d => R(d.Amount, d.Currency));
        var sessions = await db.CheckoutSessions.Where(s => s.CreatedAt >= from && s.CreatedAt < to).ToListAsync();
        var (mrr, activeSubs) = await Mrr(reportingCurrency);
        var cancelled = await db.Subscriptions.CountAsync(s => s.CanceledAt >= from && s.CanceledAt < to);
        var activeAtStart = await db.Subscriptions.CountAsync(s => s.CreatedAt < from && (s.CanceledAt == null || s.CanceledAt >= from) && s.Status != "INCOMPLETE");
        var customers = await db.Customers.CountAsync();
        var newCustomers = await db.Customers.CountAsync(c => c.CreatedAt >= from && c.CreatedAt < to);
        var payingCustomers = succeeded.Select(p => p.CustomerId).Distinct().Count();
        var churn = activeAtStart == 0 ? 0 : Math.Round(cancelled * 100.0 / activeAtStart, 2);
        var arpu = payingCustomers == 0 ? 0 : gross / payingCustomers;
        var days = Math.Max(1, (to - from).TotalDays);
        var monthlyChurn = churn / 100 * (30 / days);
        var series = succeeded.GroupBy(p => p.CreatedAt.Date).OrderBy(g => g.Key)
            .Select(g => new { date = g.Key.ToString("yyyy-MM-dd"), gross = g.Sum(p => R(p.Amount - p.TaxAmount, p.Currency)), count = g.Count() });
        var previousFrom = from - (to - from);
        var previousGross = (await db.Payments.Where(p => p.CreatedAt >= previousFrom && p.CreatedAt < from && p.AmountCaptured > 0).ToListAsync()).Sum(p => R(p.Amount - p.TaxAmount, p.Currency));

        return new
        {
            @object = "dashboard", reporting_currency = reportingCurrency, period_start = from, period_end = to, livemode,
            gross_revenue = gross, net_revenue = gross - refunds - chargebacks - fees, previous_period_gross_revenue = previousGross,
            change_pct = previousGross == 0 ? (double?)null : Math.Round((gross - previousGross) * 100.0 / previousGross, 1),
            taxes_collected = tax, platform_fees = fees, refunds, chargebacks,
            transactions = payments.Count, successful_payments = succeeded.Count, failed_payments = payments.Count(p => p.Status == "FAILED"),
            mrr, arr = mrr * 12, active_subscriptions = activeSubs, churn_rate_pct = churn,
            customers, new_customers = newCustomers, arpu, ltv_estimate = monthlyChurn <= 0 ? (long?)null : (long)(arpu / monthlyChurn),
            conversion_rate_pct = sessions.Count == 0 ? 0 : Math.Round(sessions.Count(s => s.Status == "complete") * 100.0 / sessions.Count, 1),
            balance = await treasury.Balance(orgId, livemode),
            series,
            by_country = succeeded.GroupBy(p => p.Country ?? "??").Select(g => new { country = g.Key, gross = g.Sum(p => R(p.Amount - p.TaxAmount, p.Currency)), count = g.Count() }).OrderByDescending(x => x.gross),
            by_method = payments.GroupBy(p => p.PaymentMethodType ?? "unknown").Select(g => new { method = g.Key, count = g.Count(), success_rate = Math.Round(g.Count(p => p.AmountCaptured > 0) * 100.0 / g.Count(), 1), gross = g.Where(p => p.AmountCaptured > 0).Sum(p => R(p.Amount - p.TaxAmount, p.Currency)) }),
            by_provider = payments.Where(p => p.ProviderId != null).GroupBy(p => p.ProviderId).Select(g => new { provider = g.Key, count = g.Count(), success_rate = Math.Round(g.Count(p => p.AmountCaptured > 0) * 100.0 / g.Count(), 1) }),
            definitions = Definitions,
        };
    }

    public async Task<(long Mrr, int Active)> Mrr(string reportingCurrency)
    {
        var subs = await db.Subscriptions.Where(s => s.Status == "ACTIVE" || s.Status == "PAST_DUE").ToListAsync();
        var subIds = subs.Select(s => s.Id).ToList();
        var items = await db.SubscriptionItems.Where(i => subIds.Contains(i.SubscriptionId) && !i.Deleted).ToListAsync();
        var prices = await db.Prices.Where(p => items.Select(i => i.PriceId).Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        long total = 0;
        foreach (var i in items)
        {
            var p = prices[i.PriceId];
            if (p.UsageType == "metered") continue;
            var amount = PricingEngine.Amount(p, i.Quantity);
            var monthly = p.Interval switch
            {
                "year" => Money.Ratio(amount, 1, 12L * p.IntervalCount, p.Currency),
                "week" => Money.Ratio(amount, 52, 12L * p.IntervalCount, p.Currency),
                "day" => Money.Ratio(amount, 365, 12L * p.IntervalCount, p.Currency),
                _ => Money.Ratio(amount, 1, p.IntervalCount, p.Currency),
            };
            total += p.Currency == reportingCurrency ? monthly : Money.Convert(monthly, p.Currency, reportingCurrency, FxTable.MidRateE9(p.Currency, reportingCurrency));
        }
        return (total, subs.Count);
    }

    /// <summary>The attention center (§322): each item links to the workflow that resolves it.</summary>
    public async Task<object> Attention(string orgId)
    {
        var day = DateTime.UtcNow.AddDays(-7);
        var items = new List<object>();
        var failed = await db.Payments.CountAsync(p => p.Status == "FAILED" && p.CreatedAt >= day);
        if (failed > 0) items.Add(new { kind = "failed_payments", count = failed, label = $"{failed} failed payments this week", link = "/payments?status=FAILED" });
        var disputes = await db.Disputes.CountAsync(d => d.Status == "needs_response");
        if (disputes > 0) items.Add(new { kind = "disputes", count = disputes, label = $"{disputes} disputes need a response", link = "/disputes" });
        var review = await db.Payments.CountAsync(p => p.ReviewStatus == "pending");
        if (review > 0) items.Add(new { kind = "risk_review", count = review, label = $"{review} payments held for risk review", link = "/payments?review=pending" });
        var pastDue = await db.Subscriptions.CountAsync(s => s.Status == "PAST_DUE");
        if (pastDue > 0) items.Add(new { kind = "at_risk", count = pastDue, label = $"{pastDue} customers at risk (past due)", link = "/subscriptions?status=PAST_DUE" });
        var payoutIssues = await db.Payouts.CountAsync(p => p.Status == "FAILED" || p.Status == "ON_HOLD");
        if (payoutIssues > 0) items.Add(new { kind = "payouts", count = payoutIssues, label = $"{payoutIssues} payout problem(s)", link = "/payouts" });
        var app = await db.MerchantApplications.FirstOrDefaultAsync(a => a.OrgId == orgId);
        if (app is { Status: "ACTION_REQUIRED" or "APPLICATION_STARTED" }) items.Add(new { kind = "compliance", count = 1, label = app.Status == "ACTION_REQUIRED" ? "Business verification needs information" : "Finish business verification", link = "/settings/verification" });
        return new { @object = "attention", items };
    }
}
