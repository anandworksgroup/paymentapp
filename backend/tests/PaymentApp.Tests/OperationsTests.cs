using System.Text.Json.Nodes;
using PaymentApp.Api.Common;
using PaymentApp.Api.Modules.Ledger;

namespace PaymentApp.Tests;

/// <summary>Marketplace sellers, month-end close, imports and merges, expiring credits, domains, support, incidents and flags.</summary>
public class OperationsTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _http = f.CreateClient();

    private void AssertLedgerBalanced()
    {
        var json = JsonNode.Parse(Json.Serialize(f.WithDb(db => LedgerService.VerifyIntegrity(db).GetAwaiter().GetResult())))!;
        Assert.True(json["balanced"]!.GetValue<bool>(), json.ToJsonString());
    }

    private static async Task<string> BuyFromSeller(Api merchant, string priceId, string sellerId, string email)
    {
        var session = await merchant.Post("/v1/checkout/sessions", new { mode = "payment", line_items = new[] { new { price_id = priceId, quantity = 1 } }, success_url = "https://acme.example/thanks", seller = sellerId }, 201);
        var token = await Scenario.Card(merchant);
        var r = await new Api(merchant.Http).Post($"/v1/public/checkout/{session["id"]}/confirm", new { email, name = "Bea Buyer", country = "US", token, accept_terms = true });
        return r["payment"]!.GetValue<string>();
    }

    [Fact]
    public async Task Marketplace_splits_sales_claws_back_refunds_and_disputes_and_pays_sellers()
    {
        var (merchant, _, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "market@acme.test", "Market Co");
        var seller = await merchant.Post("/v1/sellers", new { name = "Sam Seller", email = "sam@seller.example", country = "US", currency = "USD", commission_bps = 1000 }, 201);
        Assert.Equal("active", seller["status"]!.GetValue<string>());
        var sellerId = seller["id"]!.GetValue<string>();

        var p1 = await BuyFromSeller(merchant, priceId, sellerId, "m1@example.com");
        var p2 = await BuyFromSeller(merchant, priceId, sellerId, "m2@example.com");
        var p3 = await BuyFromSeller(merchant, priceId, sellerId, "m3@example.com");

        var detail = await merchant.Get($"/v1/sellers/{sellerId}");
        var sale = detail["payments"]!.AsArray().First(p => p!["id"]!.GetValue<string>() == p1)!;
        var share = sale["seller_amount"]!.GetValue<long>();
        var fee = sale["fee_amount"]!.GetValue<long>();
        Assert.Equal(1000, sale["application_fee_amount"]!.GetValue<long>()); // 10% of the $100 net sale
        Assert.Equal(10000, share + fee + 1000);
        Assert.Equal(3 * share, detail["balance"]!["balances"]!.AsArray().Single()!["pending"]!.GetValue<long>());

        // A refund takes the seller's share back; a dispute does too until it's won.
        await Scenario.StepUp(merchant);
        await merchant.Post("/v1/refunds", new { payment = p2 }, 201);
        await merchant.Post("/v1/test_helpers/run_jobs");
        var dispute = await merchant.Post($"/v1/test_helpers/payments/{p3}/dispute");
        await merchant.Post($"/v1/test_helpers/disputes/{dispute["id"]}/close", new { outcome = "won" });

        await merchant.Post("/v1/test_helpers/balance/settle_now");
        var balance = (await merchant.Get($"/v1/sellers/{sellerId}"))["balance"]!["balances"]!.AsArray().Single()!;
        Assert.Equal(0, balance["pending"]!.GetValue<long>());
        Assert.Equal(2 * share, balance["available"]!.GetValue<long>()); // p1 + p3 (won); p2 refunded

        // Payouts need a destination (step-up) and pay the full available balance.
        await merchant.Post($"/v1/sellers/{sellerId}/payouts", new { currency = "USD" }, 400);
        await merchant.Post($"/v1/sellers/{sellerId}/payout_account", new { bank_name = "First Bank", currency = "USD", account_number = "GB29NWBK60161331926819" });
        var payout = await merchant.Post($"/v1/sellers/{sellerId}/payouts", new { currency = "USD" }, 201);
        Assert.Equal(2 * share, payout["amount"]!.GetValue<long>());
        await merchant.Post("/v1/test_helpers/run_jobs");
        await merchant.Post("/v1/test_helpers/run_jobs");
        detail = await merchant.Get($"/v1/sellers/{sellerId}");
        Assert.Equal("PAID", detail["payouts"]!.AsArray().Single()!["status"]!.GetValue<string>());
        Assert.Equal(0, detail["balance"]!["balances"]!.AsArray().Single()!["available"]!.GetValue<long>());
        AssertLedgerBalanced();

        // A seller that isn't onboarded can't be charged for.
        await merchant.Post("/v1/checkout/sessions", new { mode = "payment", line_items = new[] { new { price_id = priceId, quantity = 1 } }, success_url = "https://acme.example/thanks", seller = "sel_missing" }, 404);
    }

    [Fact]
    public async Task Month_end_close_is_blocked_until_the_month_ends_and_snapshots_stay_verifiable()
    {
        var (merchant, _, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "close@acme.test", "Close Co");
        await Scenario.Buy(merchant, priceId, country: "US", email: "c1@example.com");
        var current = DateTime.UtcNow.ToString("yyyy-MM");
        var previous = DateTime.UtcNow.AddMonths(-1).ToString("yyyy-MM");

        var preview = await merchant.Get($"/v1/accounting_periods/preview?period={current}");
        Assert.False(preview["can_close"]!.GetValue<bool>());
        Assert.False(preview["checks"]!.AsArray().Single(c => c!["key"]!.GetValue<string>() == "month_ended")!["passed"]!.GetValue<bool>());

        await Scenario.StepUp(merchant);
        var blocked = await merchant.Send(HttpMethod.Post, "/v1/accounting_periods", new { period = current });
        Assert.Equal(409, (int)blocked.Status);
        Assert.Equal("close_blocked", blocked.Body!["error"]!["code"]!.GetValue<string>());

        var closed = await merchant.Post("/v1/accounting_periods", new { period = previous }, 201);
        Assert.Equal(64, closed["snapshot_sha256"]!.GetValue<string>().Length);
        await merchant.Post("/v1/accounting_periods", new { period = previous }, 409);

        // New activity lands in the open month; the closed snapshot is unchanged.
        await Scenario.Buy(merchant, priceId, country: "US", email: "c2@example.com");
        var verify = await merchant.Get($"/v1/accounting_periods/{closed["id"]}/verify");
        Assert.True(verify["unchanged"]!.GetValue<bool>(), verify.ToJsonString());
        await merchant.Post("/v1/accounting_periods", new { period = "2026-13" }, 400);
    }

    [Fact]
    public async Task Imports_preview_validates_rows_then_commit_creates_only_valid_ones()
    {
        var (merchant, _, _, _) = await Scenario.ApprovedMerchant(f, _http, "import@acme.test", "Import Co");
        await merchant.Post("/v1/customers", new { email = "existing@example.com" }, 201);
        const string csv = "email,name,country\r\nnew1@example.com,\"Doe, Jane\",US\r\nbad-email,No,US\r\nexisting@example.com,Ex,US\r\nnew2@example.com,Two,ZZ\r\nnew1@example.com,Dup,US\r\n";

        var preview = await merchant.Post("/v1/imports", new { type = "customers", format = "csv", content = csv, dry_run = true }, 201);
        Assert.Equal("previewed", preview["status"]!.GetValue<string>());
        Assert.Equal(5, preview["total"]!.GetValue<int>());
        Assert.Equal(1, preview["valid"]!.GetValue<int>());
        Assert.Equal(2, preview["invalid"]!.GetValue<int>());
        Assert.Equal(2, preview["duplicates"]!.GetValue<int>());
        Assert.False(f.WithDb(db => db.Customers.Any(c => c.Email == "new1@example.com")));

        var run = await merchant.Post("/v1/imports", new { type = "customers", format = "csv", content = csv, dry_run = false }, 201);
        Assert.Equal(1, run["imported"]!.GetValue<int>());
        Assert.Equal("Doe, Jane", f.WithDb(db => db.Customers.Single(c => c.Email == "new1@example.com").Name));

        var products = await merchant.Post("/v1/imports", new { type = "products", format = "json", dry_run = false,
            content = "[{\"name\":\"Team plan\",\"price_amount\":2900,\"currency\":\"usd\",\"interval\":\"month\"},{\"name\":\"Broken\",\"price_amount\":\"-5\"}]" }, 201);
        Assert.Equal(1, products["imported"]!.GetValue<int>());
        Assert.Equal(1, products["invalid"]!.GetValue<int>());
        Assert.True(f.WithDb(db => db.Prices.Any(p => p.UnitAmount == 2900 && p.Interval == "month" && p.Currency == "USD")));
        Assert.Equal(3, (await merchant.Get("/v1/imports"))["data"]!.AsArray().Count);
    }

    [Fact]
    public async Task Merging_customers_moves_history_and_credits_and_leaves_a_tombstone()
    {
        var (merchant, _, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "merge@acme.test", "Merge Co");
        await Scenario.Buy(merchant, priceId, country: "US", email: "dupe@example.com");
        var orgId = merchant.OrgId!;
        var source = f.WithDb(db => db.Customers.Single(c => c.OrgId == orgId && c.Email == "dupe@example.com").Id);
        var target = (await merchant.Post("/v1/customers", new { email = "real@example.com", name = "Real Person" }, 201))["id"]!.GetValue<string>();
        await merchant.Post("/v1/credits", new { customer = source, operation = "issue", amount = 250, idempotency_key = "m-grant" });
        await merchant.Post("/v1/credits", new { customer = target, operation = "issue", amount = 50, idempotency_key = "t-grant" });
        await merchant.Post("/v1/credits", new { customer = source, operation = "transfer_in", amount = 5 }, 400); // only merges move credits

        var dupes = await merchant.Get("/v1/customers/duplicates");
        Assert.NotNull(dupes["data"]);

        var merged = await merchant.Post($"/v1/customers/{source}/merge", new { into = target });
        Assert.Equal(1, merged["moved"]!["payments"]!.GetValue<int>());
        Assert.Equal(250, (await merchant.Get($"/v1/credits/{target}"))["available"]!.GetValue<long>() - 50);
        Assert.Equal(0, (await merchant.Get($"/v1/credits/{source}"))["available"]!.GetValue<long>());
        Assert.Equal(target, f.WithDb(db => db.Customers.Single(c => c.Id == source).MergedIntoId));
        Assert.True(f.WithDb(db => db.Payments.Any(p => p.CustomerId == target)));

        var list = (await merchant.Get("/v1/customers"))["data"]!.AsArray();
        Assert.DoesNotContain(list, c => c!["id"]!.GetValue<string>() == source);
        await merchant.Post($"/v1/customers/{source}/merge", new { into = target }, 409);
    }

    [Fact]
    public async Task Expiring_credits_are_spent_first_and_only_the_unused_part_expires()
    {
        var (merchant, _, _, _) = await Scenario.ApprovedMerchant(f, _http, "expire@acme.test", "Expire Co");
        var cus = (await merchant.Post("/v1/customers", new { email = "credits@example.com" }, 201))["id"]!.GetValue<string>();
        await merchant.Post("/v1/credits", new { customer = cus, operation = "issue", amount = 100, idempotency_key = "perm" });
        await merchant.Post("/v1/credits", new { customer = cus, operation = "issue", amount = 100, idempotency_key = "promo", expires_at = DateTime.UtcNow.AddMinutes(-1) });
        await merchant.Post("/v1/credits", new { customer = cus, operation = "consume", amount = 30, idempotency_key = "use" });
        await merchant.Post("/v1/credits", new { customer = cus, operation = "consume", amount = 5, expires_at = DateTime.UtcNow.AddDays(1) }, 400);

        await merchant.Post("/v1/test_helpers/run_jobs");
        var balance = await merchant.Get($"/v1/credits/{cus}");
        // The 30 came out of the expiring promo lot, so 70 expire and the permanent 100 remain.
        Assert.Equal(100, balance["available"]!.GetValue<long>());
        Assert.Contains(balance["entries"]!.AsArray(), e => e!["operation"]!.GetValue<string>() == "expire" && e["delta"]!.GetValue<long>() == -70);
        await merchant.Post("/v1/test_helpers/run_jobs");
        Assert.Equal(100, (await merchant.Get($"/v1/credits/{cus}"))["available"]!.GetValue<long>()); // idempotent
    }

    [Fact]
    public async Task Custom_domains_verify_by_dns_txt_and_are_unique()
    {
        var (merchant, _, _, _) = await Scenario.ApprovedMerchant(f, _http, "domain@acme.test", "Domain Co");
        var added = await merchant.Post("/v1/domains", new { hostname = "Pay.Acme-Shop.com.", purpose = "checkout" }, 201);
        var domain = added["domain"]!;
        Assert.Equal("pay.acme-shop.com", domain["hostname"]!.GetValue<string>());
        Assert.Equal("_paymentapp-challenge.pay.acme-shop.com", added["dns"]!.AsArray()[0]!["name"]!.GetValue<string>());
        await merchant.Post("/v1/domains", new { hostname = "not a host", purpose = "checkout" }, 400);

        var pending = await merchant.Post($"/v1/domains/{domain["id"]}/verify");
        Assert.Equal("PENDING", pending["domain"]!["status"]!.GetValue<string>());
        Assert.NotNull(pending["domain"]!["last_error"]);

        f.Dns.Txt["_paymentapp-challenge.pay.acme-shop.com"] = ["some-other-record", domain["verification_token"]!.GetValue<string>()];
        var verified = await merchant.Post($"/v1/domains/{domain["id"]}/verify");
        Assert.Equal("VERIFIED", verified["domain"]!["status"]!.GetValue<string>());

        var (other, _, _, _) = await Scenario.ApprovedMerchant(f, _http, "domain2@acme.test", "Domain Two");
        await other.Post("/v1/domains", new { hostname = "pay.acme-shop.com", purpose = "checkout" }, 409);
        await other.Post($"/v1/domains/{domain["id"]}/verify", null, 404);

        var (status, _, _) = await merchant.Send(HttpMethod.Delete, $"/v1/domains/{domain["id"]}");
        Assert.Equal(204, (int)status);
        Assert.Empty((await merchant.Get("/v1/domains"))["data"]!.AsArray());
    }

    [Fact]
    public async Task Support_tickets_keep_internal_notes_from_merchants()
    {
        var (merchant, admin, _, _) = await Scenario.ApprovedMerchant(f, _http, "support@acme.test", "Support Co");
        var ticket = await merchant.Post("/v1/support/tickets", new { subject = "Payout missing", category = "payment_issue", body = "Our payout didn't arrive." }, 201);
        await merchant.Post("/v1/support/tickets", new { subject = "x", category = "nonsense", body = "y" }, 400);

        var queue = (await admin.Get("/v1/admin/support/tickets?status=open"))["data"]!.AsArray();
        Assert.Contains(queue, t => t!["ticket"]!["id"]!.GetValue<string>() == ticket["id"]!.GetValue<string>());
        await admin.Post($"/v1/admin/support/tickets/{ticket["id"]}/messages", new { body = "Bank trace shows a return — check account.", @internal = true });
        await admin.Post($"/v1/admin/support/tickets/{ticket["id"]}/messages", new { body = "The bank returned it; please confirm your account number." });

        var mine = await merchant.Get($"/v1/support/tickets/{ticket["id"]}");
        Assert.Equal("awaiting_merchant", mine["ticket"]!["status"]!.GetValue<string>());
        var messages = mine["messages"]!.AsArray();
        Assert.Equal(2, messages.Count);
        Assert.DoesNotContain(messages, m => m!["body"]!.GetValue<string>().Contains("Bank trace"));
        Assert.Equal(3, (await admin.Get($"/v1/admin/support/tickets/{ticket["id"]}"))["messages"]!.AsArray().Count);
        Assert.True(f.WithDb(db => db.Notifications.Any(n => n.ObjectId == ticket["id"]!.GetValue<string>() && n.Template == "support_reply")));

        // Merchants only ever see their own tickets; merchants can't use the staff queue.
        var (other, _, _, _) = await Scenario.ApprovedMerchant(f, _http, "support2@acme.test", "Support Two");
        await other.Get($"/v1/support/tickets/{ticket["id"]}", 404);
        await merchant.Get("/v1/admin/support/tickets", 403);

        await merchant.Post($"/v1/support/tickets/{ticket["id"]}/close");
        await merchant.Post($"/v1/support/tickets/{ticket["id"]}/messages", new { body = "one more" }, 409);
    }

    [Fact]
    public async Task Incidents_show_on_public_status_and_merchant_banner_until_resolved()
    {
        var (merchant, admin, _, _) = await Scenario.ApprovedMerchant(f, _http, "incident@acme.test", "Incident Co");
        var anon = new Api(_http);
        Assert.Equal("operational", (await anon.Get("/v1/public/status"))["overall"]!.GetValue<string>());

        var incident = await admin.Post("/v1/admin/incidents", new { title = "Card payments degraded", severity = "major", affected_services = "checkout,payments", customer_impact = "Some card payments fail", message = "Investigating elevated declines." }, 201);
        await merchant.Post("/v1/admin/incidents", new { title = "x", severity = "major", affected_services = "", customer_impact = "", message = "" }, 403);
        var status = await anon.Get("/v1/public/status");
        Assert.Equal("degraded", status["overall"]!.GetValue<string>());
        Assert.Equal(["checkout", "payments"], status["incidents"]!.AsArray()[0]!["affected"]!.AsArray().Select(a => a!.GetValue<string>()));

        await admin.Post($"/v1/admin/incidents/{incident["id"]}/updates", new { status = "resolved", message = "Provider recovered." });
        Assert.Equal("operational", (await anon.Get("/v1/public/status"))["overall"]!.GetValue<string>());
        var banner = (await merchant.Get("/v1/incidents"))["data"]!.AsArray().Single()!;
        Assert.Equal(2, banner["updates"]!.AsArray().Count);
    }

    [Fact]
    public async Task Feature_flags_gate_features_by_org_allow_list_and_rollout()
    {
        var (merchant, admin, _, _) = await Scenario.ApprovedMerchant(f, _http, "flags@acme.test", "Flags Co");
        Assert.True((await merchant.Get("/v1/features"))["features"]!["marketplace"]!.GetValue<bool>());

        await admin.Put("/v1/admin/feature_flags/marketplace", new { enabled = true, rollout_percent = 0 });
        Assert.False((await merchant.Get("/v1/features"))["features"]!["marketplace"]!.GetValue<bool>());
        var denied = await merchant.Send(HttpMethod.Post, "/v1/sellers", new { name = "Nope", email = "n@x.example", country = "US", currency = "USD" });
        Assert.Equal(403, (int)denied.Status);
        Assert.Equal("feature_unavailable", denied.Body!["error"]!["code"]!.GetValue<string>());

        await admin.Put("/v1/admin/feature_flags/marketplace", new { org_ids = merchant.OrgId });
        await merchant.Post("/v1/sellers", new { name = "Allowed Seller", email = "a@x.example", country = "US", currency = "USD" }, 201);

        await admin.Put("/v1/admin/feature_flags/copilot", new { enabled = false });
        var copilot = await merchant.Send(HttpMethod.Post, "/v1/copilot/ask", new { question = "How much did I make?" });
        Assert.Equal(403, (int)copilot.Status);
        await merchant.Put("/v1/admin/feature_flags/copilot", new { enabled = true }, 403);
        await admin.Put("/v1/admin/feature_flags/Bad Key", new { enabled = true }, 400);
        Assert.True(f.WithDb(db => db.AuditLogs.Count(a => a.Action == "config.feature_flag") >= 3));

        await admin.Put("/v1/admin/feature_flags/marketplace", new { rollout_percent = 100, org_ids = "" });
        await admin.Put("/v1/admin/feature_flags/copilot", new { enabled = true });
    }
}
