using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Ledger;
using PaymentApp.Api.Modules.Payments;

namespace PaymentApp.Api.Modules.Growth;

/// <summary>
/// Affiliate programme (§51): referral codes attribute customers (first touch), successful payments earn
/// commissions that sit in a hold period, then accrue in the ledger as a merchant liability; refunds and
/// lost chargebacks reverse commissions that haven't been paid.
/// </summary>
public class AffiliateService(AppDb db, Uow uow, LedgerService ledger)
{
    public const string PayableAccount = "affiliate_payable";

    public async Task Attribute(CheckoutSession s)
    {
        if (string.IsNullOrEmpty(s.AffiliateCode) || s.CustomerId == null) return;
        var affiliate = await db.Affiliates.FirstOrDefaultAsync(a => a.Code == s.AffiliateCode && a.Status == "active");
        if (affiliate == null) return;
        if (await db.AffiliateReferrals.AnyAsync(r => r.CustomerId == s.CustomerId)) return; // first touch wins
        db.AffiliateReferrals.Add(new AffiliateReferral { Id = Ids.New("aref"), CreatedAt = uow.Now, AffiliateId = affiliate.Id, CustomerId = s.CustomerId, CheckoutSessionId = s.Id });
        await db.SaveChangesAsync();
    }

    public async Task OnPaymentSucceeded(Payment p)
    {
        if (p.CustomerId == null) return;
        var referral = await db.AffiliateReferrals.FirstOrDefaultAsync(r => r.CustomerId == p.CustomerId);
        if (referral == null) return;
        var a = await db.Affiliates.FirstAsync(x => x.Id == referral.AffiliateId);
        if (a.Status != "active") return;
        var earlier = await db.AffiliateCommissions.AnyAsync(c => c.AffiliateId == a.Id && c.CustomerId == p.CustomerId);
        var eligible = a.Duration switch
        {
            "first_payment" => !earlier,
            "months" => p.CreatedAt < referral.CreatedAt.AddMonths(a.DurationMonths ?? 0),
            _ => true,
        };
        if (!eligible) return;
        var basis = p.Amount - p.TaxAmount; // commissions are earned on sales, never on tax collected for authorities
        var amount = a.CommissionType == "fixed"
            ? (a.FixedCurrency == p.Currency || a.FixedCurrency == null ? a.FixedAmount : Money.Convert(a.FixedAmount, a.FixedCurrency, p.Currency, FxTable.MidRateE9(a.FixedCurrency, p.Currency)))
            : Money.ApplyBps(basis, a.RateBps, p.Currency);
        amount = Math.Min(amount, basis);
        if (amount <= 0) return;
        var c = new AffiliateCommission
        {
            Id = Ids.New("acom"), CreatedAt = uow.Now, AffiliateId = a.Id, CustomerId = p.CustomerId, PaymentId = p.Id, BasisAmount = basis,
            Amount = amount, Currency = p.Currency, ApproveAfter = uow.Now.AddDays(a.HoldDays),
        };
        db.AffiliateCommissions.Add(c);
        uow.Emit("affiliate.commission_created", c);
    }

    /// <summary>After the hold period the commission becomes a real liability owed by the merchant.</summary>
    public async Task<int> ApproveDue(DateTime now)
    {
        List<AffiliateCommission> due;
        using (db.Tenant.Elevate())
            due = await db.AffiliateCommissions.AsNoTracking().Where(c => c.Status == "pending" && c.ApproveAfter <= now).Take(500).ToListAsync();
        foreach (var snapshot in due)
        {
            using var _ = db.Tenant.Use(snapshot.OrgId, snapshot.Livemode);
            await uow.Run(async () =>
            {
                var c = await db.AffiliateCommissions.FirstAsync(x => x.Id == snapshot.Id);
                var p = await db.Payments.FirstAsync(x => x.Id == c.PaymentId);
                if (p.Status is "REFUNDED" or "CHARGEBACK") { c.Status = "reversed"; c.ReversalReason = $"payment {p.Status.ToLowerInvariant()}"; return; }
                var ltx = await ledger.Post("affiliate_commission", $"affiliate_commission:{c.Id}", $"Affiliate commission for {p.Id}", "affiliate_commission", c.Id, c.OrgId, c.Livemode,
                [
                    Leg.Debit(await ledger.Merchant(c.OrgId, Accounts.MerchantAvailable, c.Currency, c.Livemode), c.Amount),
                    Leg.Credit(await ledger.Merchant(c.OrgId, PayableAccount, c.Currency, c.Livemode), c.Amount),
                ]);
                c.Status = "approved";
                c.LedgerTransactionId = ltx.Id;
                db.BalanceTransactions.Add(new BalanceTransaction
                {
                    Id = Ids.New("txn"), CreatedAt = uow.Now, Type = "affiliate_commission", Amount = -c.Amount, Net = -c.Amount, Currency = c.Currency,
                    SourceType = "affiliate_commission", SourceId = c.Id, Status = "available", AvailableOn = uow.Now, LedgerTransactionId = ltx.Id,
                    Description = "Affiliate commission accrued",
                });
                uow.Emit("affiliate.commission_approved", c);
            });
        }
        return due.Count;
    }

    public async Task ReverseForPayment(string paymentId, string reason)
    {
        foreach (var c in await db.AffiliateCommissions.Where(x => x.PaymentId == paymentId && (x.Status == "pending" || x.Status == "approved")).ToListAsync())
        {
            if (c.Status == "approved" && c.LedgerTransactionId != null)
            {
                var original = await db.LedgerTransactions.FirstAsync(t => t.Id == c.LedgerTransactionId);
                var rev = await ledger.Reverse(original, reason);
                db.BalanceTransactions.Add(new BalanceTransaction
                {
                    Id = Ids.New("txn"), CreatedAt = uow.Now, OrgId = c.OrgId, Livemode = c.Livemode, Type = "affiliate_commission_reversal", Amount = c.Amount, Net = c.Amount,
                    Currency = c.Currency, SourceType = "affiliate_commission", SourceId = c.Id, Status = "available", AvailableOn = uow.Now, LedgerTransactionId = rev.Id,
                    Description = "Affiliate commission reversed",
                });
            }
            c.Status = "reversed";
            c.ReversalReason = reason;
            uow.Emit("affiliate.commission_reversed", c);
        }
    }

    /// <summary>Settles every approved commission for an affiliate (sandbox bank rail).</summary>
    public async Task<object> Pay(string affiliateId)
    {
        return await uow.Run(async () =>
        {
            var a = await db.Affiliates.FirstOrDefaultAsync(x => x.Id == affiliateId) ?? throw ApiException.NotFound("affiliate");
            var approved = await db.AffiliateCommissions.Where(c => c.AffiliateId == a.Id && c.Status == "approved").ToListAsync();
            if (approved.Count == 0) throw new ApiException(400, "nothing_to_pay", "There are no approved commissions to pay.");
            var totals = new Dictionary<string, long>();
            foreach (var byCurrency in approved.GroupBy(c => c.Currency))
            {
                var total = byCurrency.Sum(c => c.Amount);
                await ledger.Post("affiliate_payout", $"affiliate_payout:{a.Id}:{byCurrency.Key}:{uow.Now:yyyyMMddHHmmssfff}", $"Affiliate payout to {a.Name}", "affiliate", a.Id, a.OrgId, a.Livemode,
                [
                    Leg.Debit(await ledger.Merchant(a.OrgId, PayableAccount, byCurrency.Key, a.Livemode), total),
                    Leg.Credit(await ledger.Platform(Accounts.PlatformBank, byCurrency.Key, a.Livemode), total),
                ]);
                totals[byCurrency.Key] = total;
            }
            foreach (var c in approved) { c.Status = "paid"; c.PaidAt = uow.Now; }
            uow.Audit("affiliate.pay", "affiliate", a.Id, after: totals);
            return (object)new { @object = "affiliate_payout", affiliate = a.Id, commissions = approved.Count, totals };
        });
    }
}

/// <summary>
/// Customer budgets and usage caps (§245, §246): month-to-date usage per customer with 50/75/90/100%
/// alerts and, for hard caps, refusal of events that would exceed the limit.
/// </summary>
public class BudgetService(AppDb db, Uow uow)
{
    /// <summary>Returns a rejection reason or null. Must run inside the ingestion unit of work.</summary>
    public async Task<string?> Check(string customerId, string eventName, long quantity, DateTime at, Dictionary<string, long> pendingInBatch)
    {
        var budgets = await db.CustomerBudgets.Where(b => b.CustomerId == customerId && b.Active && (b.EventName == eventName || b.EventName == "*")).ToListAsync();
        if (budgets.Count == 0) return null;
        var monthStart = new DateTime(at.Year, at.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var monthEnd = monthStart.AddMonths(1);
        var evaluated = new List<(CustomerBudget Budget, string Key, long After)>();
        foreach (var b in budgets)
        {
            var q = db.UsageEvents.Where(u => u.CustomerId == customerId && u.Timestamp >= monthStart && u.Timestamp < monthEnd);
            if (b.EventName != "*") q = q.Where(u => u.EventName == b.EventName);
            var key = $"{b.Id}|{monthStart:yyyy-MM}";
            // Saved events plus events accepted earlier in this same batch (not yet flushed).
            var after = (await q.SumAsync(u => (long?)u.Quantity) ?? 0) + pendingInBatch.GetValueOrDefault(key) + quantity;
            if (b.Mode == "hard" && after > b.MonthlyLimit) return $"Monthly limit of {b.MonthlyLimit:N0} for {(b.EventName == "*" ? "usage" : b.EventName)} reached.";
            evaluated.Add((b, key, after));
        }
        foreach (var (b, key, after) in evaluated)
        {
            pendingInBatch[key] = pendingInBatch.GetValueOrDefault(key) + quantity;
            var notified = b.NotifiedCsv.Split(',', StringSplitOptions.RemoveEmptyEntries).ToHashSet();
            foreach (var t in b.ThresholdsCsv.Split(',').Select(int.Parse).OrderBy(x => x))
            {
                var marker = $"{monthStart:yyyy-MM}:{t}";
                if (after * 100 < b.MonthlyLimit * t || notified.Contains(marker)) continue;
                notified.Add(marker);
                db.Notifications.Add(new Notification
                {
                    Id = Ids.New("ntf"), CreatedAt = uow.Now, OrgId = b.OrgId, Channel = "in_app", Recipient = $"org:{b.OrgId}", Template = "usage_threshold",
                    Subject = $"{customerId} reached {t}% of its {(b.EventName == "*" ? "usage" : b.EventName)} budget",
                    Body = $"{after:N0} of {b.MonthlyLimit:N0} this month ({b.Mode} limit).", Category = "billing", Status = "delivered", ObjectType = "customer", ObjectId = customerId,
                });
                uow.Emit("usage.threshold_reached", b);
            }
            b.NotifiedCsv = string.Join(",", notified.Where(n => n.StartsWith($"{monthStart:yyyy-MM}:")));
        }
        return null;
    }
}
