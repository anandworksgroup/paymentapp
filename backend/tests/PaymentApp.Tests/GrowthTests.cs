using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using PaymentApp.Api.Common;
using PaymentApp.Api.Modules.Ledger;

namespace PaymentApp.Tests;

/// <summary>Files, affiliates, usage budgets, finance reports and privacy exports.</summary>
public class GrowthTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _http = f.CreateClient();

    private void AssertLedgerBalanced()
    {
        var json = JsonNode.Parse(Json.Serialize(f.WithDb(db => LedgerService.VerifyIntegrity(db).GetAwaiter().GetResult())))!;
        Assert.True(json["balanced"]!.GetValue<bool>(), json.ToJsonString());
    }

    private async Task<(int Status, JsonNode? Body)> Upload(Api api, string path, byte[] bytes, string name, string purpose)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, path);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", api.Token);
        if (api.OrgId != null) req.Headers.Add("X-Org-Id", api.OrgId);
        var form = new MultipartFormDataContent { { new ByteArrayContent(bytes), "file", name }, { new StringContent(purpose), "purpose" } };
        req.Content = form;
        var res = await _http.SendAsync(req);
        var text = await res.Content.ReadAsStringAsync();
        return ((int)res.StatusCode, text.StartsWith('{') ? JsonNode.Parse(text) : null);
    }

    [Fact]
    public async Task Files_are_type_checked_encrypted_and_served_by_signed_links()
    {
        var (merchant, admin, _, _) = await Scenario.ApprovedMerchant(f, _http, "files@acme.test", "Files Co");
        var pdf = Encoding.ASCII.GetBytes("%PDF-1.4\n% certificate of incorporation\n%%EOF\n");
        var (status, file) = await Upload(merchant, "/v1/files", pdf, "incorporation.pdf", "kyb_document");
        Assert.Equal(201, status);
        Assert.Equal("application/pdf", file!["content_type"]!.GetValue<string>());
        Assert.Equal("not_scanned", file["scan_status"]!.GetValue<string>());
        // Stored bytes on disk are ciphertext, not the document (§96, §198).
        var onDisk = f.WithDb(db => db.Files.First(x => x.Id == file["id"]!.GetValue<string>()).StoragePath);
        var stored = File.ReadAllBytes(Path.Combine(f.FilesPath, onDisk));
        Assert.DoesNotContain("PDF", Encoding.ASCII.GetString(stored));

        // Disguised or active content is refused regardless of the declared name.
        Assert.Equal(415, (await Upload(merchant, "/v1/files", Encoding.UTF8.GetBytes("<html><script>alert(1)</script></html>"), "doc.pdf", "kyb_document")).Status);
        Assert.Equal(415, (await Upload(merchant, "/v1/files", [0x4D, 0x5A, 0x90, 0x00, 0x03], "setup.pdf", "kyb_document")).Status);
        // A CSV ending in a newline (as spreadsheets export it) is still a CSV.
        var (csvStatus, csv) = await Upload(merchant, "/v1/files", Encoding.UTF8.GetBytes("name,amount\r\nfoo,1\r\nbar,2\r\n"), "export.csv", "kyb_document");
        Assert.Equal(201, csvStatus);
        Assert.Equal("text/csv", csv!["content_type"]!.GetValue<string>());

        var link = await merchant.Post($"/v1/files/{file["id"]}/link");
        var download = await _http.GetAsync(link["url"]!.GetValue<string>());
        Assert.Equal(pdf, await download.Content.ReadAsByteArrayAsync());
        Assert.Equal("nosniff", download.Headers.GetValues("X-Content-Type-Options").First());
        Assert.Equal(404, (int)(await _http.GetAsync(link["url"]!.GetValue<string>() + "x")).StatusCode);

        // Another merchant can't mint a link for it; staff access is logged.
        var (other, _, _, _) = await Scenario.ApprovedMerchant(f, _http, "files2@acme.test", "Files Two");
        await other.Post($"/v1/files/{file["id"]}/link", null, 404);
        await admin.Post($"/v1/admin/files/{file["id"]}/link");
        Assert.True(f.WithDb(db => db.DataAccessLogs.Any(l => l.ObjectId == file["id"]!.GetValue<string>() && l.Action == "download_link")));
    }

    [Fact]
    public async Task Affiliate_referral_earns_accrues_pays_and_reverses_on_refund()
    {
        var (merchant, _, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "aff@acme.test", "Aff Co");
        await merchant.Post("/v1/affiliates", new { name = "Pat Partner", email = "pat@partner.example", code = "pat20", commission_type = "percentage", rate_bps = 2000, duration = "recurring", hold_days = 0 }, 201);
        var link = await merchant.Post("/v1/payment_links", new { price_id = priceId }, 201);
        var buyer = new Api(_http);

        async Task<string> BuyViaReferral(string email)
        {
            var s = await buyer.Post($"/v1/public/links/{link["id"]}?ref=PAT20");
            var token = await Scenario.Card(merchant);
            var r = await buyer.Post($"/v1/public/checkout/{s["checkout_session"]}/confirm", new { email, country = "US", token, accept_terms = true });
            return r["payment"]!.GetValue<string>();
        }
        var p1 = await BuyViaReferral("ref1@example.com");
        var p2 = await BuyViaReferral("ref2@example.com");

        var affiliate = (await merchant.Get("/v1/affiliates"))["data"]!.AsArray().Single()!;
        var detail = await merchant.Get($"/v1/affiliates/{affiliate["id"]}");
        Assert.Equal(2, detail["clicks"]!.GetValue<int>());
        Assert.Equal(2, detail["referred_customers"]!.GetValue<int>());
        var commissions = detail["commissions"]!.AsArray();
        Assert.All(commissions, c => Assert.Equal(2000, c!["amount"]!.GetValue<long>())); // 20% of $100 (no US tax)

        await merchant.Post("/v1/test_helpers/run_jobs"); // hold period 0 → approved and accrued
        detail = await merchant.Get($"/v1/affiliates/{affiliate["id"]}");
        Assert.All(detail["commissions"]!.AsArray(), c => Assert.Equal("approved", c!["status"]!.GetValue<string>()));

        // A full refund reverses the unpaid commission for that payment.
        await Scenario.StepUp(merchant);
        await merchant.Post("/v1/refunds", new { payment = p2 }, 201);
        var reversed = (await merchant.Get($"/v1/affiliates/{affiliate["id"]}"))["commissions"]!.AsArray().First(c => c!["payment_id"]!.GetValue<string>() == p2)!;
        Assert.Equal("reversed", reversed["status"]!.GetValue<string>());

        var payout = await merchant.Post($"/v1/affiliates/{affiliate["id"]}/pay");
        Assert.Equal(2000, payout["totals"]!["USD"]!.GetValue<long>());
        Assert.Equal("paid", (await merchant.Get($"/v1/affiliates/{affiliate["id"]}"))["commissions"]!.AsArray().First(c => c!["payment_id"]!.GetValue<string>() == p1)!["status"]!.GetValue<string>());
        AssertLedgerBalanced();

        // The merchant's journal export stays balanced and includes the commission.
        var journal = await merchant.Get("/v1/reports/journal");
        Assert.True(journal["balanced"]!.GetValue<bool>());
        Assert.Contains(journal["lines"]!.AsArray(), l => l!["account"]!.GetValue<string>() == "Affiliate commissions");
    }

    [Fact]
    public async Task Hard_usage_budgets_reject_overage_and_soft_budgets_alert_once()
    {
        var (merchant, _, _, _) = await Scenario.ApprovedMerchant(f, _http, "budget@acme.test", "Budget Co");
        await merchant.Post("/v1/meters", new { event_name = "tokens", display_name = "AI tokens" }, 201);
        var cus = (await merchant.Post("/v1/customers", new { email = "ai@example.com" }, 201))["id"]!.GetValue<string>();
        await merchant.Post($"/v1/customers/{cus}/budgets", new { event_name = "tokens", monthly_limit = 1000, mode = "hard" }, 201);

        await merchant.Post("/v1/usage_events", new { customer = cus, event_name = "tokens", quantity = 600, idempotency_key = "t1" }, 201);
        var batch = await merchant.Post("/v1/usage_events/batch", new
        {
            events = new[]
            {
                new { customer = cus, event_name = "tokens", quantity = 300L, idempotency_key = "t2" },
                new { customer = cus, event_name = "tokens", quantity = 200L, idempotency_key = "t3" }, // would reach 1,100
            },
        });
        Assert.Equal(1, batch["accepted"]!.GetValue<int>());
        Assert.Equal(1, batch["rejected"]!.GetValue<int>());
        var single = await merchant.Send(HttpMethod.Post, "/v1/usage_events", new { customer = cus, event_name = "tokens", quantity = 101, idempotency_key = "t4" });
        Assert.Equal(402, (int)single.Status);
        Assert.Equal("usage_limit_exceeded", single.Body!["error"]!["code"]!.GetValue<string>());

        var status = (await merchant.Get($"/v1/customers/{cus}/budgets"))["data"]!.AsArray().Single()!;
        Assert.Equal(900, status["month_to_date"]!.GetValue<long>());
        var alerts = f.WithDb(db => db.Notifications.Where(n => n.ObjectId == cus && n.Template == "usage_threshold").Select(n => n.Subject).ToList());
        Assert.Equal(3, alerts.Count); // 50%, 75%, 90% — each exactly once
    }

    [Fact]
    public async Task Revenue_recognition_defers_annual_plans_and_exports_are_complete()
    {
        var (merchant, _, _, _) = await Scenario.ApprovedMerchant(f, _http, "revrec@acme.test", "RevRec Co");
        var product = await merchant.Post("/v1/products", new { name = "Annual" }, 201);
        var yearly = await merchant.Post("/v1/prices", new { product_id = product["id"]!.GetValue<string>(), currency = "USD", type = "recurring", interval = "year", unit_amount = 120000 }, 201);
        var (_, result) = await Scenario.Buy(merchant, yearly["id"]!.GetValue<string>(), mode: "subscription", country: "US", email: "annual@example.com");
        Assert.Equal("SUCCEEDED", result["payment_status"]!.GetValue<string>());

        var rr = await merchant.Get($"/v1/reports/revenue_recognition?month={DateTime.UtcNow:yyyy-MM}&currency=USD");
        var billed = rr["billings"]!.GetValue<long>();
        var recognized = rr["recognized_revenue"]!.GetValue<long>();
        var deferred = rr["deferred_revenue_end_of_month"]!.GetValue<long>();
        Assert.Equal(120000, billed);
        Assert.True(recognized > 0 && recognized < 120000 / 12 + 400, $"recognized {recognized}");
        Assert.Equal(120000, recognized + deferred);

        var cohorts = await merchant.Get("/v1/reports/cohorts");
        Assert.Equal(1, cohorts["cohorts"]![0]!["customers"]!.GetValue<int>());
        var churn = await merchant.Get("/v1/reports/churn");
        Assert.Equal(0, churn["cancelled"]!.GetValue<int>());

        var cus = f.WithDb(db => db.Customers.First(c => c.Email == "annual@example.com").Id);
        var export = await merchant.Get($"/v1/customers/{cus}/export");
        Assert.Single(export["subscriptions"]!.AsArray());
        Assert.Single(export["payments"]!.AsArray());
        Assert.True(f.WithDb(db => db.AuditLogs.Any(a => a.Action == "customer.export" && a.ObjectId == cus)));
        var me = await merchant.Get("/v1/me/export");
        Assert.Equal("revrec@acme.test", me["user"]!["email"]!.GetValue<string>());
        Assert.DoesNotContain("password", me.ToJsonString(), StringComparison.OrdinalIgnoreCase);
    }
}
