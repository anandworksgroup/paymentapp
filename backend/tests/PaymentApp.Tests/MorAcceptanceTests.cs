using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Endpoints;
using PaymentApp.Api.Modules.Ledger;

namespace PaymentApp.Tests;

/// <summary>
/// End-to-end acceptance for the Merchant of Record product (§151-§155, §340): real HTTP calls through
/// the whole stack, checking the ledger and audit invariants after every money movement.
/// </summary>
public class MorAcceptanceTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _http = f.CreateClient();

    private void AssertLedgerBalanced()
    {
        var result = f.WithDb(db => LedgerService.VerifyIntegrity(db).GetAwaiter().GetResult());
        var json = JsonNode.Parse(Json.Serialize(result))!;
        Assert.True(json["balanced"]!.GetValue<bool>(), "Ledger out of balance: " + json.ToJsonString());
    }

    [Fact]
    public async Task Checkout_payment_is_taxed_posted_webhooked_and_idempotent()
    {
        var (merchant, _, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "owner1@acme.test", "Acme One");
        var hook = await merchant.Post("/v1/webhook_endpoints", new { url = "http://localhost:9/hooks", enabled_events = "payment.*,refund.*" }, 201);
        var secret = hook["secret"]!.GetValue<string>();

        // Hosted page quote for India: GST 18% on $100.
        var session = await merchant.Post("/v1/checkout/sessions", new { mode = "payment", line_items = new[] { new { price_id = priceId, quantity = 1 } } }, 201);
        var sid = session["id"]!.GetValue<string>();
        var buyer = new Api(_http);
        var quote = await buyer.Post($"/v1/public/checkout/{sid}/quote", new { country = "IN" });
        Assert.Equal(1800, quote["tax"]!.GetValue<long>());
        Assert.Equal(11800, quote["total"]!.GetValue<long>());
        Assert.Contains("Merchant of Record", quote["seller_of_record"]!.GetValue<string>());

        var token = await Scenario.Card(merchant);
        var body = new { email = "Asha@Example.com", name = "Asha", country = "IN", token, accept_terms = true };
        var first = await buyer.Post($"/v1/public/checkout/{sid}/confirm", body, 200, "confirm-1");
        Assert.Equal("SUCCEEDED", first["payment_status"]!.GetValue<string>());
        var paymentId = first["payment"]!.GetValue<string>();

        // Duplicate callback / retried request: same result, no second payment (§151).
        var (_, replay, raw) = await buyer.Send(HttpMethod.Post, $"/v1/public/checkout/{sid}/confirm", body, "confirm-1");
        Assert.Equal(paymentId, replay!["payment"]!.GetValue<string>());
        Assert.Equal("true", raw.Headers.GetValues("Idempotent-Replayed").First());
        var again = await buyer.Post($"/v1/public/checkout/{sid}/confirm", body);
        Assert.Equal(paymentId, again["payment"]!.GetValue<string>());
        Assert.Equal(1, f.WithDb(db => db.Payments.Count(p => p.CheckoutSessionId == sid)));

        var detail = await merchant.Get($"/v1/payments/{paymentId}");
        var p = detail["payment"]!;
        Assert.Equal(11800, p["amount"]!.GetValue<long>());
        Assert.Equal(1800, p["tax_amount"]!.GetValue<long>());
        // 3.5% + $0.30 + 1.5% international on $118 = 413 + 30 + 177
        Assert.Equal(620, p["fee_amount"]!.GetValue<long>());
        Assert.Equal(11800 - 1800 - 620, p["net_amount"]!.GetValue<long>());
        Assert.NotEmpty(detail["ledger"]!.AsArray());
        Assert.Equal("paid", detail["order"]!["status"]!.GetValue<string>());
        Assert.Equal("terms@v1", detail["order"]!["accepted_terms_version"]!.GetValue<string>());
        Assert.Equal(1, f.WithDb(db => db.TaxRecords.Count(t => t.OrderId == detail["order"]!["id"]!.GetValue<string>() && t.TaxAmount == 1800 && t.Country == "IN")));
        Assert.Equal(1, f.WithDb(db => db.Entitlements.Count(e => e.CustomerId == p["customer_id"]!.GetValue<string>())));
        AssertLedgerBalanced();

        // Outbox → signed webhook (§56, §57).
        await merchant.Post("/v1/test_helpers/run_jobs");
        var delivered = f.Webhooks.Requests.Where(r => r.Body.Contains(paymentId) && r.Body.Contains("\"payment.succeeded\"")).ToList();
        Assert.Single(delivered);
        var sig = delivered[0].Headers["Webhook-Signature"];
        var ts = delivered[0].Headers["Webhook-Timestamp"];
        Assert.Equal(PaymentApp.Api.Modules.Platform.WebhookSender.Sign(secret, long.Parse(ts), delivered[0].Body), sig);
        Assert.DoesNotContain(f.Webhooks.Requests, r => r.Body.Contains("\"customer.created\"")); // filtered out by enabled_events

        // Receipt notification to the buyer (dev email outbox).
        Assert.True(f.WithDb(db => db.Notifications.Any(n => n.Template == "receipt" && n.Recipient == "asha@example.com")));
    }

    [Fact]
    public async Task Refunds_are_partial_multiple_and_cannot_exceed_captured()
    {
        var (merchant, _, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "owner2@acme.test", "Acme Two");
        var (_, result) = await Scenario.Buy(merchant, priceId, country: "DE");
        var paymentId = result["payment"]!.GetValue<string>();
        await Scenario.StepUp(merchant);

        var r1 = await merchant.Post("/v1/refunds", new { payment = paymentId, amount = 3000, reason = "requested_by_customer" }, 201);
        Assert.Equal("SUCCEEDED", r1["status"]!.GetValue<string>());
        Assert.Equal(479, r1["tax_amount"]!.GetValue<long>()); // pro-rata of 1900 on 11900
        await merchant.Post("/v1/refunds", new { payment = paymentId, amount = 9000 }, 409);   // would exceed remaining 8900
        var r2 = await merchant.Post("/v1/refunds", new { payment = paymentId }, 201);        // remainder
        Assert.Equal(8900, r2["amount"]!.GetValue<long>());
        Assert.Equal(1900 - 479, r2["tax_amount"]!.GetValue<long>()); // final refund takes exact remaining tax

        var payment = (await merchant.Get($"/v1/payments/{paymentId}"))["payment"]!;
        Assert.Equal("REFUNDED", payment["status"]!.GetValue<string>());
        Assert.Equal(11900, payment["amount_refunded"]!.GetValue<long>());
        await merchant.Post("/v1/refunds", new { payment = paymentId, amount = 1 }, 409);
        // Tax records net to zero for the fully refunded sale.
        Assert.Equal(0, f.WithDb(db => db.TaxRecords.Where(t => t.OrgId == merchant.OrgId).Sum(t => t.TaxAmount)));
        AssertLedgerBalanced();
    }

    [Fact]
    public async Task Declines_3ds_failover_and_async_upi_follow_the_state_machine()
    {
        var (merchant, admin, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "owner3@acme.test", "Acme Three");

        var (_, declined) = await Scenario.Buy(merchant, priceId, card: "4000000000009995", email: "d1@example.com");
        Assert.Equal("FAILED", declined["payment_status"]!.GetValue<string>());
        Assert.Equal("insufficient_funds", declined["failure_code"]!.GetValue<string>());
        Assert.NotNull(declined["suggested_action"]);

        var (sid, challenged) = await Scenario.Buy(merchant, priceId, card: "4000002500003155", email: "d2@example.com");
        Assert.Equal("REQUIRES_ACTION", challenged["payment_status"]!.GetValue<string>());
        var authenticated = await new Api(_http).Post($"/v1/public/checkout/{sid}/authenticate", new { result = "pass" });
        Assert.Equal("SUCCEEDED", authenticated["payment_status"]!.GetValue<string>());
        Assert.Equal("authenticated", f.WithDb(db => db.Payments.First(p => p.CheckoutSessionId == sid).ThreeDsResult));

        // Provider outage: router fails over to the secondary provider (§18).
        await admin.Patch("/v1/admin/providers/sim_alpha", new { force_outage = true });
        try
        {
            var (fsid, ok) = await Scenario.Buy(merchant, priceId, email: "d3@example.com");
            Assert.Equal("SUCCEEDED", ok["payment_status"]!.GetValue<string>());
            var attempts = f.WithDb(db => db.PaymentAttempts.Where(a => a.PaymentId == ok["payment"]!.GetValue<string>()).OrderBy(a => a.CreatedAt).Select(a => new { a.ProviderId, a.Status }).ToList());
            Assert.Equal(("sim_alpha", "FAILED"), (attempts[0].ProviderId, attempts[0].Status));
            Assert.Equal(("sim_beta", "SUCCEEDED"), (attempts[1].ProviderId, attempts[1].Status));
            _ = fsid;
        }
        finally { await admin.Patch("/v1/admin/providers/sim_alpha", new { force_outage = false }); }

        // UPI pending → provider webhook completes it later.
        var session = await merchant.Post("/v1/checkout/sessions", new { mode = "payment", line_items = new[] { new { price_id = priceId, quantity = 1 } } }, 201);
        var upi = await new Api(_http).Post("/v1/public/sim/tokens", new { type = "upi", vpa = "pending@upi" });
        var pending = await new Api(_http).Post($"/v1/public/checkout/{session["id"]}/confirm", new { email = "u@example.in", country = "IN", token = upi["id"]!.GetValue<string>(), accept_terms = true });
        Assert.Equal("PROCESSING", pending["payment_status"]!.GetValue<string>());
        var done = await merchant.Post($"/v1/test_helpers/payments/{pending["payment"]}/complete_async", new { outcome = "succeeded" });
        Assert.Equal("SUCCEEDED", done["status"]!.GetValue<string>());
        Assert.Equal("sim_beta", done["provider_id"]!.GetValue<string>()); // IN + UPI routing rule
        AssertLedgerBalanced();
    }

    [Fact]
    public async Task Dispute_lost_then_payout_reconciles_to_ledger()
    {
        var (merchant, admin, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "owner4@acme.test", "Acme Four");
        var (_, good) = await Scenario.Buy(merchant, priceId, country: "US", email: "g@example.com");
        var (_, disputed) = await Scenario.Buy(merchant, priceId, card: "4000000000000259", country: "US", email: "chargeback@example.com");
        var disputedId = disputed["payment"]!.GetValue<string>();
        var dispute = (await merchant.Get("/v1/disputes"))["data"]!.AsArray().Single();
        Assert.Equal(disputedId, dispute!["payment_id"]!.GetValue<string>());
        Assert.Equal("DISPUTED", (await merchant.Get($"/v1/payments/{disputedId}"))["payment"]!["status"]!.GetValue<string>());

        var evidence = await merchant.Get($"/v1/disputes/{dispute["id"]}");
        Assert.Equal("terms@v1", evidence["suggested_evidence"]!["terms_accepted"]!.GetValue<string>());
        await merchant.Post($"/v1/disputes/{dispute["id"]}/evidence", new { evidence = new[] { new { type = "customer_communication", text = "Customer confirmed receipt" } }, submit = true });
        var closed = await merchant.Post($"/v1/test_helpers/disputes/{dispute["id"]}/close", new { outcome = "lost" });
        Assert.Equal("lost", closed["status"]!.GetValue<string>());
        Assert.Equal("CHARGEBACK", (await merchant.Get($"/v1/payments/{disputedId}"))["payment"]!["status"]!.GetValue<string>());

        await merchant.Post("/v1/test_helpers/balance/settle_now");
        var balance = await merchant.Get("/v1/balance");
        var usd = balance["balances"]!.AsArray().First(b => b!["currency"]!.GetValue<string>() == "USD")!;
        // Two $100 sales (no US tax configured), fees 380 each, one chargeback of $100 + $15 fee.
        Assert.Equal(2 * (10000 - 380) - 10000 - 1500, usd["available"]!.GetValue<long>());
        Assert.Equal(0, usd["pending"]!.GetValue<long>());

        await Scenario.StepUp(merchant);
        await merchant.Post("/v1/payout_destinations", new { country = "US", currency = "USD", account_holder = "Acme Four Inc", bank_name = "Test Bank", account_number = "000123456789", routing_number = "110000000" });
        var payout = await merchant.Post("/v1/payouts", new { currency = "USD" }, 201);
        Assert.Equal(usd["available"]!.GetValue<long>(), payout["amount"]!.GetValue<long>());
        var breakdown = payout["breakdown"]!;
        Assert.Equal(20000, breakdown["gross_collected"]!.GetValue<long>());
        await merchant.Post("/v1/test_helpers/run_jobs"); // PENDING → PROCESSING
        await merchant.Post("/v1/test_helpers/run_jobs"); // PROCESSING → PAID
        Assert.Equal("PAID", (await merchant.Get($"/v1/payouts/{payout["id"]}"))["payout"]!["status"]!.GetValue<string>());
        var after = (await merchant.Get("/v1/balance"))["balances"]!.AsArray().First(b => b!["currency"]!.GetValue<string>() == "USD")!;
        Assert.Equal(0, after["available"]!.GetValue<long>());

        // Statement: opening + movements = closing (§165).
        var stmt = await merchant.Get($"/v1/statements?month={DateTime.UtcNow:yyyy-MM}&currency=USD");
        Assert.True(stmt["reconciles"]!.GetValue<bool>(), stmt.ToJsonString());
        AssertLedgerBalanced();

        // Reconciliation matches provider records; a tampered provider amount is detected (§155).
        var run = await admin.Post("/v1/admin/reconciliation/run");
        Assert.Equal(0, run["exceptions"]!.GetValue<int>());
        f.WithDb(db =>
        {
            var rec = db.SimProviderRecords.First(r => r.InternalReference != null && db.PaymentAttempts.Any(a => a.Id == r.InternalReference && a.PaymentId == good["payment"]!.GetValue<string>()));
            rec.Amount += 1;
            return db.SaveChanges();
        });
        var run2 = await admin.Post("/v1/admin/reconciliation/run");
        Assert.Equal(1, run2["exceptions"]!.GetValue<int>());
        var exc = (await admin.Get("/v1/admin/reconciliation/exceptions?status=open"))["data"]!.AsArray();
        Assert.Contains(exc, e => e!["type"]!.GetValue<string>() == "amount_mismatch");
    }

    [Fact]
    public async Task Failed_payout_returns_funds_to_balance()
    {
        var (merchant, _, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "owner5@acme.test", "Acme Five");
        await Scenario.Buy(merchant, priceId, country: "US", email: "p@example.com");
        await merchant.Post("/v1/test_helpers/balance/settle_now");
        await Scenario.StepUp(merchant);
        await merchant.Post("/v1/payout_destinations", new { country = "US", currency = "USD", account_holder = "Acme", bank_name = "Closed Bank", account_number = "999990000", routing_number = "110000000" });
        var payout = await merchant.Post("/v1/payouts", new { currency = "USD" }, 201);
        await merchant.Post("/v1/test_helpers/run_jobs");
        await merchant.Post("/v1/test_helpers/run_jobs");
        var p = (await merchant.Get($"/v1/payouts/{payout["id"]}"))["payout"]!;
        Assert.Equal("FAILED", p["status"]!.GetValue<string>());
        var usd = (await merchant.Get("/v1/balance"))["balances"]!.AsArray().First(b => b!["currency"]!.GetValue<string>() == "USD")!;
        Assert.Equal(payout["amount"]!.GetValue<long>(), usd["available"]!.GetValue<long>());
        AssertLedgerBalanced();
    }

    [Fact]
    public async Task Tenants_are_isolated_server_side()
    {
        var (a, _, _, priceA) = await Scenario.ApprovedMerchant(f, _http, "iso-a@acme.test", "Iso A");
        var (b, _, _, _) = await Scenario.ApprovedMerchant(f, _http, "iso-b@acme.test", "Iso B");
        var (_, paid) = await Scenario.Buy(a, priceA, email: "iso@example.com");
        var paymentId = paid["payment"]!.GetValue<string>();
        await b.Get($"/v1/payments/{paymentId}", 404);
        Assert.Empty((await b.Get("/v1/payments"))["data"]!.AsArray());
        // Borrowing another org's id in the header is refused.
        var spoof = b.Clone();
        spoof.OrgId = a.OrgId;
        await spoof.Get("/v1/payments", 403);
        // Test-mode data is invisible in live mode, and live mode is locked until go-live.
        var live = a.Clone();
        live.Live = true;
        await live.Get("/v1/payments", 403);
    }

    [Fact]
    public async Task Api_keys_restricted_keys_and_idempotency_key_reuse()
    {
        var (merchant, _, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "keys@acme.test", "Keys Co");
        var key = await merchant.Post("/v1/api_keys", new { name = "server", type = "secret" }, 201);
        var restricted = await merchant.Post("/v1/api_keys", new { name = "reporting", type = "restricted", permissions = new[] { "payments.read" } }, 201);
        var sk = new Api(_http) { ApiKey = key["secret"]!.GetValue<string>() };
        var rk = new Api(_http) { ApiKey = restricted["secret"]!.GetValue<string>() };
        Assert.StartsWith("sk_test_", sk.ApiKey);
        await sk.Post("/v1/customers", new { email = "k@example.com" }, 201, "cust-1");
        await sk.Post("/v1/customers", new { email = "k@example.com" }, 201, "cust-1");            // replay
        await sk.Post("/v1/customers", new { email = "other@example.com" }, 422, "cust-1");        // same key, different body
        Assert.Equal(1, f.WithDb(db => db.Customers.Count(c => c.Email == "k@example.com")));
        await rk.Get("/v1/payments");
        await rk.Post("/v1/customers", new { email = "nope@example.com" }, 403);
        var revoked = await merchant.Send(HttpMethod.Delete, $"/v1/api_keys/{restricted["api_key"]!["id"]}");
        Assert.Equal(204, (int)revoked.Status);
        await rk.Get("/v1/payments", 401);
        _ = priceId;
    }

    [Fact]
    public async Task Financial_history_is_append_only_and_audit_chain_verifies()
    {
        var (merchant, admin, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "audit@acme.test", "Audit Co");
        await Scenario.Buy(merchant, priceId, email: "audit-buyer@example.com");
        var ex = Assert.ThrowsAny<Exception>(() => f.WithDb(db => db.Database.ExecuteSqlRaw("UPDATE ledger_entries SET amount = amount + 1")));
        Assert.Contains("append-only", ex.Message);
        Assert.ThrowsAny<Exception>(() => f.WithDb(db => db.Database.ExecuteSqlRaw("DELETE FROM audit_logs")));
        var integrity = await admin.Get("/v1/admin/ledger/integrity");
        Assert.True(integrity["ledger"]!["balanced"]!.GetValue<bool>());
        Assert.True(integrity["audit_chain"]!["valid"]!.GetValue<bool>());
        Assert.True(integrity["audit_chain"]!["rows_checked"]!.GetValue<long>() > 5);
    }

    [Fact]
    public async Task Coupons_and_promotions_apply_atomically()
    {
        var (merchant, _, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "promo@acme.test", "Promo Co");
        await merchant.Post("/v1/coupons", new { code = "launch20", percent_off_bps = 2000, max_redemptions = 1 }, 201);
        await merchant.Post("/v1/coupons", new { code = "INDIA25", percent_off_bps = 2500, countries = "IN", auto_apply = true }, 201);
        var (_, first) = await Scenario.Buy(merchant, priceId, country: "US", email: "c1@example.com", coupon: "LAUNCH20");
        var pay = (await merchant.Get($"/v1/payments/{first["payment"]}"))["payment"]!;
        Assert.Equal(8000, pay["amount"]!.GetValue<long>());
        // Max redemptions reached: the next buyer is refused at quote time.
        var session = await merchant.Post("/v1/checkout/sessions", new { mode = "payment", line_items = new[] { new { price_id = priceId, quantity = 1 } } }, 201);
        await new Api(_http).Post($"/v1/public/checkout/{session["id"]}/quote", new { country = "US", coupon = "LAUNCH20" }, 400);
        // Auto-applied promotion for India (25% off $100, then 18% GST on $75).
        var quote = await new Api(_http).Post($"/v1/public/checkout/{session["id"]}/quote", new { country = "IN" });
        Assert.Equal(2500, quote["discount"]!.GetValue<long>());
        Assert.Equal(1350, quote["tax"]!.GetValue<long>());
        Assert.Equal(8850, quote["total"]!.GetValue<long>());
    }

    [Fact]
    public async Task Go_live_requires_checklist_and_step_up()
    {
        var (merchant, _, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "golive@acme.test", "GoLive Co");
        await merchant.Post("/v1/organization/go_live", null, 403); // step-up required
        await Scenario.StepUp(merchant);
        await merchant.Post("/v1/organization/go_live", null, 400); // checklist incomplete
        await merchant.Post("/v1/payout_destinations", new { country = "US", currency = "USD", account_holder = "GoLive", bank_name = "B", account_number = "12345678", routing_number = "1" });
        await merchant.Post("/v1/payment_links", new { price_id = priceId }, 201);
        await Scenario.Buy(merchant, priceId, email: "gl@example.com");
        var org = await merchant.Post("/v1/organization/go_live");
        Assert.Equal("PRODUCTION", org["go_live_state"]!.GetValue<string>());
        var live = merchant.Clone();
        live.Live = true;
        Assert.Empty((await live.Get("/v1/payments"))["data"]!.AsArray());
    }

    [Fact]
    public async Task Invoice_pdf_is_deterministic()
    {
        var (merchant, _, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "pdf@acme.test", "Pdf Co");
        var customer = await merchant.Post("/v1/customers", new { email = "cfo@bigco.example", name = "BigCo", country = "DE", tax_id = "DE123456789", customer_type = "b2b" }, 201);
        var inv = await merchant.Post("/v1/invoices", new { customer = customer["id"]!.GetValue<string>(), currency = "USD", days_until_due = 30, purchase_order = "PO-77", lines = new[] { new { price_id = priceId, quantity = 3 } } }, 201);
        Assert.Equal(0, inv["tax"]!.GetValue<long>()); // B2B reverse charge in DE
        Assert.Equal("OPEN", inv["status"]!.GetValue<string>());
        var a = await _http.SendAsync(Req(merchant, $"/v1/invoices/{inv["id"]}/pdf"));
        var b = await _http.SendAsync(Req(merchant, $"/v1/invoices/{inv["id"]}/pdf"));
        var bytesA = await a.Content.ReadAsByteArrayAsync();
        Assert.StartsWith("%PDF-1.4", System.Text.Encoding.ASCII.GetString(bytesA[..8]));
        Assert.Equal(bytesA, await b.Content.ReadAsByteArrayAsync());

        // Net-terms reminder three days before the due date (§255), sent once.
        var soon = await merchant.Post("/v1/invoices", new { customer = customer["id"]!.GetValue<string>(), currency = "USD", days_until_due = 3, lines = new[] { new { description = "Consulting", quantity = 1, unit_amount = 50000 } } }, 201);
        await merchant.Post("/v1/test_helpers/run_jobs");
        await merchant.Post("/v1/test_helpers/run_jobs");
        Assert.Equal(1, f.WithDb(db => db.Notifications.Count(n => n.ObjectId == soon["id"]!.GetValue<string>() && n.Template == "invoice_due_soon")));
    }

    private static HttpRequestMessage Req(Api api, string path)
    {
        var r = new HttpRequestMessage(HttpMethod.Get, path);
        r.Headers.Authorization = new("Bearer", api.Token);
        r.Headers.Add("X-Org-Id", api.OrgId);
        return r;
    }

    [Fact]
    public async Task Concurrent_confirms_on_one_session_charge_at_most_once()
    {
        var (merchant, _, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "race@acme.test", "Race Co");
        var session = await merchant.Post("/v1/checkout/sessions", new { mode = "payment", line_items = new[] { new { price_id = priceId, quantity = 1 } } }, 201);
        var sid = session["id"]!.GetValue<string>();
        var tokens = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => Scenario.Card(merchant)));
        var buyer = new Api(_http);
        var results = await Task.WhenAll(tokens.Select((t, i) => buyer.Send(HttpMethod.Post, $"/v1/public/checkout/{sid}/confirm",
            new { email = "race@example.com", country = "US", token = t, accept_terms = true }, $"race-{i}")));
        Assert.All(results, r => Assert.True((int)r.Status is 200 or 409, r.Body?.ToJsonString()));
        Assert.Equal(1, f.WithDb(db => db.Payments.Count(p => p.CheckoutSessionId == sid && p.AmountCaptured > 0)));
    }

    [Fact]
    public async Task A_retry_after_an_abandoned_3ds_challenge_cancels_the_stale_payment()
    {
        var (merchant, _, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "3ds@acme.test", "Challenge Co");
        var (sid, first) = await Scenario.Buy(merchant, priceId, card: "4000002500003155", email: "3ds@example.com");
        Assert.Equal("REQUIRES_ACTION", first["payment_status"]!.GetValue<string>());
        var buyer = new Api(_http);
        var second = await buyer.Post($"/v1/public/checkout/{sid}/confirm", new { email = "3ds@example.com", country = "US", token = await Scenario.Card(merchant), accept_terms = true });
        Assert.Equal("SUCCEEDED", second["payment_status"]!.GetValue<string>());
        Assert.Equal("CANCELLED", f.WithDb(db => db.Payments.First(p => p.Id == first["payment"]!.GetValue<string>()).Status));
        Assert.Equal(1, f.WithDb(db => db.Payments.Count(p => p.CheckoutSessionId == sid && p.AmountCaptured > 0)));
    }
}
