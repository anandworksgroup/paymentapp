using PaymentApp.Api.Endpoints;

namespace PaymentApp.Tests;

/// <summary>Cancellation retention flows (§257) and checkout A/B experiments (§108).</summary>
public class RetentionExperimentTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _http = f.CreateClient();

    [Fact]
    public void Two_proportion_test_matches_reference_values()
    {
        // 50/100 vs 70/100: z ≈ 2.887, two-sided p ≈ 0.0039
        Assert.InRange(GrowthEndpoints.TwoProportionP(50, 100, 70, 100)!.Value, 0.0036, 0.0042);
        Assert.InRange(GrowthEndpoints.TwoProportionP(10, 100, 11, 100)!.Value, 0.8, 1.0);
        Assert.Null(GrowthEndpoints.TwoProportionP(0, 0, 1, 10));
    }

    [Fact]
    public async Task Cancelling_customer_sees_reasons_and_offers_and_can_be_saved()
    {
        var (merchant, _, _, _) = await Scenario.ApprovedMerchant(f, _http, "retain@acme.test", "Retain Co");
        await merchant.Post("/v1/coupons", new { code = "STAY50", percent_off_bps = 5000, duration = "repeating", duration_in_months = 3 }, 201);
        await merchant.Patch("/v1/organization", new { retention_coupon = "STAY50" });
        var product = await merchant.Post("/v1/products", new { name = "Plan" }, 201);
        var monthly = await merchant.Post("/v1/prices", new { product_id = product["id"]!.GetValue<string>(), currency = "USD", type = "recurring", interval = "month", unit_amount = 4000 }, 201);

        async Task<(string Sub, Api Portal, string Token)> Subscriber(string email)
        {
            var (_, r) = await Scenario.Buy(merchant, monthly["id"]!.GetValue<string>(), mode: "subscription", country: "US", email: email);
            var sub = r["subscription"]!.GetValue<string>();
            var cus = f.WithDb(db => db.Subscriptions.First(s => s.Id == sub).CustomerId);
            var portal = await merchant.Post($"/v1/customers/{cus}/portal_sessions");
            return (sub, new Api(_http), portal["url"]!.GetValue<string>().Split('/').Last());
        }

        var (saved, portalA, tokenA) = await Subscriber("save-me@example.com");
        var options = await portalA.Get($"/v1/portal/{tokenA}/subscriptions/{saved}/cancel_options");
        Assert.Contains(options["reasons"]!.AsArray(), r => r!.GetValue<string>() == "too_expensive");
        var offers = options["offers"]!.AsArray();
        Assert.Contains(offers, o => o!["type"]!.GetValue<string>() == "discount" && o["coupon"]!.GetValue<string>() == "STAY50");
        Assert.Contains(offers, o => o!["type"]!.GetValue<string>() == "pause");
        var accepted = await portalA.Post($"/v1/portal/{tokenA}/subscriptions/{saved}/cancel", new { reason = "too_expensive", accept_offer = "discount" });
        Assert.Equal("ACTIVE", accepted["status"]!.GetValue<string>());
        Assert.False(accepted["cancel_at_period_end"]!.GetValue<bool>());
        // The next renewal is half price for three months.
        f.WithDb(db => { var s = db.Subscriptions.First(x => x.Id == saved); s.CurrentPeriodEnd = DateTime.UtcNow.AddMinutes(-1); return db.SaveChanges(); });
        await merchant.Post("/v1/test_helpers/run_jobs");
        var renewal = (await merchant.Get($"/v1/invoices?subscription={saved}"))["data"]!.AsArray().First(i => i!["billing_reason"]!.GetValue<string>() == "subscription_cycle")!;
        Assert.Equal(2000, renewal["total"]!.GetValue<long>());

        var (lost, portalB, tokenB) = await Subscriber("leaving@example.com");
        var cancelled = await portalB.Post($"/v1/portal/{tokenB}/subscriptions/{lost}/cancel", new { reason = "missing_features", feedback = "Needs SSO" });
        Assert.True(cancelled["cancel_at_period_end"]!.GetValue<bool>());
        Assert.Equal("missing_features", cancelled["cancellation_reason"]!.GetValue<string>());
        Assert.Equal("Needs SSO", f.WithDb(db => db.Subscriptions.First(s => s.Id == lost).CancellationFeedback));
        var churn = await merchant.Get("/v1/reports/churn");
        Assert.Equal(1, churn["retention_saves"]!.GetValue<int>());
    }

    [Fact]
    public async Task Experiment_splits_link_traffic_and_reports_per_variant()
    {
        var (merchant, _, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "ab@acme.test", "AB Co");
        var product = await merchant.Post("/v1/products", new { name = "Ebook" }, 201);
        var cheaper = await merchant.Post("/v1/prices", new { product_id = product["id"]!.GetValue<string>(), currency = "USD", type = "one_time", unit_amount = 7900 }, 201);
        var link = await merchant.Post("/v1/payment_links", new { price_id = priceId }, 201);
        var e = await merchant.Post("/v1/experiments", new
        {
            name = "Price test", payment_link = link["id"]!.GetValue<string>(), hypothesis = "A lower price converts better",
            variants = new object[] { new { key = "control", weight = 50 }, new { key = "lower_price", weight = 50, price_id = cheaper["id"]!.GetValue<string>() } },
        }, 201);
        await merchant.Post($"/v1/experiments/{e["id"]}/start");

        var buyer = new Api(_http);
        var sessions = new List<string>();
        for (var i = 0; i < 30; i++) sessions.Add((await buyer.Post($"/v1/public/links/{link["id"]}"))["checkout_session"]!.GetValue<string>());
        foreach (var sid in sessions.Take(10))
            await buyer.Post($"/v1/public/checkout/{sid}/confirm", new { email = $"ab{sid[^5..]}@example.com", country = "US", token = await Scenario.Card(merchant), accept_terms = true });

        var report = await merchant.Get($"/v1/experiments/{e["id"]}");
        var rows = report["results"]!.AsArray();
        Assert.Equal(30, rows.Sum(r => r!["visits"]!.GetValue<int>()));
        Assert.Equal(10, rows.Sum(r => r!["conversions"]!.GetValue<int>()));
        Assert.All(rows, r => Assert.True(r!["visits"]!.GetValue<int>() > 0));
        // Variant sessions really use the variant price.
        var lower = f.WithDb(db => db.CheckoutSessions.Where(s => s.ExperimentVariant!.EndsWith(":lower_price")).Select(s => s.Subtotal).Distinct().ToList());
        Assert.Equal([7900L], lower);
        var revenue = rows.Sum(r => r!["revenue_excluding_tax"]!.GetValue<long>());
        Assert.True(revenue is >= 79000 and <= 100000);
        await merchant.Post($"/v1/experiments/{e["id"]}/stop");
        var after = (await buyer.Post($"/v1/public/links/{link["id"]}"))["checkout_session"]!.GetValue<string>();
        Assert.Null(f.WithDb(db => db.CheckoutSessions.First(s => s.Id == after).ExperimentVariant));
    }
}
