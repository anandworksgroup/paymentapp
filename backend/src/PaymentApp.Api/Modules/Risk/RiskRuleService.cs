using System.Globalization;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Modules.Engines;
using PaymentApp.Api.Modules.Payments;
using PaymentApp.Api.Infrastructure;

namespace PaymentApp.Api.Modules.Risk;

/// <summary>What a merchant rule can look at for one payment attempt.</summary>
public record RuleFacts(long AmountUsd, string Currency, string? CustomerCountry, string? CardCountry, string? Email, string? Ip,
    int RiskScore, string? PaymentMethod, string? CardBrand, bool NewCustomer);

/// <summary>
/// Merchant-defined risk rules (§22). They run after the platform's own scoring and can only tighten it
/// (block, review, challenge) or waive the merchant-level steps (allow skips review and 3-D Secure) — a
/// platform decline can never be overridden. The first enabled rule that matches, by priority, decides.
/// </summary>
public class RiskRuleService(AppDb db, Uow uow)
{
    public static readonly string[] Fields = ["amount_usd", "currency", "customer_country", "card_country", "email", "email_domain", "ip", "risk_score", "payment_method", "card_brand", "new_customer"];
    private static readonly HashSet<string> Numeric = ["amount_usd", "risk_score"];
    public static readonly string[] Operators = ["eq", "neq", "in", "not_in", "gt", "gte", "lt", "lte", "contains"];
    public static readonly string[] Actions = ["block", "review", "challenge", "allow"];

    public static void Validate(string field, string op, string value, string action)
    {
        if (!Fields.Contains(field)) throw ApiException.Invalid($"field must be one of {string.Join(", ", Fields)}.");
        if (!Operators.Contains(op)) throw ApiException.Invalid($"operator must be one of {string.Join(", ", Operators)}.");
        if (!Actions.Contains(action)) throw ApiException.Invalid($"action must be one of {string.Join(", ", Actions)}.");
        if (string.IsNullOrWhiteSpace(value) || value.Length > 2000) throw ApiException.Invalid("value is required (max 2000 characters).");
        var numericOp = op is "gt" or "gte" or "lt" or "lte";
        if (Numeric.Contains(field))
        {
            if (op is "contains") throw ApiException.Invalid($"{field} is a number: use eq, neq, gt, gte, lt, lte, in or not_in.");
            foreach (var v in Split(op, value))
                if (!long.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out _)) throw ApiException.Invalid($"'{v}' is not a whole number ({(field == "amount_usd" ? "amount_usd is in cents" : "0-100")}).");
        }
        else if (numericOp) throw ApiException.Invalid($"{field} is text: use eq, neq, in, not_in or contains.");
        if (field == "new_customer" && Split(op, value).Any(v => v is not ("true" or "false"))) throw ApiException.Invalid("new_customer is true or false.");
    }

    private static IEnumerable<string> Split(string op, string value) =>
        op is "in" or "not_in" ? value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries) : [value.Trim()];

    private static string? Text(RuleFacts f, string field) => field switch
    {
        "currency" => f.Currency, "customer_country" => f.CustomerCountry, "card_country" => f.CardCountry,
        "email" => f.Email?.ToLowerInvariant(), "email_domain" => f.Email?.Split('@').LastOrDefault()?.ToLowerInvariant(), "ip" => f.Ip,
        "payment_method" => f.PaymentMethod, "card_brand" => f.CardBrand, "new_customer" => f.NewCustomer ? "true" : "false",
        _ => null,
    };

    public static bool Matches(RiskRule r, RuleFacts f)
    {
        if (Numeric.Contains(r.Field))
        {
            long actual = r.Field == "amount_usd" ? f.AmountUsd : f.RiskScore;
            var values = Split(r.Operator, r.Value).Select(v => long.Parse(v, CultureInfo.InvariantCulture)).ToList();
            return r.Operator switch
            {
                "eq" => actual == values[0], "neq" => actual != values[0], "gt" => actual > values[0], "gte" => actual >= values[0],
                "lt" => actual < values[0], "lte" => actual <= values[0], "in" => values.Contains(actual), "not_in" => !values.Contains(actual),
                _ => false,
            };
        }
        var text = Text(f, r.Field);
        var options = Split(r.Operator, r.Value).Select(v => v.ToLowerInvariant()).ToList();
        var t = text?.ToLowerInvariant();
        return r.Operator switch
        {
            "eq" => t == options[0], "neq" => t != options[0], "in" => t != null && options.Contains(t), "not_in" => t == null || !options.Contains(t),
            "contains" => t != null && t.Contains(options[0]),
            _ => false,
        };
    }

    public static string Describe(RiskRule r) => $"{r.Field} {r.Operator} {r.Value}";

    /// <summary>
    /// Applies the first matching rule to the platform decision. Runs inside the payment's unit of work.
    /// </summary>
    public async Task<(RiskDecision Decision, RiskRule? Rule)> Apply(RiskDecision platform, RuleFacts facts)
    {
        var rules = await db.RiskRules.Where(r => r.Enabled).OrderBy(r => r.Priority).ThenBy(r => r.CreatedAt).ToListAsync();
        var rule = rules.FirstOrDefault(r => Matches(r, facts));
        if (rule == null) return (platform, null);
        rule.Hits++;
        rule.LastHitAt = uow.Now;
        var signals = platform.Signals.ToList();
        var action = platform.Action;
        switch (rule.Action)
        {
            case "block":
                action = "DECLINE";
                signals.Add(new("merchant_rule_block", 0, $"Blocked by your rule “{rule.Name}” ({Describe(rule)})."));
                break;
            case "review" when action != "DECLINE":
                action = "REVIEW";
                signals.Add(new("merchant_rule_review", 0, $"Sent to review by your rule “{rule.Name}” ({Describe(rule)})."));
                break;
            case "challenge" when action == "ALLOW":
                action = "CHALLENGE";
                signals.Add(new("merchant_rule_challenge", 0, $"3-D Secure requested by your rule “{rule.Name}” ({Describe(rule)})."));
                break;
            case "allow" when action is "REVIEW" or "CHALLENGE":
                action = "ALLOW";
                signals.Add(new("merchant_rule_allow", 0, $"Review/authentication waived by your rule “{rule.Name}” ({Describe(rule)}); the platform checks still ran."));
                break;
            default:
                // The rule matched but can't change this outcome (for example "allow" on a platform decline).
                signals.Add(new("merchant_rule_noop", 0, $"Your rule “{rule.Name}” matched but can't change a {platform.Action.ToLowerInvariant()} decision."));
                break;
        }
        return (new RiskDecision(platform.Score, action, signals), rule);
    }

    /// <summary>Backtest over the last 30 days: how many payments a rule would have matched.</summary>
    public async Task<object> Backtest(string field, string op, string value, string action)
    {
        Validate(field, op, value, action);
        var probe = new RiskRule { Field = field, Operator = op, Value = value, Action = action };
        var since = uow.Now.AddDays(-30);
        var payments = await db.Payments.Where(p => p.CreatedAt >= since).OrderByDescending(p => p.CreatedAt).Take(20_000).ToListAsync();
        var firstPurchase = await db.Payments.Where(p => p.Status == "SUCCEEDED" && p.CustomerId != null)
            .GroupBy(p => p.CustomerId!).Select(g => new { g.Key, First = g.Min(x => x.CreatedAt) }).ToDictionaryAsync(x => x.Key, x => x.First);
        var matched = payments.Where(p => Matches(probe, FactsFor(p, p.CustomerId == null || !firstPurchase.TryGetValue(p.CustomerId, out var first) || first >= p.CreatedAt))).ToList();
        var succeeded = matched.Where(p => p.Status == "SUCCEEDED").ToList();
        return new
        {
            @object = "risk_rule_backtest", window_days = 30, evaluated = payments.Count, matched = matched.Count,
            matched_succeeded = succeeded.Count,
            matched_volume = succeeded.GroupBy(p => p.Currency).Select(g => new { currency = g.Key, amount = g.Sum(p => p.Amount) }),
            matched_disputed = matched.Count(p => p.AmountDisputed > 0),
            sample = matched.Take(10).Select(p => new { p.Id, p.Amount, p.Currency, p.Status, p.Country, p.CustomerEmail, p.RiskScore, p.CreatedAt }),
            note = action == "block" ? "Matching payments would have been declined." : action == "review" ? "Matching payments would have been held for review." : null,
        };
    }

    public static RuleFacts FactsFor(Payment p, bool newCustomer) =>
        new(FxTable.ToUsd(p.Amount, p.Currency), p.Currency, p.Country, p.CardCountry, p.CustomerEmail, p.Ip, p.RiskScore, p.PaymentMethodType, p.CardBrand, newCustomer);
}
