using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Modules.Ledger;

namespace PaymentApp.Tests;

/// <summary>Risk rules, digital delivery, exports, retention, roles/SCIM, passwordless sign-in, impossible travel, bank reconciliation, payment requests.</summary>
public class TrustTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _http = f.CreateClient();

    private void AssertLedgerBalanced()
    {
        var json = JsonNode.Parse(Json.Serialize(f.WithDb(db => LedgerService.VerifyIntegrity(db).GetAwaiter().GetResult())))!;
        Assert.True(json["balanced"]!.GetValue<bool>(), json.ToJsonString());
    }

    private string LastEmail(string recipient, string template) =>
        f.WithDb(db => db.Notifications.Where(n => n.Recipient == recipient && n.Template == template).OrderByDescending(n => n.CreatedAt).First().Body);

    private async Task<JsonNode> Confirm(Api merchant, string sessionId, string email, string card = "4242424242424242")
    {
        var token = await Scenario.Card(merchant, card);
        var (status, body, _) = await new Api(_http).Send(HttpMethod.Post, $"/v1/public/checkout/{sessionId}/confirm", new { email, name = "Bea Buyer", country = "US", token, accept_terms = true });
        Assert.True((int)status is 200 or 402, body?.ToJsonString());
        return body!;
    }

    [Fact]
    public async Task Merchant_rules_block_or_review_payments_and_can_be_backtested()
    {
        var (merchant, _, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "rules@acme.test", "Rules Co");
        await Scenario.Buy(merchant, priceId, country: "US", email: "early@blocked.example");
        await merchant.Post("/v1/risk/rules", new { name = "Bad", field = "amount_usd", @operator = "contains", value = "5", action = "block" }, 400);
        await merchant.Post("/v1/risk/rules", new { name = "Bad", field = "risk_score", @operator = "gt", value = "high", action = "block" }, 400);

        // Backtest before switching it on: one earlier payment would have matched.
        var test = await merchant.Post("/v1/risk/rules/test", new { field = "email_domain", @operator = "eq", value = "blocked.example", action = "block" });
        Assert.Equal(1, test["matched"]!.GetValue<int>());

        var block = await merchant.Post("/v1/risk/rules", new { name = "Block test domain", field = "email_domain", @operator = "in", value = "blocked.example, other.example", action = "block", priority = 10 }, 201);
        await merchant.Post("/v1/risk/rules", new { name = "Review big orders", field = "amount_usd", @operator = "gte", value = "5000", action = "review", priority = 20 }, 201);

        var session = await merchant.Post("/v1/checkout/sessions", new { mode = "payment", line_items = new[] { new { price_id = priceId, quantity = 1 } } }, 201);
        await Confirm(merchant, session["id"]!.GetValue<string>(), "second@blocked.example");
        var blocked = f.WithDb(db => db.Payments.Single(p => p.CustomerEmail == "second@blocked.example"));
        Assert.Equal("DECLINE", blocked.RiskAction);
        Assert.Equal("FAILED", blocked.Status);
        Assert.Equal(block["id"]!.GetValue<string>(), blocked.RiskRuleId);
        Assert.Contains("Block test domain", blocked.RiskReasonsJson);

        await Scenario.Buy(merchant, priceId, country: "US", email: "normal@example.com");
        var reviewed = f.WithDb(db => db.Payments.Single(p => p.CustomerEmail == "normal@example.com"));
        Assert.Equal("REVIEW", reviewed.RiskAction); // $100 ≥ $50 threshold
        Assert.Equal("pending", reviewed.ReviewStatus);

        var rules = (await merchant.Get("/v1/risk/rules"))["data"]!.AsArray();
        Assert.Equal(1, rules.Single(r => r!["id"]!.GetValue<string>() == block["id"]!.GetValue<string>())!["hits"]!.GetValue<long>());
        Assert.Equal(204, (int)(await merchant.Send(HttpMethod.Delete, $"/v1/risk/rules/{block["id"]}")).Status);
    }

    [Fact]
    public async Task Digital_goods_are_delivered_by_limited_links_that_end_on_refund()
    {
        var (merchant, _, productId, priceId) = await Scenario.ApprovedMerchant(f, _http, "delivery@acme.test", "Delivery Co");
        var zip = new byte[] { 0x50, 0x4B, 0x03, 0x04 }.Concat(Encoding.ASCII.GetBytes("templates bundle v1")).ToArray();
        var req = new HttpRequestMessage(HttpMethod.Post, "/v1/files");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", merchant.Token);
        req.Headers.Add("X-Org-Id", merchant.OrgId);
        req.Content = new MultipartFormDataContent { { new ByteArrayContent(zip), "file", "bundle.zip" }, { new StringContent("product_asset"), "purpose" } };
        var upload = JsonNode.Parse(await (await _http.SendAsync(req)).Content.ReadAsStringAsync())!;
        Assert.Equal("application/zip", upload["content_type"]!.GetValue<string>());

        await merchant.Post($"/v1/products/{productId}/assets", new { file_id = upload["id"]!.GetValue<string>(), name = "Template bundle", max_downloads = 2, link_days = 30 }, 201);
        var (_, result) = await Scenario.Buy(merchant, priceId, country: "US", email: "reader@example.com");
        var email = LastEmail("reader@example.com", "download_ready");
        var token = Regex.Match(email, @"/v1/public/downloads/(dl_[A-Za-z0-9_\-]+)").Groups[1].Value;
        Assert.NotEmpty(token);
        Assert.False(f.WithDb(db => db.DownloadGrants.Any(g => g.TokenHash == token))); // only the hash is stored

        for (var i = 0; i < 2; i++)
        {
            var ok = await _http.GetAsync($"/v1/public/downloads/{token}");
            Assert.Equal(200, (int)ok.StatusCode);
            Assert.Equal(zip, await ok.Content.ReadAsByteArrayAsync());
        }
        Assert.Equal(410, (int)(await _http.GetAsync($"/v1/public/downloads/{token}")).StatusCode);

        // Support can raise the limit and send a fresh link; the old one stops working.
        var customer = f.WithDb(db => db.Customers.Single(c => c.Email == "reader@example.com" && c.OrgId == merchant.OrgId).Id);
        var grant = (await merchant.Get($"/v1/customers/{customer}/downloads"))["data"]!.AsArray().Single()!;
        await merchant.Post($"/v1/download_grants/{grant["id"]}/reset", new { max_downloads = 5, reason = "Customer lost the file" });
        var fresh = (await merchant.Post($"/v1/download_grants/{grant["id"]}/link"))["url"]!.GetValue<string>();
        Assert.Equal(404, (int)(await _http.GetAsync($"/v1/public/downloads/{token}")).StatusCode);
        Assert.Equal(200, (int)(await _http.GetAsync(new Uri(fresh).PathAndQuery)).StatusCode);

        // A refund revokes the entitlement, and with it the download.
        await Scenario.StepUp(merchant);
        await merchant.Post("/v1/refunds", new { payment = result["payment"]!.GetValue<string>() }, 201);
        await merchant.Post("/v1/test_helpers/run_jobs");
        Assert.Equal(403, (int)(await _http.GetAsync(new Uri(fresh).PathAndQuery)).StatusCode);
    }

    [Fact]
    public async Task Exports_run_in_the_background_and_download_by_signed_link()
    {
        var (merchant, _, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "export@acme.test", "Export Co");
        var (_, sale) = await Scenario.Buy(merchant, priceId, country: "US", email: "exported@example.com");
        await merchant.Post("/v1/exports", new { type = "payments", format = "csv" }, 202);
        var job = await merchant.Post("/v1/exports", new { type = "customers", format = "json" }, 202);
        await merchant.Post("/v1/exports", new { type = "secrets" }, 400);
        Assert.Equal("queued", job["status"]!.GetValue<string>());
        await merchant.Post($"/v1/exports/{job["id"]}/link", null, 409);

        await merchant.Post("/v1/test_helpers/run_jobs");
        var list = (await merchant.Get("/v1/exports"))["data"]!.AsArray();
        Assert.All(list, e => Assert.Equal("completed", e!["status"]!.GetValue<string>()));
        var payments = list.Single(e => e!["type"]!.GetValue<string>() == "payments")!;
        var link = await merchant.Post($"/v1/exports/{payments["id"]}/link");
        var csv = await (await _http.GetAsync(link["url"]!.GetValue<string>())).Content.ReadAsStringAsync();
        Assert.StartsWith("id,created_at,status", csv);
        Assert.Contains(sale["payment"]!.GetValue<string>(), csv);
        // Export files hold customer data: they're not in the general file list.
        Assert.Empty((await merchant.Get("/v1/files?purpose=export"))["data"]!.AsArray());
        Assert.True(f.WithDb(db => db.Notifications.Any(n => n.Template == "export_ready" && n.OrgId == merchant.OrgId)));
    }

    [Fact]
    public async Task Retention_purges_old_operational_data_but_respects_floors_and_legal_holds()
    {
        var (merchant, admin, _, _) = await Scenario.ApprovedMerchant(f, _http, "retain@acme.test", "Retain Co");
        var (held, _, _, _) = await Scenario.ApprovedMerchant(f, _http, "held@acme.test", "Held Co");
        await admin.Put("/v1/admin/retention/api_request_logs", new { days = 10, reason = "shorter" }, 400);   // below the 30-day floor
        await admin.Put("/v1/admin/retention/api_request_logs", new { days = 60 }, 400);                      // reason required
        await admin.Put("/v1/admin/retention/api_request_logs", new { days = 60, reason = "Storage review" });
        await merchant.Put("/v1/admin/retention/api_request_logs", new { days = 60, reason = "x" }, 403);

        var old = DateTime.UtcNow.AddDays(-120);
        f.WithDb(db =>
        {
            db.ApiRequestLogs.Add(new ApiRequestLog { RequestId = "req_old_a", OrgId = merchant.OrgId, Method = "GET", Path = "/v1/payments", Status = 200, At = old });
            db.ApiRequestLogs.Add(new ApiRequestLog { RequestId = "req_old_b", OrgId = held.OrgId, Method = "GET", Path = "/v1/payments", Status = 200, At = old });
            db.Cases.Add(new ComplianceCase { Id = Ids.New("case"), CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow, Title = "Litigation", Type = "legal", SubjectType = "merchant", SubjectId = held.OrgId!, Priority = "high", CreatedBy = "test", DueAt = DateTime.UtcNow.AddDays(30), LegalHold = true });
            return db.SaveChanges();
        });

        var dry = await admin.Post("/v1/admin/retention/run?dry_run=true");
        Assert.True(dry["dry_run"]!.GetValue<bool>());
        Assert.Equal(1, dry["counts"]!["api_request_logs"]!.GetValue<int>());
        Assert.True(f.WithDb(db => db.ApiRequestLogs.Any(r => r.RequestId == "req_old_a")));

        var run = await admin.Post("/v1/admin/retention/run?dry_run=false");
        Assert.Equal(1, run["counts"]!["api_request_logs"]!.GetValue<int>());
        Assert.False(f.WithDb(db => db.ApiRequestLogs.Any(r => r.RequestId == "req_old_a")));
        Assert.True(f.WithDb(db => db.ApiRequestLogs.Any(r => r.RequestId == "req_old_b"))); // under legal hold
        Assert.Contains("10 years", (await merchant.Get("/v1/retention"))["financial_records"]!.GetValue<string>());
    }

    [Fact]
    public async Task Custom_roles_grant_exactly_their_permissions()
    {
        var (owner, _, _, _) = await Scenario.ApprovedMerchant(f, _http, "roles@acme.test", "Roles Co");
        await owner.Post("/v1/roles", new { name = "Too much", permissions = new[] { "payments.read", "org.close" } }, 400);
        var role = await owner.Post("/v1/roles", new { name = "Refunds desk", description = "Front-line refunds", permissions = new[] { "payments.read", "payments.refund" } }, 201);
        Assert.Equal("custom:refunds_desk", role["key"]!.GetValue<string>());

        var desk = await Scenario.SignUp(_http, "desk@roles.test", "Desk Person");
        await owner.Post("/v1/team", new { email = "desk@roles.test", role = "custom:refunds_desk" });
        desk.OrgId = owner.OrgId;
        await desk.Get("/v1/payments");
        await desk.Get("/v1/customers", 403);
        var me = (await desk.Get("/v1/me"))["organizations"]!.AsArray().Single()!;
        Assert.Equal(["payments.read", "payments.refund"], me["permissions"]!.AsArray().Select(p => p!.GetValue<string>()).OrderBy(p => p));

        // Editing the role changes access at once; a role in use can't be deleted.
        await owner.Patch("/v1/roles/custom:refunds_desk", new { permissions = new[] { "payments.read", "payments.refund", "customers.read" } });
        await desk.Get("/v1/customers");
        Assert.Equal(409, (int)(await owner.Send(HttpMethod.Delete, "/v1/roles/custom:refunds_desk")).Status);
        Assert.Contains((await owner.Get("/v1/roles"))["data"]!.AsArray(), r => r!["key"]!.GetValue<string>() == "custom:refunds_desk" && r["members"]!.GetValue<int>() == 1);
    }

    [Fact]
    public async Task Scim_provisions_and_deprovisions_members()
    {
        var (owner, _, _, _) = await Scenario.ApprovedMerchant(f, _http, "scim@acme.test", "Scim Co");
        await owner.Post("/v1/organization/scim_tokens", new { default_role = "analyst" }, 403); // step-up first
        await Scenario.StepUp(owner);
        var created = await owner.Post("/v1/organization/scim_tokens", new { default_role = "analyst" }, 201);
        var idp = new Api(_http) { ApiKey = created["token"]!.GetValue<string>() };

        var list = await idp.Get($"/scim/v2/Users?filter={Uri.EscapeDataString("userName eq \"scim@acme.test\"")}");
        Assert.Equal(1, list["totalResults"]!.GetValue<int>());
        var ownerId = list["Resources"]![0]!["id"]!.GetValue<string>();

        var body = new Dictionary<string, object?>
        {
            ["schemas"] = new[] { "urn:ietf:params:scim:schemas:core:2.0:User" }, ["userName"] = "Sso.Person@Scim.test", ["externalId"] = "okta-00u1",
            ["name"] = new Dictionary<string, string> { ["givenName"] = "Sso", ["familyName"] = "Person" }, ["active"] = true,
        };
        var user = await idp.Post("/scim/v2/Users", body, 201);
        Assert.Equal("sso.person@scim.test", user["userName"]!.GetValue<string>());
        Assert.Equal("analyst", user["roles"]![0]!["value"]!.GetValue<string>());
        Assert.Equal("uniqueness", (await idp.Send(HttpMethod.Post, "/scim/v2/Users", body)).Body!["scimType"]!.GetValue<string>());

        // The provisioned person has no password: they sign in with an emailed code.
        await new Api(_http).Post("/v1/auth/email_code", new { email = "sso.person@scim.test" }, 202);
        var code = Regex.Match(LastEmail("sso.person@scim.test", "sign_in_code"), @"code is (\d{6})").Groups[1].Value;
        var session = await new Api(_http).Post("/v1/auth/email_code/verify", new { email = "sso.person@scim.test", code });
        var person = new Api(_http) { Token = session["token"]!.GetValue<string>(), OrgId = owner.OrgId };
        await person.Get("/v1/payments");

        var patch = new Dictionary<string, object?>
        {
            ["schemas"] = new[] { "urn:ietf:params:scim:api:messages:2.0:PatchOp" },
            ["Operations"] = new[] { new Dictionary<string, object?> { ["op"] = "replace", ["path"] = "active", ["value"] = false } },
        };
        Assert.False((await idp.Patch($"/scim/v2/Users/{user["id"]}", patch))["active"]!.GetValue<bool>());
        await person.Get("/v1/payments", 403); // access ends on the next request
        Assert.Equal(403, (int)(await idp.Send(HttpMethod.Patch, $"/scim/v2/Users/{ownerId}", patch)).Status);
        await idp.Get("/v1/payments", 401); // a SCIM token only reaches /scim

        Assert.Equal(204, (int)(await idp.Send(HttpMethod.Delete, $"/scim/v2/Users/{user["id"]}")).Status);
        await idp.Get($"/scim/v2/Users/{user["id"]}", 404);
        Assert.True(f.WithDb(db => db.AuditLogs.Count(a => a.Action.StartsWith("scim.")) >= 3));
    }

    [Fact]
    public async Task Email_codes_magic_links_and_password_reset()
    {
        var existing = await Scenario.SignUp(_http, "pw@people.test", "Pat Word");
        var anon = new Api(_http);
        await anon.Post("/v1/auth/email_code", new { email = "nobody@people.test" }, 202); // same answer, nothing sent
        Assert.False(f.WithDb(db => db.Notifications.Any(n => n.Recipient == "nobody@people.test")));

        await anon.Post("/v1/auth/email_code", new { email = "PW@people.test" }, 202);
        var mail = LastEmail("pw@people.test", "sign_in_code");
        var code = Regex.Match(mail, @"code is (\d{6})").Groups[1].Value;
        var wrong = code == "000000" ? "111111" : "000000";
        await anon.Post("/v1/auth/email_code/verify", new { email = "pw@people.test", code = wrong }, 401);
        var signedIn = await anon.Post("/v1/auth/email_code/verify", new { email = "pw@people.test", code });
        Assert.StartsWith("ses_", signedIn["token"]!.GetValue<string>());
        await anon.Post("/v1/auth/email_code/verify", new { email = "pw@people.test", code }, 401); // single use

        // The magic link in the same kind of email also signs in, once.
        await anon.Post("/v1/auth/email_code", new { email = "pw@people.test" }, 202);
        var link = Regex.Match(LastEmail("pw@people.test", "sign_in_code"), @"token=(ml_[A-Za-z0-9_\-]+)").Groups[1].Value;
        await anon.Post("/v1/auth/magic_link/verify", new { token = link });
        await anon.Post("/v1/auth/magic_link/verify", new { token = link }, 401);

        // Five wrong codes burn the challenge.
        await anon.Post("/v1/auth/email_code", new { email = "pw@people.test" }, 202);
        var fresh = Regex.Match(LastEmail("pw@people.test", "sign_in_code"), @"code is (\d{6})").Groups[1].Value;
        var bad = fresh == "000000" ? "111111" : "000000";
        for (var i = 0; i < 5; i++) await anon.Post("/v1/auth/email_code/verify", new { email = "pw@people.test", code = bad }, 401);
        await anon.Post("/v1/auth/email_code/verify", new { email = "pw@people.test", code = fresh }, 429);

        // Password reset: a new password works, the old one doesn't, and every session is signed out.
        await anon.Post("/v1/auth/password_reset", new { email = "pw@people.test" }, 202);
        var reset = Regex.Match(LastEmail("pw@people.test", "password_reset"), @"token=(pr_[A-Za-z0-9_\-]+)").Groups[1].Value;
        await anon.Post("/v1/auth/password_reset/confirm", new { token = reset, password = "short" }, 400);
        await anon.Post("/v1/auth/password_reset/confirm", new { token = reset, password = "Brand-New-Pass-7" });
        await anon.Post("/v1/auth/password_reset/confirm", new { token = reset, password = "Brand-New-Pass-8" }, 400);
        await existing.Get("/v1/me", 401);
        await anon.Post("/v1/auth/login", new { email = "pw@people.test", password = Scenario.Password }, 401);
        await anon.Post("/v1/auth/login", new { email = "pw@people.test", password = "Brand-New-Pass-7" });
        Assert.True(f.WithDb(db => db.SecurityEvents.Any(e => e.Type == "password_reset")));
    }

    [Fact]
    public async Task Sign_ins_from_impossibly_distant_places_raise_an_alert()
    {
        await Scenario.SignUp(_http, "traveller@people.test", "Tara Veller");
        async Task Login(double lat, double lon, string country)
        {
            var req = new HttpRequestMessage(HttpMethod.Post, "/v1/auth/login")
            {
                Content = new StringContent($"{{\"email\":\"traveller@people.test\",\"password\":\"{Scenario.Password}\"}}", Encoding.UTF8, "application/json"),
            };
            req.Headers.Add("CF-IPCountry", country);
            req.Headers.Add("CF-IPLatitude", lat.ToString(System.Globalization.CultureInfo.InvariantCulture));
            req.Headers.Add("CF-IPLongitude", lon.ToString(System.Globalization.CultureInfo.InvariantCulture));
            Assert.Equal(200, (int)(await _http.SendAsync(req)).StatusCode);
        }
        await Login(51.5074, -0.1278, "GB");
        await Login(51.4545, -2.5879, "GB"); // Bristol: 170 km, fine
        Assert.False(f.WithDb(db => db.SecurityEvents.Any(e => e.Type == "impossible_travel")));
        await Login(19.0760, 72.8777, "IN"); // Mumbai minutes later
        var userId = f.WithDb(db => db.Users.Single(u => u.Email == "traveller@people.test").Id);
        var ev = f.WithDb(db => db.SecurityEvents.Single(e => e.UserId == userId && e.Type == "impossible_travel"));
        Assert.Contains("GB → IN", ev.Detail);
        Assert.True(f.WithDb(db => db.Alerts.Any(a => a.SubjectId == userId && a.RuleKey == "impossible_travel")));
        Assert.True(f.WithDb(db => db.Notifications.Any(n => n.Recipient == "traveller@people.test" && n.Template == "unusual_sign_in")));
        Assert.Equal("IN", f.WithDb(db => db.Sessions.Where(s => s.UserId == userId).OrderByDescending(s => s.CreatedAt).First().GeoCountry));
    }

    [Fact]
    public async Task Bank_statements_match_deposits_to_payouts()
    {
        var (merchant, _, _, priceId) = await Scenario.ApprovedMerchant(f, _http, "bank@acme.test", "Bank Co");
        await Scenario.Buy(merchant, priceId, country: "US", email: "b1@example.com");
        await merchant.Post("/v1/test_helpers/balance/settle_now");
        await Scenario.StepUp(merchant);
        await merchant.Post("/v1/payout_destinations", new { country = "US", currency = "USD", account_holder = "Bank Co", bank_name = "Test Bank", account_number = "000123456789", routing_number = "110000000" });
        var payout = await merchant.Post("/v1/payouts", new { currency = "USD" }, 201);
        await merchant.Post("/v1/test_helpers/run_jobs");
        await merchant.Post("/v1/test_helpers/run_jobs");
        var amount = payout["amount"]!.GetValue<long>();
        var today = DateTime.UtcNow.ToString("yyyy-MM-dd");
        var csv = $"Date,Amount,Reference,Description\n{today},{amount / 100}.{amount % 100:D2},{payout["id"]},PAYMENTAPP PAYOUT\n{today},12.00,,Unknown transfer\n{today},\"(5.00)\",,Card fee\n";

        await merchant.Post("/v1/bank_statements", new { content = "Date,Amount\nnot-a-date,1.00\n", currency = "USD" }, 400);
        var st = await merchant.Post("/v1/bank_statements", new { content = csv, currency = "USD", account_label = "Operating account" }, 201);
        Assert.Equal(1, st["statement"]!["matched"]!.GetValue<int>());
        Assert.Equal(2, st["statement"]!["unmatched"]!.GetValue<int>());
        var lines = st["lines"]!.AsArray();
        Assert.Equal("reference", lines[0]!["match_method"]!.GetValue<string>());
        Assert.Equal(-500, lines[2]!["amount"]!.GetValue<long>());
        Assert.Equal(1, st["summary"]!["unknown_deposits"]!.GetValue<int>());

        var stId = st["statement"]!["id"]!.GetValue<string>();
        await merchant.Post($"/v1/bank_statements/{stId}/lines/{lines[1]!["id"]}/match", new { payout = payout["id"]!.GetValue<string>() }, 400); // amount differs
        await merchant.Post($"/v1/bank_statements/{stId}/lines/{lines[2]!["id"]}/status", new { ignore = true }, 400);    // needs a note
        await merchant.Post($"/v1/bank_statements/{stId}/lines/{lines[2]!["id"]}/status", new { ignore = true, note = "Bank card fee" });
        var detail = await merchant.Get($"/v1/bank_statements/{stId}");
        Assert.Equal(1, detail["statement"]!["ignored"]!.GetValue<int>());
        Assert.Equal(1, detail["statement"]!["unmatched"]!.GetValue<int>());

        // A second statement with the same deposit can't match the payout twice.
        var again = await merchant.Post("/v1/bank_statements", new { content = csv, currency = "USD" }, 201);
        Assert.Equal(0, again["statement"]!["matched"]!.GetValue<int>());
    }

    [Fact]
    public async Task Payment_requests_are_paid_through_checkout_or_cancelled()
    {
        var (merchant, _, _, _) = await Scenario.ApprovedMerchant(f, _http, "request@acme.test", "Request Co");
        await merchant.Post("/v1/payment_requests", new { email = "client@example.com", amount = 0, currency = "USD", description = "x" }, 400);
        var pr = await merchant.Post("/v1/payment_requests", new { email = "client@example.com", amount = 12345, currency = "USD", description = "Consulting — March", note = "Thanks for the great workshop" }, 201);
        Assert.Equal("open", pr["status"]!.GetValue<string>());
        var sessionId = pr["checkout_session_id"]!.GetValue<string>();
        Assert.EndsWith($"/checkout/{sessionId}", pr["url"]!.GetValue<string>());
        Assert.Contains("Consulting — March", LastEmail("client@example.com", "payment_request"));
        await merchant.Post($"/v1/payment_requests/{pr["id"]}/remind", null, 409); // emailed less than a day ago

        var paid = await Confirm(merchant, sessionId, "client@example.com");
        Assert.Equal("SUCCEEDED", f.WithDb(db => db.Payments.Single(p => p.Id == paid["payment"]!.GetValue<string>()).Status));
        var after = await merchant.Get($"/v1/payment_requests/{pr["id"]}");
        Assert.Equal("paid", after["status"]!.GetValue<string>());
        Assert.Equal(12345, f.WithDb(db => db.Payments.Single(p => p.Id == after["payment"]!.GetValue<string>()).Amount));
        await merchant.Post($"/v1/payment_requests/{pr["id"]}/cancel", null, 409);

        var other = await merchant.Post("/v1/payment_requests", new { email = "late@example.com", amount = 5000, currency = "USD", description = "Deposit", send = false }, 201);
        var cancelled = await merchant.Post($"/v1/payment_requests/{other["id"]}/cancel");
        Assert.Equal("cancelled", cancelled["status"]!.GetValue<string>());
        var token = await Scenario.Card(merchant);
        var refused = await new Api(_http).Send(HttpMethod.Post, $"/v1/public/checkout/{other["checkout_session_id"]}/confirm", new { email = "late@example.com", country = "US", token, accept_terms = true });
        Assert.Equal(409, (int)refused.Status);
        Assert.Equal(2, (await merchant.Get("/v1/payment_requests"))["data"]!.AsArray().Count);
        AssertLedgerBalanced();
    }
}
