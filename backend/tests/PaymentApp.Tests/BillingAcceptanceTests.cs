using System.Text.Json.Nodes;
using PaymentApp.Api.Common;
using PaymentApp.Api.Modules.Ledger;

namespace PaymentApp.Tests;

/// <summary>Subscriptions, usage, credits, dunning and proration driven by test clocks (§25-§30, §61, §152, §183).</summary>
public class BillingAcceptanceTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _http = f.CreateClient();

    private void AssertLedgerBalanced()
    {
        var json = JsonNode.Parse(Json.Serialize(f.WithDb(db => LedgerService.VerifyIntegrity(db).GetAwaiter().GetResult())))!;
        Assert.True(json["balanced"]!.GetValue<bool>(), json.ToJsonString());
    }

    private async Task<(Api Merchant, string Customer, string Pm)> CustomerWithCard(string email, string org, string card = "4242424242424242", string country = "GB")
    {
        var (merchant, _, _, _) = await Scenario.ApprovedMerchant(f, _http, email, org);
        var customer = await merchant.Post("/v1/customers", new { email = "sub-" + email, name = "Sam Subscriber", country }, 201);
        var cus = customer["id"]!.GetValue<string>();
        var pm = await merchant.Post($"/v1/customers/{cus}/payment_methods", new { token = await Scenario.Card(merchant, card) });
        return (merchant, cus, pm["id"]!.GetValue<string>());
    }

    [Fact]
    public async Task Subscription_renews_with_usage_and_tax_on_a_test_clock()
    {
        var (merchant, cus, pm) = await CustomerWithCard("bill1@acme.test", "Bill One");
        var start = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var clock = await merchant.Post("/v1/test_clocks", new { frozen_time = start, name = "renewals" }, 201);
        var product = await merchant.Post("/v1/products", new { name = "Pro" }, 201);
        var plan = await merchant.Post("/v1/prices", new { product_id = product["id"]!.GetValue<string>(), currency = "USD", type = "recurring", interval = "month", unit_amount = 5000 }, 201);
        var meter = await merchant.Post("/v1/meters", new { event_name = "api_calls", display_name = "API calls" }, 201);
        var api = await merchant.Post("/v1/products", new { name = "API" }, 201);
        var metered = await merchant.Post("/v1/prices", new
        {
            product_id = api["id"]!.GetValue<string>(), currency = "USD", type = "recurring", interval = "month", unit_amount = 0, usage_type = "metered",
            meter_id = meter["id"]!.GetValue<string>(), scheme = "tiered", tiers_mode = "graduated",
            tiers = new object[] { new { up_to = 1000, unit_amount = 0, flat_amount = 0 }, new { up_to = (long?)null, unit_amount = 2, flat_amount = 0 } },
        }, 201);

        var sub = await merchant.Post("/v1/subscriptions", new
        {
            customer = cus, payment_method = pm, test_clock = clock["id"]!.GetValue<string>(),
            items = new[] { new { price = plan["id"]!.GetValue<string>(), quantity = 1L }, new { price = metered["id"]!.GetValue<string>(), quantity = 1L } },
        }, 201);
        var subId = sub["id"]!.GetValue<string>();
        Assert.Equal("ACTIVE", sub["status"]!.GetValue<string>());
        var first = (await merchant.Get($"/v1/invoices?subscription={subId}"))["data"]!.AsArray().Single()!;
        Assert.Equal(6000, first["total"]!.GetValue<long>()); // $50 + UK VAT 20%
        Assert.Equal("PAID", first["status"]!.GetValue<string>());

        // Usage: 1,500 calls (500 billable × $0.02) + a duplicate that must be ignored + a correction.
        var e1 = await merchant.Post("/v1/usage_events", new { customer = cus, event_name = "api_calls", quantity = 1200, timestamp = start.AddDays(3), idempotency_key = "u-1" }, 201);
        var dup = await merchant.Post("/v1/usage_events/batch", new { events = new[] { new { customer = cus, event_name = "api_calls", quantity = 1200, timestamp = start.AddDays(3), idempotency_key = "u-1" }, new { customer = cus, event_name = "api_calls", quantity = 400, timestamp = start.AddDays(5), idempotency_key = "u-2" } } });
        Assert.Equal(1, dup["duplicates"]!.GetValue<int>());
        await merchant.Post("/v1/usage_events", new { customer = cus, event_name = "api_calls", quantity = -100, timestamp = start.AddDays(6), idempotency_key = "u-3", corrects_event_id = e1["id"]!.GetValue<string>() }, 201);

        await merchant.Post($"/v1/test_clocks/{clock["id"]}/advance", new { frozen_time = start.AddMonths(1).AddHours(1) });
        var invoices = (await merchant.Get($"/v1/invoices?subscription={subId}"))["data"]!.AsArray();
        Assert.Equal(2, invoices.Count);
        var renewal = invoices.First(i => i!["billing_reason"]!.GetValue<string>() == "subscription_cycle")!;
        var detail = await merchant.Get($"/v1/invoices/{renewal["id"]}");
        var usageLine = detail["lines"]!.AsArray().First(l => l!["description"]!.GetValue<string>().Contains("API"))!;
        Assert.Equal(1500, usageLine["quantity"]!.GetValue<long>());
        Assert.Equal(1000, usageLine["amount"]!.GetValue<long>());               // 500 × 2¢
        Assert.Equal((5000 + 1000) * 12 / 10, renewal["total"]!.GetValue<long>()); // + 20% VAT
        Assert.Equal("PAID", renewal["status"]!.GetValue<string>());
        Assert.NotNull(detail["calculation_inputs"]);                              // reproducible (§26)
        var s = (await merchant.Get($"/v1/subscriptions/{subId}"))["subscription"]!;
        Assert.Equal(start.AddMonths(1), s["current_period_start"]!.GetValue<DateTime>());

        // Two more months of renewals in one advance.
        await merchant.Post($"/v1/test_clocks/{clock["id"]}/advance", new { frozen_time = start.AddMonths(3).AddHours(1) });
        Assert.Equal(4, (await merchant.Get($"/v1/invoices?subscription={subId}"))["data"]!.AsArray().Count);
        AssertLedgerBalanced();
    }

    [Fact]
    public async Task Failed_renewal_enters_dunning_then_cancels_and_revokes_access()
    {
        var (merchant, cus, pm) = await CustomerWithCard("bill2@acme.test", "Bill Two", card: "4000000000000341", country: "US");
        var start = new DateTime(2026, 2, 1, 0, 0, 0, DateTimeKind.Utc);
        var clock = await merchant.Post("/v1/test_clocks", new { frozen_time = start }, 201);
        var product = await merchant.Post("/v1/products", new { name = "Basic" }, 201);
        var plan = await merchant.Post("/v1/prices", new { product_id = product["id"]!.GetValue<string>(), currency = "USD", type = "recurring", interval = "month", unit_amount = 1500 }, 201);
        var sub = await merchant.Post("/v1/subscriptions", new { customer = cus, payment_method = pm, test_clock = clock["id"]!.GetValue<string>(), items = new[] { new { price = plan["id"]!.GetValue<string>(), quantity = 1L } } }, 201);
        var subId = sub["id"]!.GetValue<string>();
        Assert.Equal("ACTIVE", sub["status"]!.GetValue<string>());
        Assert.Contains((await merchant.Get($"/v1/entitlements?customer={cus}"))["data"]!.AsArray(), e => e!["status"]!.GetValue<string>() == "active");

        // The card works once, then declines off-session: renewal fails → PAST_DUE with a retry scheduled.
        await merchant.Post($"/v1/test_clocks/{clock["id"]}/advance", new { frozen_time = start.AddMonths(1).AddMinutes(5) });
        var pastDue = (await merchant.Get($"/v1/subscriptions/{subId}"))["subscription"]!;
        Assert.Equal("PAST_DUE", pastDue["status"]!.GetValue<string>());
        Assert.Equal(1, pastDue["dunning_attempts"]!.GetValue<int>());

        // Retries on days 1,3,5,7 all fail → dunning exhausted → cancelled, invoice uncollectible, access revoked.
        await merchant.Post($"/v1/test_clocks/{clock["id"]}/advance", new { frozen_time = start.AddMonths(1).AddDays(20) });
        var cancelled = (await merchant.Get($"/v1/subscriptions/{subId}"))["subscription"]!;
        Assert.Equal("CANCELLED", cancelled["status"]!.GetValue<string>());
        Assert.Equal("payment_failed", cancelled["cancellation_reason"]!.GetValue<string>());
        var renewal = (await merchant.Get($"/v1/invoices?subscription={subId}"))["data"]!.AsArray().First(i => i!["billing_reason"]!.GetValue<string>() == "subscription_cycle")!;
        Assert.Equal("UNCOLLECTIBLE", renewal["status"]!.GetValue<string>());
        Assert.Equal(5, renewal["attempt_count"]!.GetValue<int>());
        Assert.All((await merchant.Get($"/v1/entitlements?customer={cus}"))["data"]!.AsArray(), e => Assert.Equal("revoked", e!["status"]!.GetValue<string>()));
        AssertLedgerBalanced();
    }

    [Fact]
    public async Task Plan_change_prorates_upgrade_now_and_credits_downgrade()
    {
        var (merchant, cus, pm) = await CustomerWithCard("bill3@acme.test", "Bill Three", country: "US");
        var start = new DateTime(2026, 4, 1, 0, 0, 0, DateTimeKind.Utc); // 30-day month
        var clock = await merchant.Post("/v1/test_clocks", new { frozen_time = start }, 201);
        var product = await merchant.Post("/v1/products", new { name = "Tiers" }, 201);
        var pid = product["id"]!.GetValue<string>();
        var basic = await merchant.Post("/v1/prices", new { product_id = pid, currency = "USD", type = "recurring", interval = "month", unit_amount = 3000 }, 201);
        var pro = await merchant.Post("/v1/prices", new { product_id = pid, currency = "USD", type = "recurring", interval = "month", unit_amount = 9000 }, 201);
        var sub = await merchant.Post("/v1/subscriptions", new { customer = cus, payment_method = pm, test_clock = clock["id"]!.GetValue<string>(), items = new[] { new { price = basic["id"]!.GetValue<string>(), quantity = 1L } } }, 201);
        var subId = sub["id"]!.GetValue<string>();

        await merchant.Post($"/v1/test_clocks/{clock["id"]}/advance", new { frozen_time = start.AddDays(15) });
        var preview = await merchant.Post($"/v1/subscriptions/{subId}/change", new { price = pro["id"]!.GetValue<string>(), quantity = 1, preview = true });
        Assert.Equal(1500, preview["credit_for_unused_time"]!.GetValue<long>());
        Assert.Equal(4500, preview["charge_for_remaining_time"]!.GetValue<long>());
        Assert.Equal(3000, preview["net_amount"]!.GetValue<long>());
        Assert.Equal(1, (await merchant.Get($"/v1/invoices?subscription={subId}"))["data"]!.AsArray().Count); // preview changes nothing

        await merchant.Post($"/v1/subscriptions/{subId}/change", new { price = pro["id"]!.GetValue<string>(), quantity = 1 });
        var proration = (await merchant.Get($"/v1/invoices?subscription={subId}"))["data"]!.AsArray().First(i => i!["billing_reason"]!.GetValue<string>() == "proration")!;
        Assert.Equal(3000, proration["total"]!.GetValue<long>());
        Assert.Equal("PAID", proration["status"]!.GetValue<string>());

        // Downgrade back: credit goes to the customer's balance and reduces the next invoice.
        await merchant.Post($"/v1/subscriptions/{subId}/change", new { price = basic["id"]!.GetValue<string>(), quantity = 1 });
        Assert.Equal(3000, (await merchant.Get($"/v1/customers/{cus}"))["customer"]!["credit_balance"]!.GetValue<long>());
        await merchant.Post($"/v1/test_clocks/{clock["id"]}/advance", new { frozen_time = start.AddMonths(1).AddHours(1) });
        var next = (await merchant.Get($"/v1/invoices?subscription={subId}"))["data"]!.AsArray().First(i => i!["billing_reason"]!.GetValue<string>() == "subscription_cycle")!;
        Assert.Equal(3000, next["amount_credited"]!.GetValue<long>());
        Assert.Equal(0, next["amount_due"]!.GetValue<long>());
        Assert.Equal("PAID", next["status"]!.GetValue<string>());
        AssertLedgerBalanced();
    }

    [Fact]
    public async Task Trial_checkout_charges_nothing_then_bills_after_trial()
    {
        var (merchant, _, _, _) = await Scenario.ApprovedMerchant(f, _http, "bill4@acme.test", "Bill Four");
        var product = await merchant.Post("/v1/products", new { name = "Team" }, 201);
        var seat = await merchant.Post("/v1/prices", new { product_id = product["id"]!.GetValue<string>(), currency = "USD", type = "recurring", interval = "month", unit_amount = 1500, trial_days = 14 }, 201);
        var (session, result) = await Scenario.Buy(merchant, seat["id"]!.GetValue<string>(), mode: "subscription", qty: 3, country: "US", email: "trial@example.com");
        Assert.Equal("complete", result["status"]!.GetValue<string>());
        Assert.Equal("no_payment_required", result["payment_status"]!.GetValue<string>());
        var subId = result["subscription"]!.GetValue<string>();
        var sub = (await merchant.Get($"/v1/subscriptions/{subId}"))["subscription"]!;
        Assert.Equal("TRIALING", sub["status"]!.GetValue<string>());
        Assert.Equal(0, f.WithDb(db => db.Payments.Count(p => p.CheckoutSessionId == session)));
        Assert.Equal(3, f.WithDb(db => db.Entitlements.First(e => e.SourceId == subId).Seats));

        // Trial end: the renewal job bills 3 seats.
        f.WithDb(db => { var s = db.Subscriptions.First(x => x.Id == subId); s.CurrentPeriodEnd = DateTime.UtcNow.AddMinutes(-1); s.TrialEnd = s.CurrentPeriodEnd; return db.SaveChanges(); });
        await merchant.Post("/v1/test_helpers/run_jobs");
        sub = (await merchant.Get($"/v1/subscriptions/{subId}"))["subscription"]!;
        Assert.Equal("ACTIVE", sub["status"]!.GetValue<string>());
        var invoice = (await merchant.Get($"/v1/invoices?subscription={subId}"))["data"]!.AsArray().First(i => i!["billing_reason"]!.GetValue<string>() == "subscription_cycle")!;
        Assert.Equal(4500, invoice["total"]!.GetValue<long>());
        Assert.Equal("PAID", invoice["status"]!.GetValue<string>());
    }

    [Fact]
    public async Task Credit_packs_grant_credits_and_consumption_cannot_overspend()
    {
        var (merchant, _, _, _) = await Scenario.ApprovedMerchant(f, _http, "bill5@acme.test", "Bill Five");
        var product = await merchant.Post("/v1/products", new { name = "Credits", type = "credit_package" }, 201);
        var pack = await merchant.Post("/v1/prices", new { product_id = product["id"]!.GetValue<string>(), currency = "USD", type = "one_time", unit_amount = 4900, credits_granted = 1000 }, 201);
        var (_, result) = await Scenario.Buy(merchant, pack["id"]!.GetValue<string>(), country: "US", email: "credits@example.com");
        var cus = f.WithDb(db => db.Payments.First(p => p.Id == result["payment"]!.GetValue<string>()).CustomerId!);
        Assert.Equal(1000, (await merchant.Get($"/v1/credits/{cus}"))["available"]!.GetValue<long>());

        // 12 concurrent consumers of 100 credits each: exactly 10 succeed, balance never negative (§242).
        var tasks = Enumerable.Range(0, 12).Select(i => merchant.Send(HttpMethod.Post, "/v1/credits", new { customer = cus, operation = "consume", amount = 100, idempotency_key = $"c-{i}" }));
        var outcomes = await Task.WhenAll(tasks);
        Assert.Equal(10, outcomes.Count(o => (int)o.Status == 200));
        Assert.Equal(2, outcomes.Count(o => (int)o.Status == 402));
        var balance = await merchant.Get($"/v1/credits/{cus}");
        Assert.Equal(0, balance["available"]!.GetValue<long>());
        // The same idempotency key never double-spends.
        await merchant.Post("/v1/credits", new { customer = cus, operation = "issue", amount = 50, idempotency_key = "topup-1" });
        await merchant.Post("/v1/credits", new { customer = cus, operation = "issue", amount = 50, idempotency_key = "topup-1" });
        Assert.Equal(50, (await merchant.Get($"/v1/credits/{cus}"))["available"]!.GetValue<long>());
    }
}
