using System.Text.RegularExpressions;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;

namespace PaymentApp.Api.Modules.Engines;

/// <summary>
/// Pricing engine (§13). Pure and deterministic: the same price, quantity and country always produce
/// the same amount, so any invoice can be recomputed from its stored inputs (§26).
/// </summary>
public static class PricingEngine
{
    public static long UnitAmountFor(Price price, string? country)
    {
        if (country != null && !string.IsNullOrEmpty(price.CountryAmountsJson))
        {
            var map = Json.Deserialize<Dictionary<string, long>>(price.CountryAmountsJson);
            if (map != null && map.TryGetValue(country.ToUpperInvariant(), out var overridden)) return overridden;
        }
        return price.UnitAmount;
    }

    public static long Amount(Price price, long quantity, string? country = null)
    {
        if (quantity < 0) throw ApiException.Invalid("quantity must be non-negative.");
        long amount = price.Scheme switch
        {
            "tiered" => Tiered(price.Tiers ?? [], price.TiersMode ?? "graduated", quantity),
            "package" => CeilDiv(quantity, Math.Max(1, price.PackageSize)) * UnitAmountFor(price, country),
            _ => checked(UnitAmountFor(price, country) * quantity),
        };
        if (price.MinimumAmount is { } min && amount < min) amount = min;
        if (price.MaximumAmount is { } max && amount > max) amount = max;
        return amount;
    }

    public static long Tiered(IReadOnlyList<PriceTier> tiers, string mode, long quantity)
    {
        if (tiers.Count == 0) throw ApiException.Invalid("Tiered price has no tiers.");
        if (mode == "volume")
        {
            // All units are charged at the tier the total quantity lands in.
            var tier = tiers.FirstOrDefault(t => t.UpTo == null || quantity <= t.UpTo) ?? tiers[^1];
            return checked(tier.UnitAmount * quantity + tier.FlatAmount);
        }
        // Graduated: each tier's units are charged at that tier's rate.
        long total = 0, lower = 0;
        foreach (var t in tiers)
        {
            if (quantity <= lower) break;
            var upper = t.UpTo ?? long.MaxValue;
            var units = Math.Min(quantity, upper) - lower;
            if (units > 0) total = checked(total + units * t.UnitAmount + t.FlatAmount);
            lower = upper;
        }
        return total;
    }

    private static long CeilDiv(long a, long b) => (a + b - 1) / b;

    public static void Validate(Price p)
    {
        if (p.Scheme == "tiered")
        {
            var tiers = p.Tiers ?? throw ApiException.Invalid("tiers are required for a tiered price.");
            if (tiers.Count == 0 || tiers[^1].UpTo != null) throw ApiException.Invalid("The last tier must have up_to = null (infinity).");
            for (var i = 1; i < tiers.Count - 1; i++)
                if (tiers[i].UpTo <= tiers[i - 1].UpTo) throw ApiException.Invalid("Tier bounds must be increasing.");
            if (p.TiersMode is not ("volume" or "graduated")) throw ApiException.Invalid("tiers_mode must be volume or graduated.");
        }
        if (p.UnitAmount < 0) throw ApiException.Invalid("unit_amount must be non-negative.");
        if (p.Type == "recurring" && p.Interval is not ("day" or "week" or "month" or "year"))
            throw ApiException.Invalid("Recurring prices need interval day, week, month or year.");
        if (p.Type == "recurring" && p.IntervalCount is < 1 or > 36) throw ApiException.Invalid("interval_count must be 1-36.");
        if (p.UsageType == "metered" && p.Type != "recurring") throw ApiException.Invalid("Metered prices must be recurring.");
        if (p.MinimumAmount != null && p.MaximumAmount != null && p.MinimumAmount > p.MaximumAmount)
            throw ApiException.Invalid("minimum_amount cannot exceed maximum_amount.");
    }

    public static DateTime AddInterval(DateTime from, string interval, int count) => interval switch
    {
        "day" => from.AddDays(count),
        "week" => from.AddDays(7 * count),
        "month" => from.AddMonths(count),
        "year" => from.AddYears(count),
        _ => throw ApiException.Invalid($"Unknown interval {interval}."),
    };
}

public record TaxContext(string Country, string CustomerType, string? TaxId, bool Exempt = false);

public record TaxLineResult(long Taxable, long Tax, int RateBps, string TaxType, string Label, TaxRule? Rule, bool ReverseCharge, bool Exempt, bool Inclusive);

/// <summary>
/// Configuration-driven, versioned tax engine (§32, §265, §266). Rates live in tax_rules; the engine
/// never assumes one global rule. Every decision records the rule id and version it used so an invoice's
/// tax is traceable back to the exact configuration in force (§33).
/// </summary>
public static class TaxEngine
{
    public static TaxLineResult ComputeLine(long amount, string taxCategory, bool inclusive, TaxContext ctx, IEnumerable<TaxRule> rules, DateTime at, string currency)
    {
        if (ctx.Exempt) return new(amount, 0, 0, "EXEMPT", "Tax exempt", null, false, true, inclusive);
        var rule = Select(rules, ctx.Country, taxCategory, ctx.CustomerType, at);
        if (rule == null || rule.RateBps == 0)
            return new(amount, 0, 0, rule?.TaxType ?? "NONE", rule?.Label ?? "No tax", rule, false, false, inclusive);
        if (ctx.CustomerType == "b2b" && rule.ReverseChargeB2B && IsPlausibleTaxId(ctx.Country, ctx.TaxId))
            return new(amount, 0, 0, rule.TaxType, $"{rule.Label} — reverse charge", rule, true, false, inclusive);

        var rounding = Money.Info(currency).Rounding;
        if (inclusive)
        {
            // amount already contains tax: tax = amount − amount / (1 + rate)
            var net = Money.Divide((Int128)amount * 10_000, 10_000 + rule.RateBps, rounding);
            return new(net, amount - net, rule.RateBps, rule.TaxType, rule.Label, rule, false, false, true);
        }
        var tax = Money.ApplyBps(amount, rule.RateBps, currency);
        return new(amount, tax, rule.RateBps, rule.TaxType, rule.Label, rule, false, false, false);
    }

    public static TaxRule? Select(IEnumerable<TaxRule> rules, string country, string category, string customerType, DateTime at) =>
        rules.Where(r => r.Country == country && r.EffectiveFrom <= at && (r.EffectiveTo == null || r.EffectiveTo > at)
                         && (r.TaxCategory == category || r.TaxCategory == "*")
                         && (r.CustomerType == customerType || r.CustomerType == "*"))
            .OrderByDescending(r => r.TaxCategory == category)
            .ThenByDescending(r => r.CustomerType == customerType)
            .ThenByDescending(r => r.Version)
            .FirstOrDefault();

    private static readonly Dictionary<string, Regex> TaxIdFormats = new()
    {
        ["IN"] = new(@"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$"),
        ["GB"] = new(@"^GB(\d{9}|\d{12})$"),
        ["AU"] = new(@"^\d{11}$"),
    };
    private static readonly Regex EuVat = new(@"^[A-Z]{2}[0-9A-Z]{8,12}$");

    /// <summary>
    /// Format check only. A production deployment must verify against the registry (VIES, GSTN, HMRC)
    /// through a tax-provider adapter before treating an ID as valid for reverse charge.
    /// </summary>
    public static bool IsPlausibleTaxId(string country, string? taxId)
    {
        if (string.IsNullOrWhiteSpace(taxId)) return false;
        var id = taxId.Replace(" ", "").ToUpperInvariant();
        return TaxIdFormats.TryGetValue(country, out var re) ? re.IsMatch(id) : EuVat.IsMatch(id);
    }
}

public record FeeResult(long Total, long Percentage, long Fixed, long International, int PercentBps, string ScheduleId, int ScheduleVersion);

/// <summary>Configurable platform fee engine (§121): percentage + fixed, min/max, per country/method/merchant.</summary>
public static class FeeEngine
{
    public static FeeResult Compute(long amount, string currency, string method, string? customerCountry, string merchantCountry,
        string orgId, IEnumerable<FeeSchedule> schedules, Func<long, string, string, long> convertFixed)
    {
        var schedule = schedules.Where(s => s.Active
                                            && (s.OrgId == null || s.OrgId == orgId)
                                            && (s.Method == null || s.Method == method)
                                            && (s.Country == null || s.Country == customerCountry))
                           .OrderByDescending(s => s.OrgId != null).ThenByDescending(s => s.Method != null)
                           .ThenByDescending(s => s.Country != null).ThenBy(s => s.Priority).FirstOrDefault()
                       ?? throw new InvalidOperationException("No fee schedule configured.");
        var pct = Money.ApplyBps(amount, schedule.PercentBps, currency);
        var fixedAmt = schedule.FixedMinor == 0 ? 0 : convertFixed(schedule.FixedMinor, schedule.FixedCurrency, currency);
        var intl = customerCountry != null && customerCountry != merchantCountry ? Money.ApplyBps(amount, schedule.InternationalBps, currency) : 0;
        var total = pct + fixedAmt + intl;
        if (schedule.MinimumMinor is { } min && total < min) total = min;
        if (schedule.MaximumMinor is { } max && total > max) total = max;
        total = Math.Min(total, amount); // a fee can never exceed the charge itself
        return new FeeResult(total, pct, fixedAmt, intl, schedule.PercentBps, schedule.Id, schedule.Version);
    }
}

public record RiskSignal(string Code, int Weight, string Explanation);
public record RiskDecision(int Score, string Action, List<RiskSignal> Signals);

public record RiskInput(long AmountUsd, string? Email, string? CustomerCountry, string? CardCountry, string? Ip,
    int RecentAttemptsFromIdentity, int RecentFailuresFromIdentity, int PriorDisputes, string MerchantRiskLevel, bool NewCustomer);

/// <summary>
/// Explainable transaction risk scoring (§22, §192). Every point of score is attributable to a named
/// signal, so an analyst can see exactly why a payment was challenged or declined.
/// </summary>
public static class RiskEngine
{
    private static readonly HashSet<string> DisposableDomains = ["mailinator.com", "tempmail.com", "10minutemail.com", "guerrillamail.com", "trashmail.com"];

    public static RiskDecision Evaluate(RiskInput i, int reviewAt = 60, int declineAt = 85, int challengeAt = 40)
    {
        var s = new List<RiskSignal>();
        if (i.AmountUsd >= 500_000) s.Add(new("very_large_amount", 30, "Amount is at least $5,000."));
        else if (i.AmountUsd >= 100_000) s.Add(new("large_amount", 15, "Amount is at least $1,000."));
        if (i.RecentAttemptsFromIdentity >= 5) s.Add(new("velocity", 30, $"{i.RecentAttemptsFromIdentity} payment attempts from this email/IP in 10 minutes."));
        if (i.RecentFailuresFromIdentity >= 3) s.Add(new("repeated_failures", 25, $"{i.RecentFailuresFromIdentity} failed attempts from this email/IP in the last hour."));
        if (i.CardCountry != null && i.CustomerCountry != null && i.CardCountry != i.CustomerCountry)
            s.Add(new("country_mismatch", 15, $"Card issued in {i.CardCountry} but customer country is {i.CustomerCountry}."));
        var domain = i.Email?.Split('@').LastOrDefault()?.ToLowerInvariant();
        if (domain != null && DisposableDomains.Contains(domain)) s.Add(new("disposable_email", 20, "Email uses a disposable-address domain."));
        if (i.PriorDisputes > 0) s.Add(new("prior_disputes", Math.Min(50, 25 * i.PriorDisputes), $"{i.PriorDisputes} earlier dispute(s) linked to this customer."));
        if (i.MerchantRiskLevel == "high") s.Add(new("merchant_risk", 10, "Merchant is on enhanced monitoring."));
        if (i.NewCustomer && i.AmountUsd >= 100_000) s.Add(new("new_customer_large", 10, "First purchase by this customer is large."));
        var score = Math.Min(100, s.Sum(x => x.Weight));
        var action = score >= declineAt ? "DECLINE" : score >= reviewAt ? "REVIEW" : score >= challengeAt ? "CHALLENGE" : "ALLOW";
        return new RiskDecision(score, action, s);
    }
}

/// <summary>Maps provider decline codes to stable internal codes, customer text and a suggested action (§73).</summary>
public static class DeclineCatalog
{
    public record Decline(string Code, string Message, string SuggestedAction, bool Soft);

    public static Decline For(string providerCode) => providerCode switch
    {
        "insufficient_funds" => new("insufficient_funds", "Your card has insufficient funds.", "Use another payment method or try again later.", true),
        "expired_card" => new("expired_card", "Your card has expired.", "Use a different card.", false),
        "card_declined" => new("card_declined", "Your card was declined.", "Contact your bank or use another payment method.", false),
        "authentication_failed" => new("authentication_failed", "We couldn't verify this payment with your bank.", "Try again and complete the verification step.", false),
        "processing_error" => new("processing_error", "The payment couldn't be processed.", "Try again in a few minutes.", true),
        "provider_unavailable" => new("provider_unavailable", "The payment service is temporarily unavailable.", "Try again in a few minutes.", true),
        "risk_declined" => new("risk_declined", "This payment could not be completed.", "Use another payment method or contact the seller.", false),
        "upi_declined" => new("upi_declined", "The UPI payment was declined.", "Approve the request in your UPI app or use another method.", false),
        _ => new("payment_failed", "The payment could not be completed.", "Use another payment method.", false),
    };
}
