using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Payments;

namespace PaymentApp.Api.Modules.Billing;

/// <summary>Time source for billing: a subscription attached to a test clock lives in that clock's time (§61).</summary>
public class BillingClock(AppDb db, IClock clock)
{
    public async Task<DateTime> Now(string? testClockId)
    {
        if (testClockId == null) return clock.UtcNow;
        var c = await db.TestClocks.IgnoreQueryFilters().FirstOrDefaultAsync(x => x.Id == testClockId);
        return c?.FrozenTime ?? clock.UtcNow;
    }
}

public class EntitlementService(AppDb db, Uow uow)
{
    public async Task<Entitlement> Grant(string customerId, string productId, string sourceType, string sourceId, long seats = 1, DateTime? expiresAt = null)
    {
        var existing = await db.Entitlements.FirstOrDefaultAsync(e => e.CustomerId == customerId && e.ProductId == productId && e.SourceId == sourceId);
        if (existing != null)
        {
            if (existing.Status != "active")
            {
                uow.Transition("entitlement", existing.Id, existing.Status, "active");
                existing.Status = "active";
                existing.RevokedAt = null;
                existing.RevokeReason = null;
                uow.Emit("entitlement.updated", existing);
            }
            existing.Seats = seats;
            return existing;
        }
        var product = await db.Products.FirstAsync(p => p.Id == productId);
        var e = new Entitlement
        {
            Id = Ids.New("ent"), CreatedAt = uow.Now, CustomerId = customerId, ProductId = productId, SourceType = sourceType, SourceId = sourceId,
            Seats = seats, FeaturesCsv = product.FeaturesCsv, ExpiresAt = expiresAt,
            LicenseKey = product.Type is "license" or "download" ? LicenseKey() : null,
        };
        db.Entitlements.Add(e);
        uow.Emit("entitlement.granted", e);
        return e;
    }

    public async Task RevokeBySource(string sourceId, string reason)
    {
        foreach (var e in await db.Entitlements.Where(x => x.SourceId == sourceId && (x.Status == "active" || x.Status == "suspended")).ToListAsync())
        {
            uow.Transition("entitlement", e.Id, e.Status, "revoked", reason: reason);
            e.Status = "revoked";
            e.RevokedAt = uow.Now;
            e.RevokeReason = reason;
            uow.Emit("entitlement.revoked", e);
        }
    }

    private static string LicenseKey()
    {
        var raw = Ids.New("x", 20)[2..].ToUpperInvariant();
        return string.Join("-", Enumerable.Range(0, 4).Select(i => raw.Substring(i * 5, 5)));
    }
}

/// <summary>
/// What happens after money moves (§58, §182): orders, invoices, subscriptions, entitlements, credits,
/// tax records. Runs inside the payment's unit of work so the business state and the ledger commit together.
/// </summary>
public class Fulfillment(AppDb db, Uow uow, EntitlementService entitlements, CreditService credits, BillingClock billingClock, Growth.AffiliateService affiliates) : IFulfillment
{
    public async Task OnPaymentSucceeded(Payment p)
    {
        Invoice? invoice = null;
        if (p.InvoiceId != null)
        {
            invoice = await db.Invoices.FirstAsync(i => i.Id == p.InvoiceId);
            await MarkInvoicePaid(invoice, p);
        }
        if (p.OrderId != null)
        {
            var order = await db.Orders.FirstAsync(o => o.Id == p.OrderId);
            order.Status = "paid";
            order.PaymentId = p.Id;
            order.InvoiceId ??= p.InvoiceId;
            order.UpdatedAt = uow.Now;
            if (invoice == null) RecordOrderTax(order, p);
            uow.Emit("order.paid", order);
        }
        if (p.CheckoutSessionId != null)
        {
            var s = await db.CheckoutSessions.FirstAsync(x => x.Id == p.CheckoutSessionId);
            await CompleteCheckout(s, p);
        }
        await affiliates.OnPaymentSucceeded(p);
    }

    public async Task CompleteCheckout(CheckoutSession s, Payment? p)
    {
        if (s.Status == "complete") return;
        uow.Transition("checkout_session", s.Id, s.Status, "complete");
        s.Status = "complete";
        s.CompletedAt = uow.Now;
        s.PaymentId = p?.Id;
        await affiliates.Attribute(s);
        if (s.PaymentLinkId != null)
        {
            var link = await db.PaymentLinks.FirstOrDefaultAsync(l => l.Id == s.PaymentLinkId);
            if (link != null) link.Completions++;
        }
        var prices = await db.Prices.Where(x => s.LineItems.Select(l => l.PriceId).Contains(x.Id)).ToDictionaryAsync(x => x.Id);
        foreach (var line in s.LineItems)
        {
            var price = prices[line.PriceId];
            var sourceId = price.Type == "recurring" && s.SubscriptionId != null ? s.SubscriptionId : s.OrderId ?? s.Id;
            await entitlements.Grant(s.CustomerId!, price.ProductId, price.Type == "recurring" ? "subscription" : "order", sourceId, line.Quantity);
            if (price.CreditsGranted > 0)
                await credits.Apply(s.CustomerId!, "credits", "issue", price.CreditsGranted * line.Quantity, $"grant:{s.Id}:{price.Id}",
                    "checkout_session", s.Id, $"{price.CreditsGranted * line.Quantity} credits purchased");
        }
        uow.Emit("checkout.session.completed", s);
    }

    private async Task MarkInvoicePaid(Invoice inv, Payment? p)
    {
        if (inv.Status == "PAID") return;
        uow.Transition("invoice", inv.Id, inv.Status, "PAID");
        inv.Status = "PAID";
        inv.AmountPaid = inv.AmountDue;
        inv.PaidAt = uow.Now;
        inv.PaymentId = p?.Id ?? inv.PaymentId;
        inv.UpdatedAt = uow.Now;
        await RecordInvoiceTax(inv);
        uow.Emit("invoice.paid", inv);
        if (inv.SubscriptionId == null) return;
        var sub = await db.Subscriptions.FirstAsync(x => x.Id == inv.SubscriptionId);
        var trialing = sub.TrialEnd != null && sub.TrialEnd > await billingClock.Now(sub.TestClockId);
        var target = trialing ? "TRIALING" : "ACTIVE";
        if (sub.Status is "INCOMPLETE" or "PAST_DUE" or "TRIALING" && sub.Status != target)
        {
            var created = sub.Status == "INCOMPLETE";
            uow.Transition("subscription", sub.Id, sub.Status, target, reason: "invoice paid");
            sub.Status = target;
            sub.DunningAttempts = 0;
            sub.NextRetryAt = null;
            sub.PastDueSince = null;
            sub.UpdatedAt = uow.Now;
            uow.Emit(created ? "subscription.created" : "subscription.updated", sub);
            // Restore access that may have been restricted during dunning.
            foreach (var item in await db.SubscriptionItems.Where(i => i.SubscriptionId == sub.Id && !i.Deleted).ToListAsync())
            {
                var price = await db.Prices.FirstAsync(x => x.Id == item.PriceId);
                await entitlements.Grant(sub.CustomerId, price.ProductId, "subscription", sub.Id, item.Quantity);
            }
        }
        else if (inv.BillingReason == "subscription_cycle") uow.Emit("subscription.renewed", sub);
    }

    public async Task MarkInvoicePaidWithoutPayment(Invoice inv) => await MarkInvoicePaid(inv, null);

    private void RecordOrderTax(Order order, Payment p)
    {
        foreach (var line in order.Items.Where(l => l.Tax > 0 || l.TaxRuleId != null))
            db.TaxRecords.Add(new TaxRecord
            {
                Id = Ids.New("taxrec"), CreatedAt = uow.Now, OrgId = order.OrgId, Livemode = order.Livemode, SourceType = "order", SourceId = order.Id,
                OrderId = order.Id, Country = order.Country ?? "", TaxType = line.TaxType ?? "", TaxRuleId = line.TaxRuleId, TaxRuleVersion = line.TaxRuleVersion,
                RateBps = line.TaxRateBps, TaxableAmount = line.TaxInclusive ? line.Amount - line.Discount - line.Tax : line.Amount - line.Discount,
                TaxAmount = line.Tax, Currency = order.Currency, ReverseCharge = line.TaxType == "reverse_charge",
            });
    }

    private async Task RecordInvoiceTax(Invoice inv)
    {
        if (await db.TaxRecords.AnyAsync(t => t.SourceType == "invoice" && t.SourceId == inv.Id)) return;
        foreach (var line in await db.InvoiceLines.Where(l => l.InvoiceId == inv.Id).ToListAsync())
        {
            if (line.Tax == 0 && line.TaxRuleId == null) continue;
            db.TaxRecords.Add(new TaxRecord
            {
                Id = Ids.New("taxrec"), CreatedAt = uow.Now, OrgId = inv.OrgId, Livemode = inv.Livemode, SourceType = "invoice", SourceId = inv.Id,
                InvoiceId = inv.Id, Country = inv.CustomerCountry ?? "", TaxType = line.TaxType ?? "", TaxRuleId = line.TaxRuleId,
                TaxRuleVersion = line.TaxRuleVersion, RateBps = line.TaxRateBps, TaxableAmount = line.Amount - line.Discount, TaxAmount = line.Tax,
                Currency = inv.Currency, ReverseCharge = line.TaxType == "reverse_charge",
            });
        }
    }

    public async Task OnPaymentFailed(Payment p)
    {
        if (p.CheckoutSessionId != null)
        {
            var s = await db.CheckoutSessions.FirstAsync(x => x.Id == p.CheckoutSessionId);
            if (s.CouponReserved && s.CouponId != null)
            {
                // Release the redemption reserved at confirm so a failed payment doesn't consume the coupon.
                var c = await db.Coupons.FirstAsync(x => x.Id == s.CouponId);
                c.TimesRedeemed = Math.Max(0, c.TimesRedeemed - 1);
                s.CouponReserved = false;
            }
        }
        if (p.InvoiceId == null) return;
        var inv = await db.Invoices.FirstAsync(i => i.Id == p.InvoiceId);
        inv.AttemptCount++;
        inv.UpdatedAt = uow.Now;
        uow.Emit("invoice.payment_failed", inv);
        if (inv.SubscriptionId == null || inv.BillingReason == "subscription_create") return;
        var sub = await db.Subscriptions.FirstAsync(x => x.Id == inv.SubscriptionId);
        var org = await db.Organizations.FirstAsync(o => o.Id == sub.OrgId);
        var schedule = org.DunningRetryDaysCsv.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToArray();
        var now = await billingClock.Now(sub.TestClockId);
        if (sub.Status != "PAST_DUE")
        {
            uow.Transition("subscription", sub.Id, sub.Status, "PAST_DUE", reason: p.FailureCode);
            sub.Status = "PAST_DUE";
            sub.PastDueSince = now;
            inv.Status = "PAST_DUE";
        }
        sub.DunningAttempts++;
        sub.UpdatedAt = uow.Now;
        if (sub.DunningAttempts <= schedule.Length)
        {
            sub.NextRetryAt = now.AddDays(schedule[sub.DunningAttempts - 1]);
            uow.Emit("subscription.past_due", sub);
        }
        else
        {
            // Dunning exhausted (§27): apply the merchant's final action.
            sub.NextRetryAt = null;
            inv.Status = "UNCOLLECTIBLE";
            uow.Transition("invoice", inv.Id, "PAST_DUE", "UNCOLLECTIBLE", reason: "dunning exhausted");
            if (org.DunningFinalAction == "cancel")
            {
                uow.Transition("subscription", sub.Id, sub.Status, "CANCELLED", reason: "dunning exhausted");
                sub.Status = "CANCELLED";
                sub.CanceledAt = now;
                sub.CancellationReason = "payment_failed";
                await entitlements.RevokeBySource(sub.Id, "subscription cancelled after failed payments");
                uow.Emit("subscription.cancelled", sub);
            }
        }
    }

    public async Task OnRefunded(Payment p, Refund r, bool full)
    {
        if (p.OrderId != null)
        {
            var order = await db.Orders.FirstAsync(o => o.Id == p.OrderId);
            order.AmountRefunded += r.Amount;
            order.Status = full ? "refunded" : "partially_refunded";
            order.UpdatedAt = uow.Now;
            uow.Emit("order.updated", order);
            if (full) await entitlements.RevokeBySource(order.Id, "order refunded");
        }
        if (full) await affiliates.ReverseForPayment(p.Id, "payment refunded");
        if (p.InvoiceId != null)
        {
            var inv = await db.Invoices.FirstAsync(i => i.Id == p.InvoiceId);
            var count = await db.CreditNotes.CountAsync(c => c.InvoiceId == inv.Id);
            var note = new CreditNote
            {
                Id = Ids.New("cn"), CreatedAt = uow.Now, InvoiceId = inv.Id, Number = $"{inv.Number}-CN{count + 1}", Amount = r.Amount,
                Tax = r.TaxAmount, Currency = r.Currency, Reason = r.Reason ?? "refund", RefundId = r.Id,
            };
            db.CreditNotes.Add(note);
            uow.Emit("credit_note.created", note);
        }
    }

    public async Task OnDisputeLost(Payment p, Dispute d)
    {
        await affiliates.ReverseForPayment(p.Id, "chargeback lost");
        if (p.OrderId != null)
        {
            var order = await db.Orders.FirstAsync(o => o.Id == p.OrderId);
            order.Status = "chargeback";
            order.UpdatedAt = uow.Now;
            await entitlements.RevokeBySource(order.Id, "chargeback lost");
        }
        if (p.InvoiceId != null)
        {
            var inv = await db.Invoices.FirstAsync(i => i.Id == p.InvoiceId);
            if (inv.SubscriptionId != null) await entitlements.RevokeBySource(inv.SubscriptionId, "chargeback lost");
        }
    }
}

/// <summary>Credit ledger (§30, §242): every movement is a row; consumption is atomic inside a serialized unit of work.</summary>
public class CreditService(AppDb db, Uow uow)
{
    public async Task<(long Available, long Reserved)> Balance(string customerId, string creditType)
    {
        var q = db.CreditLedger.Where(e => e.CustomerId == customerId && e.CreditType == creditType);
        return (await q.SumAsync(e => (long?)e.Delta) ?? 0, await q.SumAsync(e => (long?)e.ReservedDelta) ?? 0);
    }

    public async Task<CreditLedgerEntry> Apply(string customerId, string creditType, string op, long amount, string? idempotencyKey,
        string? sourceType, string? sourceId, string? description, DateTime? expiresAt = null)
    {
        if (!uow.InTransaction) return await uow.Run(() => Apply(customerId, creditType, op, amount, idempotencyKey, sourceType, sourceId, description, expiresAt));
        if (amount <= 0 && op != "adjust") throw ApiException.Invalid("amount must be positive.");
        if (idempotencyKey != null)
        {
            var dup = await db.CreditLedger.FirstOrDefaultAsync(e => e.IdempotencyKey == idempotencyKey);
            if (dup != null) return dup;
        }
        await db.SaveChangesAsync();
        var (available, reserved) = await Balance(customerId, creditType);
        long delta, reservedDelta = 0;
        switch (op)
        {
            case "issue": case "refund": delta = amount; break;
            case "consume":
                if (available < amount) throw new ApiException(402, "insufficient_credits", $"Only {available} credits available.");
                delta = -amount; break;
            case "reserve":
                if (available < amount) throw new ApiException(402, "insufficient_credits", $"Only {available} credits available.");
                delta = -amount; reservedDelta = amount; break;
            case "release":
                if (reserved < amount) throw ApiException.Invalid($"Only {reserved} credits are reserved.");
                delta = amount; reservedDelta = -amount; break;
            case "consume_reserved":
                if (reserved < amount) throw ApiException.Invalid($"Only {reserved} credits are reserved.");
                delta = 0; reservedDelta = -amount; break;
            case "expire":
                delta = -Math.Min(amount, available); break;
            case "adjust": delta = amount; break;
            default: throw ApiException.Invalid("Unknown credit operation.");
        }
        if (available + delta < 0) throw new ApiException(402, "insufficient_credits", "Credit balance cannot go negative.");
        var entry = new CreditLedgerEntry
        {
            Id = Ids.New("cle"), CreatedAt = uow.Now, CustomerId = customerId, CreditType = creditType, Operation = op, Delta = delta,
            ReservedDelta = reservedDelta, BalanceAfter = available + delta, SourceType = sourceType, SourceId = sourceId,
            IdempotencyKey = idempotencyKey, ExpiresAt = expiresAt, Description = description,
        };
        db.CreditLedger.Add(entry);
        await db.SaveChangesAsync();
        uow.Emit("credits.updated", entry);
        return entry;
    }
}
