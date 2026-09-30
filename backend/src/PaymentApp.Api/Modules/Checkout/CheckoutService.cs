using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Billing;
using PaymentApp.Api.Modules.Engines;
using PaymentApp.Api.Modules.Payments;

namespace PaymentApp.Api.Modules.Checkout;

public record LineRequest(string PriceId, long Quantity);

public record Quote(
    List<LineItem> Lines, string Currency, long Subtotal, long Discount, long Tax, long Total, Coupon? Coupon,
    string TaxLabel, int TrialDays, string? RecurringSummary, List<string> Notes);

/// <summary>
/// Server-authoritative checkout calculation (§16, §334). The client only ever displays what this
/// returns; the confirm step recomputes everything before any money moves.
/// </summary>
public class CheckoutCalculator(AppDb db)
{
    public async Task<Quote> Compute(string mode, IReadOnlyList<LineRequest> requested, string? country, string customerType, string? taxId,
        string? couponCode, DateTime now, string? customerId = null)
    {
        if (requested.Count == 0) throw ApiException.Invalid("At least one line item is required.");
        if (requested.Count > 50) throw ApiException.Invalid("At most 50 line items.");
        var priceIds = requested.Select(r => r.PriceId).Distinct().ToList();
        var prices = await db.Prices.Where(p => priceIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        var productIds = prices.Values.Select(p => p.ProductId).Distinct().ToList();
        var products = await db.Products.Where(p => productIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        var rules = country == null ? [] : await db.TaxRules.Where(r => r.Country == country).ToListAsync();

        var lines = new List<LineItem>();
        string? currency = null, interval = null;
        var trialDays = 0;
        var notes = new List<string>();
        foreach (var req in requested)
        {
            if (!prices.TryGetValue(req.PriceId, out var price)) throw ApiException.NotFound($"price '{req.PriceId}'");
            var product = products[price.ProductId];
            if (!price.Active) throw ApiException.Invalid($"Price {price.Id} is no longer available.");
            if (product.Status != "active") throw ApiException.Invalid($"{product.Name} is not available for purchase.");
            if (req.Quantity < 1 || req.Quantity > 10_000) throw ApiException.Invalid("quantity must be between 1 and 10000.");
            currency ??= price.Currency;
            if (price.Currency != currency) throw ApiException.Invalid("All line items must use the same currency.");
            if (mode == "payment" && price.Type == "recurring") throw ApiException.Invalid("Use mode=subscription for recurring prices.");
            if (price.Type == "recurring")
            {
                var key = $"{price.Interval}/{price.IntervalCount}";
                interval ??= key;
                if (interval != key) throw ApiException.Invalid("All recurring prices in one checkout must share the billing interval.");
                trialDays = Math.Max(trialDays, price.TrialDays);
            }
            var metered = price.UsageType == "metered";
            var amount = metered ? 0 : PricingEngine.Amount(price, req.Quantity, country);
            lines.Add(new LineItem
            {
                PriceId = price.Id, ProductId = product.Id, Quantity = req.Quantity, UnitAmount = PricingEngine.UnitAmountFor(price, country),
                Amount = amount, TaxInclusive = price.TaxBehavior == "inclusive",
                Description = metered ? $"{product.Name} — billed by usage" : product.Name,
            });
        }
        if (mode == "subscription" && interval == null) throw ApiException.Invalid("A subscription checkout needs at least one recurring price.");

        // Free trial: recurring charges start after the trial; one-time lines are still due today.
        if (trialDays > 0)
        {
            foreach (var l in lines.Where(l => prices[l.PriceId].Type == "recurring"))
            {
                l.Description += $" — {trialDays}-day free trial";
                l.Amount = 0;
            }
        }

        var coupon = await ResolveCoupon(couponCode, lines, prices, currency!, country, now, customerId);
        if (coupon != null) ApplyDiscount(coupon, lines, currency!);

        var taxCtx = new TaxContext(country ?? "", customerType, taxId);
        var labels = new HashSet<string>();
        foreach (var l in lines)
        {
            if (country == null) { l.Tax = 0; continue; }
            var product = products[l.ProductId!];
            var r = TaxEngine.ComputeLine(l.Amount - l.Discount, product.TaxCategory, l.TaxInclusive, taxCtx, rules, now, currency!);
            l.Tax = r.Tax;
            l.TaxRateBps = r.RateBps;
            l.TaxRuleId = r.Rule?.Id;
            l.TaxRuleVersion = r.Rule?.Version;
            l.TaxType = r.ReverseCharge ? "reverse_charge" : r.TaxType;
            labels.Add(r.Label);
        }

        var subtotal = lines.Sum(l => l.Amount);
        var discount = lines.Sum(l => l.Discount);
        var exclusiveTax = lines.Where(l => !l.TaxInclusive).Sum(l => l.Tax);
        var tax = lines.Sum(l => l.Tax);
        var total = subtotal - discount + exclusiveTax;
        if (country == null) notes.Add("Tax is calculated once the billing country is known.");

        string? recurring = null;
        if (interval != null)
        {
            var recurringAmount = requested.Where(r => prices[r.PriceId].Type == "recurring" && prices[r.PriceId].UsageType != "metered")
                .Sum(r => PricingEngine.Amount(prices[r.PriceId], r.Quantity, country));
            var parts = interval.Split('/');
            recurring = $"{Money.Format(recurringAmount, currency!)} every {(parts[1] == "1" ? parts[0] : parts[1] + " " + parts[0] + "s")}"
                        + (lines.Any(l => prices[l.PriceId].UsageType == "metered") ? " plus usage" : "")
                        + (coupon?.Duration == "forever" ? " before discount" : "") + " (plus applicable tax)";
        }
        return new Quote(lines, currency!, subtotal, discount, tax, total, coupon, labels.Count == 0 ? "Tax" : string.Join(", ", labels),
            trialDays, recurring, notes);
    }

    private async Task<Coupon?> ResolveCoupon(string? code, List<LineItem> lines, Dictionary<string, Price> prices, string currency,
        string? country, DateTime now, string? customerId)
    {
        var subtotal = lines.Sum(l => l.Amount);
        if (!string.IsNullOrWhiteSpace(code))
        {
            var normalized = code.Trim().ToUpperInvariant();
            var c = await db.Coupons.FirstOrDefaultAsync(x => x.Code == normalized)
                    ?? throw new ApiException(400, "coupon_invalid", "This promotion code is not valid.");
            var problem = Ineligible(c, lines, currency, country, now, customerId, subtotal);
            if (problem != null) throw new ApiException(400, "coupon_invalid", problem);
            return c;
        }
        // Promotion rules (§50): best automatically-applicable offer wins.
        var auto = await db.Coupons.Where(x => x.AutoApply && x.Active).ToListAsync();
        return auto.Where(c => Ineligible(c, lines, currency, country, now, customerId, subtotal) == null)
            .OrderByDescending(c => EstimatedDiscount(c, subtotal)).FirstOrDefault();
    }

    private static long EstimatedDiscount(Coupon c, long subtotal) =>
        c.PercentOffBps is { } bps ? subtotal * bps / 10_000 : Math.Min(subtotal, c.AmountOff ?? 0);

    public static string? Ineligible(Coupon c, List<LineItem> lines, string currency, string? country, DateTime now, string? customerId, long subtotal)
    {
        if (!c.Active) return "This promotion code is no longer active.";
        if (c.StartsAt != null && c.StartsAt > now) return "This promotion has not started yet.";
        if (c.ExpiresAt != null && c.ExpiresAt <= now) return "This promotion code has expired.";
        if (c.MaxRedemptions != null && c.TimesRedeemed >= c.MaxRedemptions) return "This promotion code has been fully redeemed.";
        if (c.AmountOff != null && c.Currency != currency) return "This promotion code does not apply to this currency.";
        if (c.MinimumAmount != null && subtotal < c.MinimumAmount) return $"This code needs a minimum order of {Money.Format(c.MinimumAmount.Value, currency)}.";
        if (!string.IsNullOrEmpty(c.CountriesCsv) && (country == null || !c.CountriesCsv.Split(',').Contains(country))) return "This promotion is not available in your country.";
        if (c.CustomerId != null && c.CustomerId != customerId) return "This promotion code is not valid for this customer.";
        if (!string.IsNullOrEmpty(c.ProductIdsCsv) && !lines.Any(l => c.ProductIdsCsv.Split(',').Contains(l.ProductId))) return "This promotion code does not apply to these products.";
        return null;
    }

    public static void ApplyDiscount(Coupon c, List<LineItem> lines, string currency)
    {
        var eligible = lines.Where(l => l.Amount > 0 && (string.IsNullOrEmpty(c.ProductIdsCsv) || c.ProductIdsCsv.Split(',').Contains(l.ProductId))).ToList();
        if (eligible.Count == 0) return;
        if (c.PercentOffBps is { } bps)
        {
            foreach (var l in eligible) l.Discount = Math.Min(l.Amount, Money.ApplyBps(l.Amount, bps, currency));
            return;
        }
        // Fixed amount: allocate pro rata; the last line absorbs the rounding remainder.
        var pool = Math.Min(c.AmountOff ?? 0, eligible.Sum(l => l.Amount));
        var basis = eligible.Sum(l => l.Amount);
        long allocated = 0;
        for (var i = 0; i < eligible.Count; i++)
        {
            var share = i == eligible.Count - 1 ? pool - allocated : Money.Ratio(pool, eligible[i].Amount, basis, currency);
            eligible[i].Discount = Math.Min(eligible[i].Amount, share);
            allocated += eligible[i].Discount;
        }
    }
}

public record ConfirmRequest(string? Email, string? Name, string? Country, string? PostalCode, string? TaxId, string? CustomerType,
    string? Token, bool AcceptTerms, string? CouponCode);

public class CheckoutService(AppDb db, Uow uow, CheckoutCalculator calc, PaymentService payments, BillingService billing, IConfiguration config)
{
    public async Task<CheckoutSession> Create(string mode, IReadOnlyList<LineRequest> lines, string? customerId, string? email, string? country,
        string? couponCode, string? successUrl, string? cancelUrl, string? paymentLinkId, string? metadataJson, string? clientReferenceId, string? affiliateCode = null)
    {
        if (mode is not ("payment" or "subscription")) throw ApiException.Invalid("mode must be payment or subscription.");
        ValidateUrl(successUrl, "success_url");
        ValidateUrl(cancelUrl, "cancel_url");
        Customer? customer = null;
        if (customerId != null) customer = await db.Customers.FirstOrDefaultAsync(c => c.Id == customerId) ?? throw ApiException.NotFound("customer");
        country = (country ?? customer?.Country)?.ToUpperInvariant();
        var quote = await calc.Compute(mode, lines, country, customer?.CustomerType ?? "b2c", customer?.TaxId, couponCode, uow.Now, customerId);
        return await uow.Run(async () =>
        {
            var s = new CheckoutSession
            {
                Id = Ids.New("cs", 24), CreatedAt = uow.Now, Mode = mode, Status = "open", CustomerId = customerId,
                CustomerEmail = email ?? customer?.Email, Country = country, SuccessUrl = successUrl, CancelUrl = cancelUrl,
                PaymentLinkId = paymentLinkId, ExpiresAt = uow.Now.AddHours(24), MetadataJson = metadataJson, ClientReferenceId = clientReferenceId,
                AffiliateCode = affiliateCode?.Trim().ToUpperInvariant(),
            };
            Apply(s, quote);
            db.CheckoutSessions.Add(s);
            uow.Emit("checkout.session.created", s);
            await Task.CompletedTask;
            return s;
        });
    }

    private static void ValidateUrl(string? url, string field)
    {
        if (url == null) return;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || (u.Scheme != "https" && u.Scheme != "http"))
            throw ApiException.Invalid($"{field} must be an absolute http(s) URL.");
    }

    private static void Apply(CheckoutSession s, Quote q)
    {
        s.LineItemsJson = Json.Serialize(q.Lines);
        s.Currency = q.Currency;
        s.Subtotal = q.Subtotal;
        s.Discount = q.Discount;
        s.Tax = q.Tax;
        s.Total = q.Total;
        s.TaxLabel = q.TaxLabel;
        s.CouponId = q.Coupon?.Id;
        s.TrialDays = q.TrialDays;
        s.RecurringSummary = q.RecurringSummary;
    }

    public async Task<(CheckoutSession Session, IDisposable TenantScope)> LoadPublic(string id)
    {
        var s = await db.CheckoutSessions.IgnoreQueryFilters().FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("checkout session");
        var scope = db.Tenant.Use(s.OrgId, s.Livemode);
        if (s.Status == "open" && s.ExpiresAt <= uow.Now)
        {
            s.Status = "expired";
            await db.SaveChangesAsync();
        }
        return (s, scope);
    }

    /// <summary>Re-prices an open session for the buyer's country / tax id / code; used by the hosted page.</summary>
    public async Task<CheckoutSession> Requote(CheckoutSession s, string? country, string? customerType, string? taxId, string? couponCode)
    {
        if (s.Status != "open") throw ApiException.Conflict("session_not_open", "This checkout is no longer open.");
        country = country?.ToUpperInvariant();
        if (country != null) await EnsureCountryEnabled(country);
        var lines = s.LineItems.Select(l => new LineRequest(l.PriceId, l.Quantity)).ToList();
        var coupon = couponCode ?? (s.CouponId == null ? null : (await db.Coupons.FirstOrDefaultAsync(c => c.Id == s.CouponId))?.Code);
        Quote quote;
        try { quote = await calc.Compute(s.Mode, lines, country, customerType ?? "b2c", taxId, coupon, uow.Now, s.CustomerId); }
        catch (ApiException e) when (e.Code == "coupon_invalid" && couponCode == null)
        {
            quote = await calc.Compute(s.Mode, lines, country, customerType ?? "b2c", taxId, null, uow.Now, s.CustomerId);
        }
        return await uow.Run(async () =>
        {
            Apply(s, quote);
            s.Country = country;
            s.CustomerType = customerType;
            s.TaxId = taxId;
            await Task.CompletedTask;
            return s;
        });
    }

    private async Task EnsureCountryEnabled(string country)
    {
        var cap = await db.Countries.FirstOrDefaultAsync(c => c.Country == country);
        if (cap is { CheckoutEnabled: false }) throw new ApiException(400, "country_unsupported", "Checkout is not available in your country yet.");
    }

    public async Task<object> Confirm(CheckoutSession s, ConfirmRequest r, RequestContext ctx)
    {
        if (s.Status == "complete") return Result(s, await db.Payments.FirstOrDefaultAsync(p => p.Id == s.PaymentId));
        if (s.Status != "open") throw ApiException.Conflict("session_not_open", "This checkout has expired. Start again from the merchant's site.");
        if (!r.AcceptTerms) throw ApiException.Invalid("You must accept the terms to continue.");
        var email = (r.Email ?? s.CustomerEmail)?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(email) || !email.Contains('@') || email.Length > 254) throw ApiException.Invalid("A valid email address is required.");
        var country = (r.Country ?? s.Country)?.ToUpperInvariant() ?? throw ApiException.Invalid("Billing country is required.");
        await EnsureCountryEnabled(country);
        var customerType = r.CustomerType ?? (string.IsNullOrEmpty(r.TaxId) ? "b2c" : "b2b");

        // Authoritative recomputation; totals shown on the page are never trusted.
        await Requote(s, country, customerType, r.TaxId, r.CouponCode);
        var terms = await db.LegalDocuments.Where(d => d.Key == "terms").OrderByDescending(d => d.Version).FirstOrDefaultAsync();

        var prep = await uow.Run(async () =>
        {
            // One payment in flight per session: concurrent confirms (double-clicks, retried requests with
            // new keys) are refused rather than charging twice (§151).
            if (s.ProcessingUntil > uow.Now) throw ApiException.Conflict("checkout_in_progress", "A payment for this checkout is already being processed.");
            s.ProcessingUntil = uow.Now.AddMinutes(2);
            // A new attempt supersedes an abandoned 3-D Secure challenge, which can then no longer complete.
            foreach (var stale in await db.Payments.Where(p => p.CheckoutSessionId == s.Id && p.Status == "REQUIRES_ACTION").ToListAsync())
            {
                uow.Transition("payment", stale.Id, stale.Status, "CANCELLED", stale.OrgId, "superseded by a new checkout attempt");
                stale.Status = "CANCELLED";
                stale.NextActionJson = null;
                stale.UpdatedAt = uow.Now;
                uow.Emit("payment.cancelled", stale);
            }
            var customer = s.CustomerId != null
                ? await db.Customers.FirstAsync(c => c.Id == s.CustomerId)
                : await db.Customers.FirstOrDefaultAsync(c => c.Email == email && c.AnonymizedAt == null);
            if (customer == null)
            {
                customer = new Customer
                {
                    Id = Ids.New("cus"), CreatedAt = uow.Now, UpdatedAt = uow.Now, Email = email, Name = r.Name, Country = country,
                    PostalCode = r.PostalCode, TaxId = r.TaxId, CustomerType = customerType,
                };
                db.Customers.Add(customer);
                uow.Emit("customer.created", customer);
            }
            else
            {
                customer.Name ??= r.Name;
                customer.Country ??= country;
                customer.UpdatedAt = uow.Now;
            }
            s.CustomerId = customer.Id;
            s.CustomerEmail = email;
            s.CustomerName = r.Name;

            if (s.CouponId != null && !s.CouponReserved)
            {
                // Atomic redemption (§243): the conditional update cannot exceed max_redemptions.
                var reserved = await db.Coupons.Where(c => c.Id == s.CouponId && (c.MaxRedemptions == null || c.TimesRedeemed < c.MaxRedemptions))
                    .ExecuteUpdateAsync(u => u.SetProperty(c => c.TimesRedeemed, c => c.TimesRedeemed + 1));
                if (reserved == 0) throw new ApiException(400, "coupon_invalid", "This promotion code has been fully redeemed.");
                s.CouponReserved = true;
            }

            var order = s.OrderId == null ? null : await db.Orders.FirstAsync(o => o.Id == s.OrderId);
            if (order == null)
            {
                order = new Order { Id = Ids.New("ord"), CreatedAt = uow.Now, CheckoutSessionId = s.Id };
                db.Orders.Add(order);
                s.OrderId = order.Id;
            }
            order.CustomerId = customer.Id;
            order.Currency = s.Currency;
            order.Subtotal = s.Subtotal;
            order.Discount = s.Discount;
            order.Tax = s.Tax;
            order.Total = s.Total;
            order.ItemsJson = s.LineItemsJson;
            order.Country = country;
            order.CouponId = s.CouponId;
            order.AcceptedTermsVersion = terms == null ? null : $"terms@v{terms.Version}";
            order.SellerOfRecord = config["Platform:LegalEntityName"];
            order.UpdatedAt = uow.Now;

            PaymentMethod? pm = null;
            if (s.Mode == "subscription")
            {
                if (string.IsNullOrEmpty(r.Token)) throw ApiException.Invalid("A payment method is required.");
                pm = await SavePaymentMethod(customer, r.Token);
                customer.DefaultPaymentMethodId = pm.Id;
                if (s.SubscriptionId == null)
                {
                    var sub = await billing.CreateFromCheckout(s, customer, pm, country);
                    s.SubscriptionId = sub.Id;
                }
            }
            return (customer, order, pm);
        });

        var (cust, ord, paymentMethod) = prep;
        try
        {
            if (s.Total == 0)
            {
                // Nothing due today (trial or full discount): verify the instrument and fulfil without charging.
                if (paymentMethod == null && !string.IsNullOrEmpty(r.Token)) await payments.ResolveToken(null, r.Token);
                await uow.Run(async () => { await billing.FulfilZeroTotalCheckout(s, cust, ord); });
                return Result(s, null);
            }
            if (string.IsNullOrEmpty(r.Token) && paymentMethod == null) throw ApiException.Invalid("A payment method is required.");
            var invoiceId = s.SubscriptionId == null ? null : (await db.Subscriptions.FirstAsync(x => x.Id == s.SubscriptionId)).LatestInvoiceId;
            var payment = await payments.Pay(new PayRequest(s.OrgId, s.Livemode, s.Total, s.Currency, s.Tax, country, cust.Id, email, country,
                paymentMethod?.Id, paymentMethod == null ? r.Token : null, ord.Id, invoiceId, s.Id,
                $"Checkout {s.Id}", false, ctx.Ip, ctx.DeviceId));
            await uow.Run(async () =>
            {
                ord.PaymentId = payment.Id;
                s.PaymentId = payment.Id;
                await Task.CompletedTask;
            });
            return Result(s, payment);
        }
        finally
        {
            await uow.Run(async () =>
            {
                var fresh = await db.CheckoutSessions.FirstAsync(x => x.Id == s.Id);
                fresh.ProcessingUntil = null;
            });
        }
    }

    public async Task<PaymentMethod> SavePaymentMethod(Customer customer, string token)
    {
        var info = await payments.ResolveToken(null, token);
        if (info.Behavior is "card_declined" or "expired_card")
            throw new ApiException(402, info.Behavior, DeclineCatalog.For(info.Behavior).Message);
        var existing = await db.PaymentMethods.FirstOrDefaultAsync(p => p.CustomerId == customer.Id && p.ProviderToken == token);
        if (existing != null) return existing;
        var pm = new PaymentMethod
        {
            Id = Ids.New("pm"), CreatedAt = uow.Now, CustomerId = customer.Id, Type = info.Method, ProviderId = "vault",
            ProviderToken = info.Token, Brand = info.Brand, Last4 = info.Last4, Country = info.CardCountry,
        };
        db.PaymentMethods.Add(pm);
        await db.SaveChangesAsync();
        return pm;
    }

    public object Result(CheckoutSession s, Payment? p) => new
    {
        @object = "checkout_confirmation",
        checkout_session = s.Id,
        status = s.Status,
        payment_status = p?.Status ?? (s.Status == "complete" ? "no_payment_required" : null),
        payment = p?.Id,
        next_action = p?.NextAction,
        failure_code = p?.FailureCode,
        failure_message = p?.FailureMessage,
        suggested_action = p?.SuggestedAction,
        success_url = s.Status == "complete" ? s.SuccessUrl : null,
        order = s.OrderId,
        subscription = s.SubscriptionId,
    };
}
