using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Engines;
using PaymentApp.Api.Modules.Payments;

namespace PaymentApp.Api.Modules.Billing;

public record InvoiceLineRequest(string? PriceId, string? Description, long Quantity, long? UnitAmount);

/// <summary>
/// Subscription and invoicing engine (§25-§27, §31, §183). Invoice amounts are computed from pure engines
/// and the exact inputs are stored with the invoice (§26).
/// </summary>
public class BillingService(AppDb db, Uow uow, PaymentService payments, Fulfillment fulfillment, EntitlementService entitlements,
    BillingClock billingClock, IConfiguration config)
{
    // ───────────────────────── Creation ─────────────────────────

    public async Task<Subscription> CreateFromCheckout(CheckoutSession s, Customer customer, PaymentMethod pm, string country)
    {
        var now = uow.Now;
        var prices = await db.Prices.Where(p => s.LineItems.Select(l => l.PriceId).Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        var recurring = s.LineItems.Where(l => prices[l.PriceId].Type == "recurring").ToList();
        var first = prices[recurring[0].PriceId];
        var trial = s.TrialDays > 0;
        var periodEnd = trial ? now.AddDays(s.TrialDays) : PricingEngine.AddInterval(now, first.Interval!, first.IntervalCount);
        var sub = new Subscription
        {
            Id = Ids.New("sub"), CreatedAt = now, UpdatedAt = now, CustomerId = customer.Id, Currency = s.Currency, Status = "INCOMPLETE",
            CurrentPeriodStart = now, CurrentPeriodEnd = periodEnd, BillingAnchor = now, TrialEnd = trial ? periodEnd : null,
            CouponId = s.CouponId, CouponPeriodsUsed = s.CouponId != null ? 1 : 0, DefaultPaymentMethodId = pm.Id, Country = country,
        };
        db.Subscriptions.Add(sub);
        foreach (var l in recurring)
            db.SubscriptionItems.Add(new SubscriptionItem { Id = Ids.New("si"), CreatedAt = now, SubscriptionId = sub.Id, PriceId = l.PriceId, Quantity = l.Quantity });

        // The first invoice mirrors the checkout exactly, so the invoice total equals the amount charged.
        var inv = await NewInvoice(customer, sub.Id, "subscription_create", s.Currency, now, periodEnd, "charge_automatically", 0);
        var sort = 0;
        foreach (var l in s.LineItems)
        {
            db.InvoiceLines.Add(new InvoiceLine
            {
                Id = Ids.New("il"), CreatedAt = now, InvoiceId = inv.Id, PriceId = l.PriceId, ProductId = l.ProductId, Description = l.Description ?? "",
                Quantity = l.Quantity, UnitAmount = l.UnitAmount, Amount = l.Amount, Discount = l.Discount, Tax = l.Tax, TaxRateBps = l.TaxRateBps,
                TaxRuleId = l.TaxRuleId, TaxRuleVersion = l.TaxRuleVersion, TaxType = l.TaxType, PeriodStart = now, PeriodEnd = periodEnd, Sort = sort++,
            });
        }
        inv.Subtotal = s.Subtotal;
        inv.Discount = s.Discount;
        inv.Tax = s.Tax;
        inv.Total = s.Total;
        inv.AmountDue = s.Total;
        inv.CalculationInputsJson = Json.Serialize(new { source = "checkout_session", checkout_session = s.Id, lines = s.LineItems, country });
        Finalize(inv);
        sub.LatestInvoiceId = inv.Id;
        await db.SaveChangesAsync();
        return sub;
    }

    public async Task FulfilZeroTotalCheckout(CheckoutSession s, Customer customer, Order order)
    {
        order.Status = "paid";
        order.UpdatedAt = uow.Now;
        if (s.SubscriptionId != null)
        {
            var sub = await db.Subscriptions.FirstAsync(x => x.Id == s.SubscriptionId);
            var inv = await db.Invoices.FirstAsync(i => i.Id == sub.LatestInvoiceId);
            await fulfillment.MarkInvoicePaidWithoutPayment(inv);
        }
        await fulfillment.CompleteCheckout(s, null);
    }

    /// <summary>API-created subscription (sales-assisted / server-side flows).</summary>
    public async Task<Subscription> Create(string customerId, IReadOnlyList<(string PriceId, long Quantity)> items, string? paymentMethodId,
        string? couponCode, int? trialDays, string collectionMethod, int daysUntilDue, string? testClockId, string? metadataJson)
    {
        var customer = await db.Customers.FirstOrDefaultAsync(c => c.Id == customerId) ?? throw ApiException.NotFound("customer");
        if (items.Count == 0) throw ApiException.Invalid("items are required.");
        var priceIds = items.Select(i => i.PriceId).ToList();
        var prices = await db.Prices.Where(p => priceIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        foreach (var i in items)
        {
            if (!prices.TryGetValue(i.PriceId, out var p)) throw ApiException.NotFound($"price '{i.PriceId}'");
            if (p.Type != "recurring" || !p.Active) throw ApiException.Invalid($"{p.Id} is not an active recurring price.");
        }
        if (prices.Values.Select(p => (p.Currency, p.Interval, p.IntervalCount)).Distinct().Count() > 1)
            throw ApiException.Invalid("All items must share currency and billing interval.");
        if (collectionMethod == "charge_automatically")
        {
            paymentMethodId ??= customer.DefaultPaymentMethodId;
            if (paymentMethodId == null) throw ApiException.Invalid("A payment method is required for automatic collection.");
            _ = await db.PaymentMethods.FirstOrDefaultAsync(p => p.Id == paymentMethodId && p.CustomerId == customer.Id) ?? throw ApiException.NotFound("payment method");
        }
        Coupon? coupon = null;
        if (couponCode != null)
            coupon = await db.Coupons.FirstOrDefaultAsync(c => c.Code == couponCode.ToUpperInvariant() && c.Active) ?? throw new ApiException(400, "coupon_invalid", "Unknown coupon.");
        if (testClockId != null) _ = await db.TestClocks.FirstOrDefaultAsync(c => c.Id == testClockId) ?? throw ApiException.NotFound("test clock");

        var sub = await uow.Run(async () =>
        {
            var now = await billingClock.Now(testClockId);
            var first = prices[items[0].PriceId];
            var trial = trialDays ?? prices.Values.Max(p => p.TrialDays);
            var end = trial > 0 ? now.AddDays(trial) : PricingEngine.AddInterval(now, first.Interval!, first.IntervalCount);
            var s = new Subscription
            {
                Id = Ids.New("sub"), CreatedAt = uow.Now, UpdatedAt = uow.Now, CustomerId = customer.Id, Currency = first.Currency, Status = "INCOMPLETE",
                CurrentPeriodStart = now, CurrentPeriodEnd = end, BillingAnchor = now, TrialEnd = trial > 0 ? end : null, CouponId = coupon?.Id,
                DefaultPaymentMethodId = paymentMethodId, CollectionMethod = collectionMethod, DaysUntilDue = daysUntilDue, TestClockId = testClockId,
                Country = customer.Country, MetadataJson = metadataJson,
            };
            db.Subscriptions.Add(s);
            foreach (var (priceId, qty) in items)
                db.SubscriptionItems.Add(new SubscriptionItem { Id = Ids.New("si"), CreatedAt = uow.Now, SubscriptionId = s.Id, PriceId = priceId, Quantity = qty });
            await db.SaveChangesAsync();
            var inv = await BuildInvoice(s, customer, "subscription_create", now, end, null, now, includeLicensed: trial == 0, now);
            s.LatestInvoiceId = inv.Id;
            if (inv.AmountDue == 0)
            {
                await fulfillment.MarkInvoicePaidWithoutPayment(inv);
                if (s.Status == "INCOMPLETE")
                {
                    uow.Transition("subscription", s.Id, "INCOMPLETE", trial > 0 ? "TRIALING" : "ACTIVE");
                    s.Status = trial > 0 ? "TRIALING" : "ACTIVE";
                    uow.Emit("subscription.created", s);
                }
                foreach (var (priceId, qty) in items)
                    await entitlements.Grant(customer.Id, prices[priceId].ProductId, "subscription", s.Id, qty);
            }
            return s;
        });
        if (sub.Status == "INCOMPLETE" && sub.CollectionMethod == "charge_automatically")
            await ChargeInvoice(await db.Invoices.FirstAsync(i => i.Id == sub.LatestInvoiceId), offSession: false);
        else if (sub.Status == "INCOMPLETE")
            await uow.Run(async () =>
            {
                // send_invoice: access starts now, the invoice is collected on terms (§180).
                uow.Transition("subscription", sub.Id, "INCOMPLETE", "ACTIVE", reason: "invoice sent on terms");
                sub.Status = "ACTIVE";
                foreach (var (priceId, qty) in items) await entitlements.Grant(customer.Id, prices[priceId].ProductId, "subscription", sub.Id, qty);
                uow.Emit("subscription.created", sub);
            });
        return await db.Subscriptions.FirstAsync(s => s.Id == sub.Id);
    }

    // ───────────────────────── Invoice building ─────────────────────────

    private async Task<Invoice> NewInvoice(Customer customer, string? subscriptionId, string reason, string currency, DateTime? periodStart, DateTime? periodEnd,
        string collection, int daysUntilDue)
    {
        var org = await db.Organizations.FirstAsync(o => o.Id == db.Tenant.OrgId);
        org.InvoiceSequence++;
        var prefix = string.IsNullOrEmpty(org.InvoicePrefix) ? org.Id[^6..].ToUpperInvariant() : org.InvoicePrefix;
        var inv = new Invoice
        {
            Id = Ids.New("inv"), CreatedAt = uow.Now, UpdatedAt = uow.Now, Number = $"{prefix}-{org.InvoiceSequence:D5}", CustomerId = customer.Id,
            SubscriptionId = subscriptionId, BillingReason = reason, Currency = currency, PeriodStart = periodStart, PeriodEnd = periodEnd,
            CustomerName = customer.Name, CustomerEmail = customer.Email, CustomerTaxId = customer.TaxId, CustomerCountry = customer.Country,
            SellerOfRecord = config["Platform:LegalEntityName"], DueDate = collection == "send_invoice" ? uow.Now.AddDays(daysUntilDue) : uow.Now,
            Status = "DRAFT",
        };
        db.Invoices.Add(inv);
        uow.Emit("invoice.created", inv);
        return inv;
    }

    private void Finalize(Invoice inv)
    {
        uow.Transition("invoice", inv.Id, inv.Status, "OPEN");
        inv.Status = "OPEN";
        inv.FinalizedAt = uow.Now;
        uow.Emit("invoice.finalized", inv);
    }

    public async Task<Invoice> BuildInvoice(Subscription sub, Customer customer, string reason, DateTime periodStart, DateTime periodEnd,
        DateTime? usageFrom, DateTime usageTo, bool includeLicensed, DateTime now)
    {
        var items = await db.SubscriptionItems.Where(i => i.SubscriptionId == sub.Id && !i.Deleted).ToListAsync();
        var priceIds = items.Select(i => i.PriceId).ToList();
        var prices = await db.Prices.Where(p => priceIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        var productIds = prices.Values.Select(p => p.ProductId).ToList();
        var products = await db.Products.Where(p => productIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        var country = customer.Country ?? sub.Country ?? "";
        var rules = await db.TaxRules.Where(r => r.Country == country).ToListAsync();
        var inv = await NewInvoice(customer, sub.Id, reason, sub.Currency, periodStart, periodEnd, sub.CollectionMethod, sub.DaysUntilDue);

        var lines = new List<InvoiceLine>();
        var usageInputs = new List<object>();
        foreach (var item in items)
        {
            var price = prices[item.PriceId];
            var product = products[price.ProductId];
            if (price.UsageType == "metered")
            {
                var meter = await db.Meters.FirstAsync(m => m.Id == price.MeterId);
                var events = await db.UsageEvents.Where(e => e.CustomerId == customer.Id && e.EventName == meter.EventName && e.InvoiceId == null && e.Timestamp < usageTo).ToListAsync();
                var qty = Aggregate(meter.Aggregation, events);
                var late = usageFrom != null ? events.Count(e => e.Timestamp < usageFrom) : 0;
                foreach (var e in events) e.InvoiceId = inv.Id;
                usageInputs.Add(new { meter = meter.Id, meter.EventName, meter.Aggregation, events = events.Count, late_events = late, quantity = qty });
                lines.Add(new InvoiceLine
                {
                    Description = $"{product.Name} — {qty:N0} {meter.Unit ?? meter.EventName}" + (late > 0 ? $" (incl. {late} late events)" : ""),
                    PriceId = price.Id, ProductId = product.Id, Quantity = qty, UnitAmount = price.UnitAmount, Amount = PricingEngine.Amount(price, qty, country),
                    PeriodStart = usageFrom, PeriodEnd = usageTo,
                });
            }
            else if (includeLicensed)
            {
                lines.Add(new InvoiceLine
                {
                    Description = item.Quantity > 1 ? $"{product.Name} × {item.Quantity}" : product.Name, PriceId = price.Id, ProductId = product.Id,
                    Quantity = item.Quantity, UnitAmount = PricingEngine.UnitAmountFor(price, country), Amount = PricingEngine.Amount(price, item.Quantity, country),
                    PeriodStart = periodStart, PeriodEnd = periodEnd,
                });
            }
        }

        Coupon? coupon = sub.CouponId == null ? null : await db.Coupons.FirstOrDefaultAsync(c => c.Id == sub.CouponId);
        var couponApplies = coupon != null && (coupon.Duration == "forever" || (coupon.Duration == "once" && sub.CouponPeriodsUsed == 0)
                                               || (coupon.Duration == "repeating" && sub.CouponPeriodsUsed < (coupon.DurationInMonths ?? 0)));
        if (couponApplies)
        {
            var asItems = lines.Select(l => new LineItem { ProductId = l.ProductId, Amount = l.Amount }).ToList();
            Checkout.CheckoutCalculator.ApplyDiscount(coupon!, asItems, sub.Currency);
            for (var i = 0; i < lines.Count; i++) lines[i].Discount = asItems[i].Discount;
            sub.CouponPeriodsUsed++;
        }

        var taxCtx = new TaxContext(country, customer.CustomerType, customer.TaxId, customer.TaxStatus == "exempt");
        var ruleInputs = new List<object>();
        var sort = 0;
        foreach (var l in lines)
        {
            var price = prices[l.PriceId!];
            var r = TaxEngine.ComputeLine(l.Amount - l.Discount, products[price.ProductId].TaxCategory, price.TaxBehavior == "inclusive", taxCtx, rules, now, sub.Currency);
            l.Tax = r.Tax;
            l.TaxRateBps = r.RateBps;
            l.TaxRuleId = r.Rule?.Id;
            l.TaxRuleVersion = r.Rule?.Version;
            l.TaxType = r.ReverseCharge ? "reverse_charge" : r.TaxType;
            if (r.Rule != null) ruleInputs.Add(new { r.Rule.Id, r.Rule.Version, r.Rule.RateBps, r.ReverseCharge });
            l.Id = Ids.New("il");
            l.CreatedAt = uow.Now;
            l.InvoiceId = inv.Id;
            l.Sort = sort++;
            db.InvoiceLines.Add(l);
        }
        Totals(inv, lines, prices);
        ApplyCustomerCredit(inv, customer);
        inv.CalculationInputsJson = Json.Serialize(new
        {
            engine_version = 1, period_start = periodStart, period_end = periodEnd, usage_from = usageFrom, usage_to = usageTo, country,
            customer_type = customer.CustomerType, tax_id_present = customer.TaxId != null,
            prices = prices.Values.Select(p => new { p.Id, p.Version, p.Scheme, p.UnitAmount, p.TiersJson, p.TiersMode, p.PackageSize, p.MinimumAmount, p.MaximumAmount, p.CountryAmountsJson }),
            quantities = items.Select(i => new { i.PriceId, i.Quantity }),
            usage = usageInputs, coupon = couponApplies ? new { coupon!.Id, coupon.PercentOffBps, coupon.AmountOff } : null, tax_rules = ruleInputs,
        });
        Finalize(inv);
        if (inv.AmountDue == 0) await fulfillment.MarkInvoicePaidWithoutPayment(inv);
        await db.SaveChangesAsync();
        return inv;
    }

    private static long Aggregate(string aggregation, List<UsageEvent> events) => aggregation switch
    {
        "count" => events.Count(e => e.CorrectsEventId == null),
        "max" => events.Count == 0 ? 0 : events.Max(e => e.Quantity),
        "last" => events.OrderBy(e => e.Timestamp).LastOrDefault()?.Quantity ?? 0,
        _ => Math.Max(0, events.Sum(e => e.Quantity)),
    };

    private static void Totals(Invoice inv, List<InvoiceLine> lines, Dictionary<string, Price> prices)
    {
        inv.Subtotal = lines.Sum(l => l.Amount);
        inv.Discount = lines.Sum(l => l.Discount);
        inv.Tax = lines.Sum(l => l.Tax);
        var exclusiveTax = lines.Where(l => l.PriceId == null || prices.GetValueOrDefault(l.PriceId)?.TaxBehavior != "inclusive").Sum(l => l.Tax);
        inv.Total = inv.Subtotal - inv.Discount + exclusiveTax;
        inv.AmountDue = inv.Total;
    }

    private void ApplyCustomerCredit(Invoice inv, Customer customer)
    {
        if (customer.CreditBalance <= 0 || customer.CreditCurrency != inv.Currency || inv.AmountDue <= 0) return;
        var applied = Math.Min(customer.CreditBalance, inv.AmountDue);
        customer.CreditBalance -= applied;
        inv.AmountCredited = applied;
        inv.AmountDue -= applied;
    }

    // ───────────────────────── Collection ─────────────────────────

    public async Task<Payment?> ChargeInvoice(Invoice inv, bool offSession)
    {
        if (inv.Status is not ("OPEN" or "PAST_DUE")) throw ApiException.Conflict("invoice_not_payable", $"Invoice is {inv.Status}.");
        if (inv.AmountDue == 0) { await uow.Run(() => fulfillment.MarkInvoicePaidWithoutPayment(inv)); return null; }
        var customer = await db.Customers.FirstAsync(c => c.Id == inv.CustomerId);
        string? pmId = customer.DefaultPaymentMethodId;
        if (inv.SubscriptionId != null) pmId = (await db.Subscriptions.FirstAsync(s => s.Id == inv.SubscriptionId)).DefaultPaymentMethodId ?? pmId;
        if (pmId == null)
        {
            await uow.Run(async () => { inv.AttemptCount++; uow.Emit("invoice.payment_action_required", inv); await Task.CompletedTask; });
            return null;
        }
        return await payments.Pay(new PayRequest(inv.OrgId, inv.Livemode, inv.AmountDue, inv.Currency, inv.Tax, inv.CustomerCountry, customer.Id,
            customer.Email, customer.Country, pmId, null, null, inv.Id, null, $"Invoice {inv.Number}", offSession, null, null));
    }

    // ───────────────────────── Renewals & dunning (§26, §27, §95) ─────────────────────────

    /// <summary>Renews every subscription whose period has ended at <paramref name="now"/> and retries due dunning attempts.</summary>
    public async Task<int> RunDue(DateTime now, string? testClockId)
    {
        List<Subscription> due;
        using (db.Tenant.Elevate())
            due = await db.Subscriptions.AsNoTracking()
                .Where(s => s.TestClockId == testClockId && (s.Status == "ACTIVE" || s.Status == "TRIALING" || s.Status == "PAST_DUE") && s.CurrentPeriodEnd <= now)
                .OrderBy(s => s.CurrentPeriodEnd).ToListAsync();
        var processed = 0;
        foreach (var snapshot in due)
        {
            using var _ = db.Tenant.Use(snapshot.OrgId, snapshot.Livemode);
            await Renew(snapshot.Id);
            processed++;
        }
        List<Subscription> retries;
        using (db.Tenant.Elevate())
            retries = await db.Subscriptions.AsNoTracking()
                .Where(s => s.TestClockId == testClockId && s.Status == "PAST_DUE" && s.NextRetryAt != null && s.NextRetryAt <= now).ToListAsync();
        foreach (var snapshot in retries)
        {
            using var _ = db.Tenant.Use(snapshot.OrgId, snapshot.Livemode);
            var inv = await db.Invoices.FirstAsync(i => i.Id == snapshot.LatestInvoiceId);
            if (inv.Status is "OPEN" or "PAST_DUE") await ChargeInvoice(inv, offSession: true);
            processed++;
        }
        return processed;
    }

    public async Task Renew(string subscriptionId)
    {
        var invoice = await uow.Run(async () =>
        {
            var sub = await db.Subscriptions.FirstAsync(s => s.Id == subscriptionId);
            var customer = await db.Customers.FirstAsync(c => c.Id == sub.CustomerId);
            var at = sub.CurrentPeriodEnd;
            if (sub.CancelAtPeriodEnd)
            {
                uow.Transition("subscription", sub.Id, sub.Status, "CANCELLED", reason: "cancel_at_period_end");
                sub.Status = "CANCELLED";
                sub.CanceledAt = at;
                sub.UpdatedAt = uow.Now;
                await entitlements.RevokeBySource(sub.Id, "subscription ended");
                uow.Emit("subscription.cancelled", sub);
                return null;
            }
            var firstItem = await db.SubscriptionItems.FirstAsync(i => i.SubscriptionId == sub.Id && !i.Deleted);
            var price = await db.Prices.FirstAsync(p => p.Id == firstItem.PriceId);
            var nextEnd = PricingEngine.AddInterval(at, price.Interval!, price.IntervalCount);
            var usageFrom = sub.CurrentPeriodStart;
            var inv = await BuildInvoice(sub, customer, "subscription_cycle", at, nextEnd, usageFrom, at, includeLicensed: true, at);
            sub.CurrentPeriodStart = at;
            sub.CurrentPeriodEnd = nextEnd;
            sub.LatestInvoiceId = inv.Id;
            sub.UpdatedAt = uow.Now;
            if (sub.Status == "TRIALING" && sub.TrialEnd <= at && inv.Status == "PAID")
            {
                uow.Transition("subscription", sub.Id, "TRIALING", "ACTIVE", reason: "trial ended");
                sub.Status = "ACTIVE";
                uow.Emit("subscription.trial_ended", sub);
            }
            return inv;
        });
        if (invoice is { Status: "OPEN" })
        {
            var sub = await db.Subscriptions.FirstAsync(s => s.Id == subscriptionId);
            if (sub.CollectionMethod == "charge_automatically") await ChargeInvoice(invoice, offSession: true);
        }
    }

    public async Task<TestClock> AdvanceClock(TestClock clock, DateTime to)
    {
        if (to <= clock.FrozenTime) throw ApiException.Invalid("A test clock can only move forward.");
        if (to > clock.FrozenTime.AddYears(2)) throw ApiException.Invalid("Advance at most two years at a time.");
        for (var guard = 0; guard < 500; guard++)
        {
            List<DateTime> upcoming;
            using (db.Tenant.Elevate())
            {
                var subs = await db.Subscriptions.AsNoTracking().Where(s => s.TestClockId == clock.Id && (s.Status == "ACTIVE" || s.Status == "TRIALING" || s.Status == "PAST_DUE")).ToListAsync();
                upcoming = subs.Select(s => s.CurrentPeriodEnd).Concat(subs.Where(s => s.Status == "PAST_DUE" && s.NextRetryAt != null).Select(s => s.NextRetryAt!.Value))
                    .Where(t => t > clock.FrozenTime && t <= to).OrderBy(t => t).ToList();
            }
            if (upcoming.Count == 0) break;
            await uow.Run(async () => { clock.FrozenTime = upcoming[0]; clock.Status = "advancing"; await Task.CompletedTask; });
            await RunDue(clock.FrozenTime, clock.Id);
        }
        await uow.Run(async () => { clock.FrozenTime = to; clock.Status = "ready"; uow.Emit("test_clock.ready", clock); await Task.CompletedTask; });
        await RunDue(to, clock.Id);
        return clock;
    }

    // ───────────────────────── Changes (§183) ─────────────────────────

    public async Task<object> ChangePlan(string subscriptionId, string newPriceId, long quantity, bool preview)
    {
        var sub = await db.Subscriptions.FirstOrDefaultAsync(s => s.Id == subscriptionId) ?? throw ApiException.NotFound("subscription");
        if (sub.Status is not ("ACTIVE" or "TRIALING")) throw ApiException.Conflict("invalid_state", $"Cannot change a {sub.Status} subscription.");
        var item = await db.SubscriptionItems.Where(i => i.SubscriptionId == sub.Id && !i.Deleted).ToListAsync();
        var licensed = new List<(SubscriptionItem Item, Price Price)>();
        foreach (var i in item)
        {
            var p = await db.Prices.FirstAsync(x => x.Id == i.PriceId);
            if (p.UsageType == "licensed") licensed.Add((i, p));
        }
        if (licensed.Count != 1) throw ApiException.Invalid("Plan changes are supported on subscriptions with exactly one licensed item.");
        var (oldItem, oldPrice) = licensed[0];
        var newPrice = await db.Prices.FirstOrDefaultAsync(p => p.Id == newPriceId && p.Active) ?? throw ApiException.NotFound("price");
        if (newPrice.Type != "recurring" || newPrice.Currency != oldPrice.Currency || newPrice.Interval != oldPrice.Interval || newPrice.IntervalCount != oldPrice.IntervalCount)
            throw ApiException.Invalid("The new price must be recurring with the same currency and interval.");
        if (quantity < 1) throw ApiException.Invalid("quantity must be at least 1.");
        var customer = await db.Customers.FirstAsync(c => c.Id == sub.CustomerId);
        var country = customer.Country ?? sub.Country;
        var now = await billingClock.Now(sub.TestClockId);
        var total = (long)(sub.CurrentPeriodEnd - sub.CurrentPeriodStart).TotalSeconds;
        var remaining = Math.Clamp((long)(sub.CurrentPeriodEnd - now).TotalSeconds, 0, total);
        var trialing = sub.Status == "TRIALING";
        var oldAmount = PricingEngine.Amount(oldPrice, oldItem.Quantity, country);
        var newAmount = PricingEngine.Amount(newPrice, quantity, country);
        var credit = trialing ? 0 : Money.Ratio(oldAmount, remaining, total, sub.Currency);
        var charge = trialing ? 0 : Money.Ratio(newAmount, remaining, total, sub.Currency);
        var net = charge - credit;
        var summary = new
        {
            @object = "proration_preview", subscription = sub.Id, from_price = oldPrice.Id, to_price = newPrice.Id, quantity,
            period_end = sub.CurrentPeriodEnd, remaining_fraction = total == 0 ? 0 : Math.Round((double)remaining / total, 4),
            credit_for_unused_time = credit, charge_for_remaining_time = charge, net_amount = net, currency = sub.Currency,
            behavior = net > 0 ? "charged_now_plus_tax" : net < 0 ? "credited_to_next_invoice" : "no_charge",
            next_invoice_amount_before_tax = newAmount,
        };
        if (preview) return summary;

        var invoiceToCharge = await uow.Run(async () =>
        {
            oldItem.PriceId = newPrice.Id;
            oldItem.Quantity = quantity;
            sub.UpdatedAt = uow.Now;
            Invoice? inv = null;
            if (net > 0)
            {
                inv = await NewInvoice(customer, sub.Id, "proration", sub.Currency, now, sub.CurrentPeriodEnd, sub.CollectionMethod, sub.DaysUntilDue);
                var product = await db.Products.FirstAsync(p => p.Id == newPrice.ProductId);
                var rules = await db.TaxRules.Where(r => r.Country == country).ToListAsync();
                var r = TaxEngine.ComputeLine(net, product.TaxCategory, newPrice.TaxBehavior == "inclusive", new TaxContext(country ?? "", customer.CustomerType, customer.TaxId),
                    rules, now, sub.Currency);
                db.InvoiceLines.Add(new InvoiceLine
                {
                    Id = Ids.New("il"), CreatedAt = uow.Now, InvoiceId = inv.Id, PriceId = newPrice.Id, ProductId = product.Id, Proration = true,
                    Description = $"Remaining time on {product.Name} (after credit {Money.Format(credit, sub.Currency)})", Quantity = 1, UnitAmount = net, Amount = net,
                    Tax = r.Tax, TaxRateBps = r.RateBps, TaxRuleId = r.Rule?.Id, TaxRuleVersion = r.Rule?.Version, TaxType = r.TaxType, PeriodStart = now, PeriodEnd = sub.CurrentPeriodEnd,
                });
                inv.Subtotal = net;
                inv.Tax = r.Tax;
                inv.Total = net + (r.Inclusive ? 0 : r.Tax);
                inv.AmountDue = inv.Total;
                inv.CalculationInputsJson = Json.Serialize(summary);
                Finalize(inv);
            }
            else if (net < 0)
            {
                customer.CreditBalance += -net;
                customer.CreditCurrency = sub.Currency;
            }
            if (oldPrice.ProductId != newPrice.ProductId)
            {
                foreach (var e in await db.Entitlements.Where(e => e.SourceId == sub.Id && e.ProductId == oldPrice.ProductId && e.Status == "active").ToListAsync())
                {
                    e.Status = "revoked"; e.RevokedAt = uow.Now; e.RevokeReason = "plan changed";
                    uow.Emit("entitlement.revoked", e);
                }
            }
            await entitlements.Grant(customer.Id, newPrice.ProductId, "subscription", sub.Id, quantity);
            uow.Emit("subscription.updated", sub);
            uow.Audit("subscription.change_plan", "subscription", sub.Id, new { oldPrice = oldPrice.Id, oldQty = summary.from_price }, new { newPrice = newPrice.Id, quantity, net });
            return inv;
        });
        if (invoiceToCharge != null && sub.CollectionMethod == "charge_automatically") await ChargeInvoice(invoiceToCharge, offSession: true);
        return summary;
    }

    public async Task<Subscription> Cancel(string id, bool atPeriodEnd, string? reason)
    {
        return await uow.Run(async () =>
        {
            var sub = await db.Subscriptions.FirstOrDefaultAsync(s => s.Id == id) ?? throw ApiException.NotFound("subscription");
            if (sub.Status is "CANCELLED" or "EXPIRED") throw ApiException.Conflict("invalid_state", "Subscription is already cancelled.");
            sub.CancellationReason = reason;
            sub.UpdatedAt = uow.Now;
            if (atPeriodEnd && sub.Status != "INCOMPLETE")
            {
                sub.CancelAtPeriodEnd = true;
                uow.Emit("subscription.updated", sub);
            }
            else
            {
                uow.Transition("subscription", sub.Id, sub.Status, "CANCELLED", reason: reason);
                sub.Status = "CANCELLED";
                sub.CanceledAt = await billingClock.Now(sub.TestClockId);
                await entitlements.RevokeBySource(sub.Id, "subscription cancelled");
                uow.Emit("subscription.cancelled", sub);
            }
            uow.Audit("subscription.cancel", "subscription", sub.Id, after: new { atPeriodEnd, reason });
            return sub;
        });
    }

    public async Task<Subscription> Pause(string id, bool pause)
    {
        var result = await uow.Run(async () =>
        {
            var sub = await db.Subscriptions.FirstOrDefaultAsync(s => s.Id == id) ?? throw ApiException.NotFound("subscription");
            var now = await billingClock.Now(sub.TestClockId);
            if (pause)
            {
                if (sub.Status != "ACTIVE") throw ApiException.Conflict("invalid_state", "Only active subscriptions can be paused.");
                uow.Transition("subscription", sub.Id, sub.Status, "PAUSED");
                sub.Status = "PAUSED";
                sub.PausedAt = now;
            }
            else
            {
                if (sub.Status != "PAUSED") throw ApiException.Conflict("invalid_state", "Subscription is not paused.");
                // Resuming starts a fresh period from today (anniversary reset).
                var item = await db.SubscriptionItems.FirstAsync(i => i.SubscriptionId == sub.Id && !i.Deleted);
                var price = await db.Prices.FirstAsync(p => p.Id == item.PriceId);
                uow.Transition("subscription", sub.Id, sub.Status, "ACTIVE", reason: "resumed");
                sub.Status = "ACTIVE";
                sub.PausedAt = null;
                sub.CurrentPeriodStart = now;
                sub.CurrentPeriodEnd = now; // renewal job bills the new period immediately
                _ = price;
            }
            sub.UpdatedAt = uow.Now;
            uow.Emit(pause ? "subscription.paused" : "subscription.resumed", sub);
            uow.Audit(pause ? "subscription.pause" : "subscription.resume", "subscription", sub.Id);
            return sub;
        });
        if (!pause) await Renew(result.Id);
        return await db.Subscriptions.FirstAsync(s => s.Id == id);
    }

    // ───────────────────────── Manual / B2B invoices (§180, §254) ─────────────────────────

    public async Task<Invoice> CreateManualInvoice(string customerId, IReadOnlyList<InvoiceLineRequest> lines, string currency, int daysUntilDue,
        string? purchaseOrder, string? memo, bool autoFinalize)
    {
        var customer = await db.Customers.FirstOrDefaultAsync(c => c.Id == customerId) ?? throw ApiException.NotFound("customer");
        if (lines.Count == 0) throw ApiException.Invalid("At least one line is required.");
        currency = Money.Normalize(currency);
        return await uow.Run(async () =>
        {
            var inv = await NewInvoice(customer, null, "manual", currency, null, null, "send_invoice", daysUntilDue);
            inv.PurchaseOrder = purchaseOrder;
            inv.Memo = memo;
            var country = customer.Country ?? "";
            var rules = await db.TaxRules.Where(r => r.Country == country).ToListAsync();
            var built = new List<InvoiceLine>();
            var sort = 0;
            foreach (var req in lines)
            {
                Price? price = null;
                Product? product = null;
                if (req.PriceId != null)
                {
                    price = await db.Prices.FirstOrDefaultAsync(p => p.Id == req.PriceId) ?? throw ApiException.NotFound("price");
                    product = await db.Products.FirstAsync(p => p.Id == price.ProductId);
                    if (price.Currency != currency) throw ApiException.Invalid("Line price currency must match the invoice currency.");
                }
                if (req.Quantity < 1) throw ApiException.Invalid("quantity must be at least 1.");
                var amount = price != null ? PricingEngine.Amount(price, req.Quantity, country) : checked((req.UnitAmount ?? throw ApiException.Invalid("unit_amount required")) * req.Quantity);
                var r = TaxEngine.ComputeLine(amount, product?.TaxCategory ?? "digital_service", price?.TaxBehavior == "inclusive",
                    new TaxContext(country, customer.CustomerType, customer.TaxId, customer.TaxStatus == "exempt"), rules, uow.Now, currency);
                var line = new InvoiceLine
                {
                    Id = Ids.New("il"), CreatedAt = uow.Now, InvoiceId = inv.Id, PriceId = price?.Id, ProductId = product?.Id,
                    Description = req.Description ?? product?.Name ?? "Item", Quantity = req.Quantity, UnitAmount = price?.UnitAmount ?? req.UnitAmount ?? 0,
                    Amount = amount, Tax = r.Tax, TaxRateBps = r.RateBps, TaxRuleId = r.Rule?.Id, TaxRuleVersion = r.Rule?.Version,
                    TaxType = r.ReverseCharge ? "reverse_charge" : r.TaxType, Sort = sort++,
                };
                built.Add(line);
                db.InvoiceLines.Add(line);
            }
            inv.Subtotal = built.Sum(l => l.Amount);
            inv.Tax = built.Sum(l => l.Tax);
            inv.Total = inv.Subtotal + inv.Tax;
            inv.AmountDue = inv.Total;
            inv.CalculationInputsJson = Json.Serialize(new { source = "manual", lines, country, customer_type = customer.CustomerType });
            if (customer.CreditLimit is { } limit)
            {
                var outstanding = await db.Invoices.Where(i => i.CustomerId == customer.Id && (i.Status == "OPEN" || i.Status == "PAST_DUE")).SumAsync(i => (long?)i.AmountDue) ?? 0;
                if (outstanding + inv.AmountDue > limit) throw new ApiException(402, "credit_limit_exceeded", "This invoice would exceed the customer's credit limit.");
            }
            if (autoFinalize) Finalize(inv);
            uow.Audit("invoice.create", "invoice", inv.Id, after: new { inv.Total, inv.Currency, customerId });
            return inv;
        });
    }

    public async Task<Invoice> FinalizeInvoice(string id)
    {
        return await uow.Run(async () =>
        {
            var inv = await db.Invoices.FirstOrDefaultAsync(i => i.Id == id) ?? throw ApiException.NotFound("invoice");
            if (inv.Status != "DRAFT") throw ApiException.Conflict("invalid_state", "Only draft invoices can be finalized.");
            Finalize(inv);
            return inv;
        });
    }

    public async Task<Invoice> VoidInvoice(string id, bool uncollectible)
    {
        return await uow.Run(async () =>
        {
            var inv = await db.Invoices.FirstOrDefaultAsync(i => i.Id == id) ?? throw ApiException.NotFound("invoice");
            if (inv.Status is "PAID" or "VOID") throw ApiException.Conflict("invalid_state", $"A {inv.Status} invoice cannot be changed. Issue a credit note/refund instead.");
            var to = uncollectible ? "UNCOLLECTIBLE" : "VOID";
            uow.Transition("invoice", inv.Id, inv.Status, to);
            inv.Status = to;
            inv.UpdatedAt = uow.Now;
            uow.Emit(uncollectible ? "invoice.marked_uncollectible" : "invoice.voided", inv);
            uow.Audit($"invoice.{to.ToLowerInvariant()}", "invoice", inv.Id);
            await Task.CompletedTask;
            return inv;
        });
    }
}
