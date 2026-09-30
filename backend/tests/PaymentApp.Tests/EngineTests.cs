using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Modules.Compliance;
using PaymentApp.Api.Modules.Engines;
using PaymentApp.Api.Modules.Identity;

namespace PaymentApp.Tests;

/// <summary>Pure-engine tests: money arithmetic, pricing models, tax, fees, risk, screening, TOTP.</summary>
public class EngineTests
{
    [Theory]
    [InlineData(1099, 1800, "USD", 198)]    // 197.82 → 198
    [InlineData(1, 1800, "USD", 0)]         // 0.18 → 0
    [InlineData(3, 5000, "USD", 2)]         // 1.5 → 2 (half-up)
    [InlineData(1234567, 2000, "JPY", 246913)]
    public void Basis_points_round_per_currency(long amount, long bps, string currency, long expected) =>
        Assert.Equal(expected, Money.ApplyBps(amount, bps, currency));

    [Fact]
    public void Half_even_rounding_is_available()
    {
        Assert.Equal(2, Money.Divide(5, 2, RoundingMode.HalfEven));   // 2.5 → 2
        Assert.Equal(4, Money.Divide(7, 2, RoundingMode.HalfEven));   // 3.5 → 4
        Assert.Equal(-3, Money.Divide(-5, 2, RoundingMode.HalfUp));   // symmetric away from zero
    }

    [Fact]
    public void Currency_conversion_respects_exponents()
    {
        // 10.00 USD → JPY at 149.8 = 1498 yen (exponent 0)
        Assert.Equal(1498, Money.Convert(1000, "USD", "JPY", 149_800_000_000));
        // 1000 JPY → USD at 1/149.8 ≈ 6.68 USD
        Assert.Equal(668, Money.Convert(1000, "JPY", "USD", 6_675_567));
        // 1.000 BHD (exponent 3) → USD at 2.6525 = 2.65 USD
        Assert.Equal(265, Money.Convert(1000, "BHD", "USD", 2_652_519_893));
    }

    private static Price Tiered(string mode) => new()
    {
        Currency = "USD", Scheme = "tiered", TiersMode = mode,
        TiersJson = Json.Serialize(new List<PriceTier> { new() { UpTo = 1000, UnitAmount = 10 }, new() { UpTo = 10_000, UnitAmount = 8 }, new() { UpTo = null, UnitAmount = 5 } }),
    };

    [Fact]
    public void Graduated_tiers_charge_each_band_separately()
    {
        // 1000×10 + 9000×8 + 2000×5
        Assert.Equal(10_000 + 72_000 + 10_000, PricingEngine.Amount(Tiered("graduated"), 12_000));
    }

    [Fact]
    public void Volume_tiers_charge_all_units_at_the_reached_tier() =>
        Assert.Equal(12_000 * 5, PricingEngine.Amount(Tiered("volume"), 12_000));

    [Fact]
    public void Hybrid_included_seats_then_overage()
    {
        // $99/month includes 100 seats (flat), then $5 per extra seat (§13 hybrid).
        var p = new Price
        {
            Currency = "USD", Scheme = "tiered", TiersMode = "graduated",
            TiersJson = Json.Serialize(new List<PriceTier> { new() { UpTo = 100, FlatAmount = 9900 }, new() { UpTo = null, UnitAmount = 500 } }),
        };
        Assert.Equal(9900, PricingEngine.Amount(p, 40));
        Assert.Equal(9900 + 5 * 500, PricingEngine.Amount(p, 105));
    }

    [Fact]
    public void Minimum_commitment_and_maximum_cap_apply()
    {
        var p = new Price { Currency = "USD", UnitAmount = 1, MinimumAmount = 50_000, MaximumAmount = 500_000 };
        Assert.Equal(50_000, PricingEngine.Amount(p, 10));
        Assert.Equal(500_000, PricingEngine.Amount(p, 10_000_000));
    }

    [Fact]
    public void Package_pricing_rounds_up_to_whole_packages() =>
        Assert.Equal(3 * 499, PricingEngine.Amount(new Price { Currency = "USD", Scheme = "package", PackageSize = 1000, UnitAmount = 499 }, 2001));

    [Fact]
    public void Country_price_override_is_used_for_that_country()
    {
        var p = new Price { Currency = "USD", UnitAmount = 2000, CountryAmountsJson = "{\"IN\":900}" };
        Assert.Equal(900, PricingEngine.Amount(p, 1, "IN"));
        Assert.Equal(2000, PricingEngine.Amount(p, 1, "US"));
    }

    private static readonly DateTime Epoch = new(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly List<TaxRule> Rules =
    [
        new() { Id = "r1", Country = "DE", TaxType = "VAT", RateBps = 1900, ReverseChargeB2B = true, Label = "VAT 19%", EffectiveFrom = Epoch, Version = 1 },
        new() { Id = "r2", Country = "DE", TaxCategory = "ebook", TaxType = "VAT", RateBps = 700, ReverseChargeB2B = true, Label = "VAT 7%", EffectiveFrom = Epoch, Version = 1 },
        new() { Id = "r3", Country = "IN", TaxType = "GST", RateBps = 1800, Label = "GST 18%", EffectiveFrom = Epoch, Version = 1, EffectiveTo = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc) },
        new() { Id = "r4", Country = "IN", TaxType = "GST", RateBps = 1200, Label = "GST 12%", EffectiveFrom = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc), Version = 2 },
    ];

    [Fact]
    public void Tax_exclusive_inclusive_category_and_reverse_charge()
    {
        var at = new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc);
        var b2c = TaxEngine.ComputeLine(10_000, "digital_service", false, new TaxContext("DE", "b2c", null), Rules, at, "EUR");
        Assert.Equal(1900, b2c.Tax);
        var inclusive = TaxEngine.ComputeLine(11_900, "digital_service", true, new TaxContext("DE", "b2c", null), Rules, at, "EUR");
        Assert.Equal(1900, inclusive.Tax);
        Assert.Equal(10_000, inclusive.Taxable);
        Assert.Equal(700, TaxEngine.ComputeLine(10_000, "ebook", false, new TaxContext("DE", "b2c", null), Rules, at, "EUR").Tax);
        var b2b = TaxEngine.ComputeLine(10_000, "digital_service", false, new TaxContext("DE", "b2b", "DE123456789"), Rules, at, "EUR");
        Assert.True(b2b.ReverseCharge);
        Assert.Equal(0, b2b.Tax);
    }

    [Fact]
    public void Tax_rule_versions_apply_by_effective_date()
    {
        var before = TaxEngine.ComputeLine(10_000, "saas", false, new TaxContext("IN", "b2c", null), Rules, new DateTime(2025, 6, 1, 0, 0, 0, DateTimeKind.Utc), "INR");
        var after = TaxEngine.ComputeLine(10_000, "saas", false, new TaxContext("IN", "b2c", null), Rules, new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc), "INR");
        Assert.Equal((1800, 1), (before.Tax, before.Rule!.Version));
        Assert.Equal((1200, 2), (after.Tax, after.Rule!.Version));
    }

    [Fact]
    public void Fees_combine_percentage_fixed_international_and_never_exceed_amount()
    {
        var schedules = new[] { new FeeSchedule { Id = "f", PercentBps = 350, FixedMinor = 30, FixedCurrency = "USD", InternationalBps = 150, Active = true } };
        var domestic = FeeEngine.Compute(10_000, "USD", "card", "US", "US", "org", schedules, (a, _, _) => a);
        Assert.Equal(350 + 30, domestic.Total);
        var intl = FeeEngine.Compute(10_000, "USD", "card", "IN", "US", "org", schedules, (a, _, _) => a);
        Assert.Equal(350 + 30 + 150, intl.Total);
        Assert.Equal(1, FeeEngine.Compute(1, "USD", "card", "US", "US", "org", schedules, (a, _, _) => a).Total);
    }

    [Fact]
    public void Risk_scores_are_explainable()
    {
        var d = RiskEngine.Evaluate(new RiskInput(600_000, "x@mailinator.com", "US", "GB", "1.2.3.4", 6, 0, 0, "low", true));
        Assert.Equal("DECLINE", d.Action);
        Assert.Contains(d.Signals, s => s.Code == "disposable_email");
        Assert.Equal(d.Score, Math.Min(100, d.Signals.Sum(s => s.Weight)));
        Assert.Equal("ALLOW", RiskEngine.Evaluate(new RiskInput(2_000, "a@b.com", "US", "US", null, 0, 0, 0, "low", false)).Action);
    }

    [Theory]
    [InlineData("Viktor Testovich Blocked", "Viktor Testovich Blocked", 100)]
    [InlineData("viktor testovich blocked", "Blocked Viktor Testovich", 100)] // token order ignored
    public void Screening_normalizes_and_scores(string a, string b, int expected) =>
        Assert.Equal(expected, ScreeningService.Score(ScreeningService.Normalize(a), ScreeningService.Normalize(b)));

    [Fact]
    public void Screening_near_match_is_high_but_unrelated_names_are_low()
    {
        var near = ScreeningService.Score(ScreeningService.Normalize("Viktor Testovic Blocked"), ScreeningService.Normalize("Viktor Testovich Blocked"));
        var far = ScreeningService.Score(ScreeningService.Normalize("Priya Sharma"), ScreeningService.Normalize("Viktor Testovich Blocked"));
        Assert.True(near >= 88, $"near={near}");
        Assert.True(far < 70, $"far={far}");
    }

    [Fact]
    public void Totp_matches_rfc6238_reference_vector()
    {
        // RFC 6238 SHA-1 seed "12345678901234567890" = base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ; T=59s → 94287082 (6-digit: 287082)
        Assert.Equal("287082", Totp.Code("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", DateTimeOffset.FromUnixTimeSeconds(59).UtcDateTime));
    }

    [Fact]
    public void Passwords_hash_and_verify()
    {
        var h = Crypto.HashPassword("Correct-Horse-9");
        Assert.True(Crypto.VerifyPassword("Correct-Horse-9", h));
        Assert.False(Crypto.VerifyPassword("wrong-password", h));
    }
}
