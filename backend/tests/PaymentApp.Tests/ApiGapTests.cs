using System.Text.Json.Nodes;
using PaymentApp.Api.Common;
using PaymentApp.Api.Modules.Ledger;

namespace PaymentApp.Tests;

/// <summary>Regression tests for API gaps and bugs reported by the web and mobile clients.</summary>
public class ApiGapTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _http = f.CreateClient();

    private void AssertLedgerBalanced()
    {
        var json = JsonNode.Parse(Json.Serialize(f.WithDb(db => LedgerService.VerifyIntegrity(db).GetAwaiter().GetResult())))!;
        Assert.True(json["balanced"]!.GetValue<bool>(), json.ToJsonString());
    }

    private async Task<Api> WalletUser(string email, string name, string country)
    {
        var api = await Scenario.SignUp(_http, email, name, country: country);
        await api.Post("/v1/me/kyc", new { full_name = name, date_of_birth = "1990-01-01", country, address = "1 St", document_type = "passport", level = 2 });
        await api.Post("/v1/wallet/activate");
        return api;
    }

    [Fact]
    public async Task Wallet_exchange_limits_detail_and_paginated_activity()
    {
        var u = await WalletUser("xchg@w.test", "Xena Change", "IN");
        await u.Post("/v1/wallet/fund", new { currency = "INR", amount = 5_000_000 });
        var quote = await u.Post("/v1/wallet/fx/quotes", new { from_currency = "INR", to_currency = "USD", amount = 1_000_000 });
        var t = await u.Post("/v1/wallet/exchanges", new { quote_id = quote["id"]!.GetValue<string>() }, 201);
        Assert.Equal("COMPLETED", t["status"]!.GetValue<string>());
        Assert.Equal("conversion", t["type"]!.GetValue<string>());
        var wallet = await u.Get("/v1/wallet");
        long Avail(string c) => wallet["balances"]!.AsArray().First(b => b!["currency"]!.GetValue<string>() == c)!["available"]!.GetValue<long>();
        Assert.Equal(quote["destination_amount"]!.GetValue<long>(), Avail("USD"));
        Assert.Equal(5_000_000 - 1_000_000 - quote["fee_amount"]!.GetValue<long>(), Avail("INR"));
        await u.Post("/v1/wallet/exchanges", new { quote_id = quote["id"]!.GetValue<string>() }, 409); // single use

        var detail = await u.Get($"/v1/wallet/transfers/{t["id"]}");
        Assert.Equal("Exchange INR → USD", detail["counterparty"]!.GetValue<string>());

        var limits = await u.Get("/v1/wallet/limits");
        Assert.True(limits["usage"]!["conversions"]!["last_24h_usd"]!.GetValue<long>() > 0);
        Assert.True(limits["usage"]!["funding"]!["remaining_24h_usd"]!.GetValue<long>() >= 0);
        Assert.Equal(30, limits["fees"]!["cross_currency_bps"]!.GetValue<int>());

        for (var i = 0; i < 3; i++) await u.Post("/v1/wallet/fund", new { currency = "INR", amount = 10_000 });
        var first = await u.Get("/v1/wallet/transactions?limit=2");
        Assert.True(first["has_more"]!.GetValue<bool>());
        var last = first["data"]!.AsArray()[1]!["id"]!.GetValue<string>();
        var second = await u.Get($"/v1/wallet/transactions?limit=10&starting_after={last}");
        Assert.Equal(3, second["data"]!.AsArray().Count); // 5 total: 4 fundings + 1 exchange
        Assert.DoesNotContain(second["data"]!.AsArray(), x => first["data"]!.AsArray().Any(y => y!["id"]!.GetValue<string>() == x!["id"]!.GetValue<string>()));
        AssertLedgerBalanced();
    }

    [Fact]
    public async Task Password_check_does_not_grant_step_up_and_notifications_can_be_read()
    {
        var (merchant, _, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "gaps@acme.test", "Gaps Co");
        await merchant.Post("/v1/auth/verify_password", new { password = "wrong-password-1" }, 401);
        await merchant.Post("/v1/auth/verify_password", new { password = Scenario.Password });
        // Verifying the password alone must not unlock high-risk actions.
        await merchant.Post("/v1/payout_destinations", new { country = "US", currency = "USD", account_holder = "Gaps", bank_name = "B", account_number = "12345678", routing_number = "1" }, 403);

        var me = await merchant.Get("/v1/me");
        Assert.Contains(me["organizations"]![0]!["permissions"]!.AsArray(), p => p!.GetValue<string>() == "payments.refund");

        await Scenario.StepUp(merchant);
        await merchant.Post("/v1/payout_destinations", new { country = "US", currency = "USD", account_holder = "Gaps", bank_name = "B", account_number = "12345678", routing_number = "1" });
        var notes = (await merchant.Get("/v1/me/notifications?scope=org"))["data"]!.AsArray();
        var changed = notes.First(n => n!["template"]!.GetValue<string>() == "payout_account_changed")!;
        Assert.False(changed["read"]!.GetValue<bool>());
        await merchant.Post($"/v1/me/notifications/{changed["id"]}/read");
        Assert.True((await merchant.Get("/v1/me/notifications?scope=org"))["data"]!.AsArray().First(n => n!["id"]!.GetValue<string>() == changed["id"]!.GetValue<string>())!["read"]!.GetValue<bool>());

        // Refundable amount is provided by the server.
        var (_, paid) = await Scenario.Buy(merchant, priceId, country: "US", email: "gap-buyer@example.com");
        var pid = paid["payment"]!.GetValue<string>();
        Assert.Equal(10000, (await merchant.Get($"/v1/payments/{pid}"))["refundable_amount"]!.GetValue<long>());
        await merchant.Post("/v1/refunds", new { payment = pid, amount = 2500 }, 201);
        Assert.Equal(7500, (await merchant.Get($"/v1/payments/{pid}"))["refundable_amount"]!.GetValue<long>());

        // expand=summary on lists; bad preview input is a 400, not a 500.
        var prices = await merchant.Get("/v1/prices?expand=summary");
        Assert.Equal("Writer Pro", prices["data"]![0]!["product_name"]!.GetValue<string>());
        await merchant.Post($"/v1/prices/{priceId}/preview?quantities=abc", null, 400);
    }

    [Fact]
    public async Task Grace_period_suspends_access_and_payment_restores_it()
    {
        var (merchant, _, _, _) = await Scenario.ApprovedMerchant(f, _http, "grace@acme.test", "Grace Co");
        await merchant.Patch("/v1/organization", new { dunning_grace_days = 2, dunning_retry_days_csv = "5,10" });
        var cus = (await merchant.Post("/v1/customers", new { email = "late@example.com", country = "US" }, 201))["id"]!.GetValue<string>();
        var pm = (await merchant.Post($"/v1/customers/{cus}/payment_methods", new { token = await Scenario.Card(merchant, "4000000000000341") }))["id"]!.GetValue<string>();
        var product = await merchant.Post("/v1/products", new { name = "Access" }, 201);
        var plan = await merchant.Post("/v1/prices", new { product_id = product["id"]!.GetValue<string>(), currency = "USD", type = "recurring", interval = "month", unit_amount = 1000 }, 201);
        var start = new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Utc);
        var clock = await merchant.Post("/v1/test_clocks", new { frozen_time = start }, 201);
        var sub = await merchant.Post("/v1/subscriptions", new { customer = cus, payment_method = pm, test_clock = clock["id"]!.GetValue<string>(), items = new[] { new { price = plan["id"]!.GetValue<string>(), quantity = 1L } } }, 201);
        var subId = sub["id"]!.GetValue<string>();

        await merchant.Post($"/v1/test_clocks/{clock["id"]}/advance", new { frozen_time = start.AddMonths(1).AddHours(1) });
        Assert.Equal("PAST_DUE", (await merchant.Get($"/v1/subscriptions/{subId}"))["subscription"]!["status"]!.GetValue<string>());
        Assert.Equal("active", (await merchant.Get($"/v1/entitlements?customer={cus}"))["data"]![0]!["status"]!.GetValue<string>()); // within grace

        await merchant.Post($"/v1/test_clocks/{clock["id"]}/advance", new { frozen_time = start.AddMonths(1).AddDays(3) });
        Assert.Equal("suspended", (await merchant.Get($"/v1/entitlements?customer={cus}"))["data"]![0]!["status"]!.GetValue<string>());

        // The customer updates their card; paying the invoice restores access.
        var good = (await merchant.Post($"/v1/customers/{cus}/payment_methods", new { token = await Scenario.Card(merchant) }))["id"]!.GetValue<string>();
        f.WithDb(db => { db.Subscriptions.First(s => s.Id == subId).DefaultPaymentMethodId = good; return db.SaveChanges(); });
        var invoice = (await merchant.Get($"/v1/invoices?subscription={subId}&status=PAST_DUE"))["data"]![0]!;
        await merchant.Post($"/v1/invoices/{invoice["id"]}/pay");
        Assert.Equal("ACTIVE", (await merchant.Get($"/v1/subscriptions/{subId}"))["subscription"]!["status"]!.GetValue<string>());
        Assert.Equal("active", (await merchant.Get($"/v1/entitlements?customer={cus}"))["data"]![0]!["status"]!.GetValue<string>());

        // Resume clears a pending cancellation instead of cancelling immediately.
        await merchant.Post($"/v1/subscriptions/{subId}/cancel", new { at_period_end = true });
        await merchant.Post($"/v1/subscriptions/{subId}/pause");
        var resumed = await merchant.Post($"/v1/subscriptions/{subId}/resume");
        Assert.Equal("ACTIVE", resumed["status"]!.GetValue<string>());
        Assert.False(resumed["cancel_at_period_end"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Disabled_webhooks_stop_retrying_and_can_be_re_enabled()
    {
        var (merchant, _, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "hooks@acme.test", "Hooks Co");
        f.Webhooks.Respond = System.Net.HttpStatusCode.InternalServerError;
        try
        {
            var ep = (await merchant.Post("/v1/webhook_endpoints", new { url = "http://localhost:9/down", enabled_events = "payment.succeeded" }, 201))["webhook_endpoint"]!;
            await Scenario.Buy(merchant, priceId, country: "US", email: "hook@example.com");
            await merchant.Post("/v1/test_helpers/run_jobs");
            var retrying = (await merchant.Get($"/v1/webhook_deliveries?endpoint={ep["id"]}"))["data"]!.AsArray().Single()!;
            Assert.Equal("retrying", retrying["status"]!.GetValue<string>());

            var del = await merchant.Send(HttpMethod.Delete, $"/v1/webhook_endpoints/{ep["id"]}");
            Assert.Equal(204, (int)del.Status);
            f.WithDb(db => { db.WebhookDeliveries.First(d => d.Id == retrying["id"]!.GetValue<string>()).NextAttemptAt = DateTime.UtcNow.AddMinutes(-1); return db.SaveChanges(); });
            var before = f.Webhooks.Requests.Count;
            await merchant.Post("/v1/test_helpers/run_jobs");
            Assert.Equal(before, f.Webhooks.Requests.Count);
            Assert.Equal("dead", (await merchant.Get($"/v1/webhook_deliveries?endpoint={ep["id"]}"))["data"]![0]!["status"]!.GetValue<string>());

            var enabled = await merchant.Post($"/v1/webhook_endpoints/{ep["id"]}/enable");
            Assert.Equal("enabled", enabled["status"]!.GetValue<string>());
        }
        finally { f.Webhooks.Respond = System.Net.HttpStatusCode.OK; }
    }
}
