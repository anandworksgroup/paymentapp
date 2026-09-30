namespace PaymentApp.Api.Common;

public enum RoundingMode { HalfUp, HalfEven, Down, Up }

public record CurrencyInfo(string Code, int Exponent, RoundingMode Rounding, long MinimumUnit = 1, string? Symbol = null);

/// <summary>
/// Money is always integer minor units + ISO currency + exponent (§14, §135). No binary floating point
/// anywhere on a money path; ratios are applied with 128-bit integer arithmetic and an explicit,
/// per-currency rounding mode (§137).
/// </summary>
public static class Money
{
    private static readonly Dictionary<string, CurrencyInfo> Currencies = new(StringComparer.OrdinalIgnoreCase)
    {
        ["USD"] = new("USD", 2, RoundingMode.HalfUp, 1, "$"),
        ["EUR"] = new("EUR", 2, RoundingMode.HalfUp, 1, "€"),
        ["GBP"] = new("GBP", 2, RoundingMode.HalfUp, 1, "£"),
        ["INR"] = new("INR", 2, RoundingMode.HalfUp, 1, "₹"),
        ["AUD"] = new("AUD", 2, RoundingMode.HalfUp, 1, "A$"),
        ["CAD"] = new("CAD", 2, RoundingMode.HalfUp, 1, "C$"),
        ["SGD"] = new("SGD", 2, RoundingMode.HalfUp, 1, "S$"),
        ["AED"] = new("AED", 2, RoundingMode.HalfUp, 1, "AED "),
        ["BRL"] = new("BRL", 2, RoundingMode.HalfUp, 1, "R$"),
        ["JPY"] = new("JPY", 0, RoundingMode.HalfUp, 1, "¥"),
        ["BHD"] = new("BHD", 3, RoundingMode.HalfUp, 1, "BD "),
    };

    public static IEnumerable<CurrencyInfo> All => Currencies.Values;

    public static bool IsSupported(string? code) => code != null && Currencies.ContainsKey(code);

    public static CurrencyInfo Info(string code) =>
        Currencies.TryGetValue(code, out var info) ? info : throw ApiException.Invalid($"Unsupported currency '{code}'.");

    public static string Normalize(string? code)
    {
        if (string.IsNullOrWhiteSpace(code)) throw ApiException.Invalid("currency is required.");
        return Info(code.Trim()).Code;
    }

    /// <summary>Divides with the given rounding mode. All intermediate math is Int128.</summary>
    public static long Divide(Int128 numerator, Int128 denominator, RoundingMode mode)
    {
        if (denominator == 0) throw new DivideByZeroException();
        if (denominator < 0) { numerator = -numerator; denominator = -denominator; }
        var negative = numerator < 0;
        var n = negative ? -numerator : numerator;
        var q = n / denominator;
        var r = n % denominator;
        if (r != 0)
        {
            var twice = r * 2;
            bool roundUp = mode switch
            {
                RoundingMode.Down => false,
                RoundingMode.Up => true,
                RoundingMode.HalfUp => twice >= denominator,
                RoundingMode.HalfEven => twice > denominator || (twice == denominator && q % 2 == 1),
                _ => false,
            };
            if (roundUp) q += 1;
        }
        return (long)(negative ? -q : q);
    }

    /// <summary>amount × bps / 10000, rounded per currency.</summary>
    public static long ApplyBps(long amount, long bps, string currency) =>
        Divide((Int128)amount * bps, 10_000, Info(currency).Rounding);

    /// <summary>amount × numerator / denominator, rounded per currency (proration, pro-rata tax on refunds).</summary>
    public static long Ratio(long amount, long numerator, long denominator, string currency) =>
        Divide((Int128)amount * numerator, denominator, Info(currency).Rounding);

    /// <summary>
    /// Converts minor units between currencies using a rate expressed in units of 1e-9 of the quote currency
    /// per one major unit of the base currency, adjusting for differing exponents.
    /// </summary>
    public static long Convert(long amount, string from, string to, long rateE9, RoundingMode? mode = null)
    {
        var fromExp = Info(from).Exponent;
        var toExp = Info(to).Exponent;
        Int128 num = (Int128)amount * rateE9;
        Int128 den = 1_000_000_000;
        var diff = toExp - fromExp;
        if (diff > 0) num *= Pow10(diff); else if (diff < 0) den *= Pow10(-diff);
        return Divide(num, den, mode ?? Info(to).Rounding);
    }

    private static Int128 Pow10(int e) { Int128 r = 1; for (var i = 0; i < e; i++) r *= 10; return r; }

    public static string Format(long amount, string currency)
    {
        var info = Info(currency);
        var sign = amount < 0 ? "-" : "";
        var abs = Math.Abs(amount);
        if (info.Exponent == 0) return $"{sign}{info.Symbol}{abs:N0}";
        var div = (long)Math.Pow(10, info.Exponent);
        return $"{sign}{info.Symbol}{abs / div:N0}.{(abs % div).ToString().PadLeft(info.Exponent, '0')}";
    }
}
