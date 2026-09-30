using System.Text.Json.Nodes;
using PaymentApp.Api.Common;
using PaymentApp.Api.Modules.Ledger;

namespace PaymentApp.Tests;

/// <summary>Global Wallet + AML/CFT console acceptance (URS part 2: §29-§45, §47-§71, §205-§211).</summary>
public class WalletComplianceTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _http = f.CreateClient();

    private void AssertLedgerBalanced()
    {
        var json = JsonNode.Parse(Json.Serialize(f.WithDb(db => LedgerService.VerifyIntegrity(db).GetAwaiter().GetResult())))!;
        Assert.True(json["balanced"]!.GetValue<bool>(), json.ToJsonString());
    }

    private async Task<Api> WalletUser(string email, string name, string country, int level = 2, string dob = "1990-01-01")
    {
        var api = await Scenario.SignUp(_http, email, name, country: country);
        await api.Post("/v1/wallet/activate", null, 403); // KYC first (§8)
        var kyc = await api.Post("/v1/me/kyc", new { full_name = name, date_of_birth = dob, country, address = "1 Test St", document_type = "passport", level });
        if (kyc["status"]!.GetValue<string>() == "VERIFIED") await api.Post("/v1/wallet/activate");
        return api;
    }

    private async Task<string> Handle(Api user) => (await user.Get("/v1/wallet"))["handle"]!.GetValue<string>();

    private async Task<Api> Staff(string email, string role)
    {
        var api = await Scenario.SignUp(_http, email, role.ToLowerInvariant(), country: "US");
        f.WithDb(db => { db.Users.First(u => u.Email == email).PlatformRole = role; return db.SaveChanges(); });
        return api;
    }

    private static long Available(JsonNode wallet, string currency) =>
        wallet["balances"]!.AsArray().First(b => b!["currency"]!.GetValue<string>() == currency)!["available"]!.GetValue<long>();

    [Fact]
    public async Task Cross_currency_transfer_uses_the_quoted_amounts_and_balances_per_currency()
    {
        var alice = await WalletUser("alice@w.test", "Alice Sharma", "IN");
        var bob = await WalletUser("bob@w.test", "Bob Carter", "GB");
        await alice.Post("/v1/wallet/fund", new { currency = "INR", amount = 10_000_000, source = "bank_transfer" });
        Assert.Equal(10_000_000, Available(await alice.Get("/v1/wallet"), "INR"));

        var quote = await alice.Post("/v1/wallet/fx/quotes", new { from_currency = "INR", to_currency = "GBP", amount = 1_000_000 });
        var received = quote["destination_amount"]!.GetValue<long>();
        var fee = quote["fee_amount"]!.GetValue<long>();
        Assert.True(quote["spread_amount"]!.GetValue<long>() > 0);
        Assert.Equal(3000, fee); // 30 bps of ₹10,000.00
        var t = await alice.Post("/v1/wallet/transfers", new { recipient = await Handle(bob), source_currency = "INR", amount = 1_000_000, destination_currency = "GBP", quote_id = quote["id"]!.GetValue<string>(), purpose = "Personal support" }, 201);
        Assert.Equal("COMPLETED", t["status"]!.GetValue<string>());
        Assert.Equal(received, t["destination_amount"]!.GetValue<long>());
        Assert.Null(t["internal_reason"]); // customer view never carries internal fields (§224)
        Assert.Equal(10_000_000 - 1_000_000 - fee, Available(await alice.Get("/v1/wallet"), "INR"));
        Assert.Equal(received, Available(await bob.Get("/v1/wallet"), "GBP"));

        // A quote is single-use.
        await alice.Post("/v1/wallet/transfers", new { recipient = await Handle(bob), source_currency = "INR", amount = 1_000_000, destination_currency = "GBP", quote_id = quote["id"]!.GetValue<string>() }, 409);
        // Overspending is refused, and a limit above the KYC tier is refused.
        await alice.Post("/v1/wallet/transfers", new { recipient = await Handle(bob), source_currency = "INR", amount = 9_999_999 }, 400);
        var lowKyc = await WalletUser("low@w.test", "Lowe Tier", "US", level: 1);
        await lowKyc.Post("/v1/wallet/fund", new { currency = "USD", amount = 90_000 });
        await lowKyc.Post("/v1/wallet/fund", new { currency = "USD", amount = 90_000 });
        await lowKyc.Post("/v1/wallet/fund", new { currency = "USD", amount = 120_000 }, 400); // over the tier-1 per-transaction limit
        var limited = await lowKyc.Send(HttpMethod.Post, "/v1/wallet/transfers", new { recipient = await Handle(bob), source_currency = "USD", amount = 150_000 });
        Assert.Equal("limit_exceeded", limited.Body!["error"]!["code"]!.GetValue<string>());
        AssertLedgerBalanced();
    }

    [Fact]
    public async Task Large_transfer_is_held_and_released_only_by_a_second_reviewer()
    {
        var carol = await WalletUser("carol@w.test", "Carol Diaz", "US");
        var hugo = await WalletUser("hugo@w.test", "Hugo Martin", "FR");
        await carol.Post("/v1/wallet/fund", new { currency = "USD", amount = 700_000 });
        await carol.Post("/v1/wallet/fund", new { currency = "USD", amount = 700_000 });
        var t = await carol.Post("/v1/wallet/transfers", new { recipient = await Handle(hugo), source_currency = "USD", amount = 1_100_000 }, 201);
        Assert.Equal("HELD", t["status"]!.GetValue<string>());
        Assert.Equal("This transaction requires additional review. We'll update you soon.", t["message"]!.GetValue<string>());
        Assert.Equal(1_400_000 - 1_100_000, Available(await carol.Get("/v1/wallet"), "USD")); // funds on hold
        Assert.Equal(1_100_000, (await hugo.Get("/v1/wallet"))["balances"]!.AsArray().First(b => b!["currency"]!.GetValue<string>() == "USD")!["pending_incoming"]!.GetValue<long>());

        var analyst = await Staff("analyst@w.test", "AML_ANALYST");
        var compliance = await Staff("compliance@w.test", "COMPLIANCE_ADMIN");
        var alerts = (await analyst.Get("/v1/admin/alerts?status=open"))["data"]!.AsArray();
        var alert = alerts.First(a => a!["transfer_id"]?.GetValue<string>() == t["id"]!.GetValue<string>())!;
        Assert.Equal("large_transaction", alert["rule_key"]!.GetValue<string>());
        Assert.Equal("Transaction above review threshold", alert["summary"]!.GetValue<string>());
        Assert.Contains("threshold", alert["reasons"]![0]!["text"]!.GetValue<string>());

        var approval = await analyst.Post("/v1/admin/approvals", new { action = "release_transfer", target_type = "transfer", target_id = t["id"]!.GetValue<string>(), reason = "Documented salary source; consistent with profile" }, 201);
        await analyst.Post($"/v1/admin/approvals/{approval["id"]}/decision", new { approve = true }, 403); // analysts cannot approve
        await compliance.Post($"/v1/admin/approvals/{approval["id"]}/decision", new { approve = true }, 403); // step-up first
        await Scenario.StepUp(compliance);
        var decided = await compliance.Post($"/v1/admin/approvals/{approval["id"]}/decision", new { approve = true, note = "Reviewed source of funds" });
        Assert.Equal("executed", decided["status"]!.GetValue<string>());
        Assert.Equal("COMPLETED", (await carol.Get($"/v1/wallet/transfers/{t["id"]}"))["status"]!.GetValue<string>());
        Assert.Equal(1_100_000, Available(await hugo.Get("/v1/wallet"), "USD"));

        // Four-eyes: the requester can never approve their own request, whatever their role.
        var self = await compliance.Post("/v1/admin/approvals", new { action = "freeze_user", target_type = "user", target_id = f.WithDb(db => db.Users.First(u => u.Email == "hugo@w.test").Id), reason = "Test self approval" }, 201);
        var refused = await compliance.Send(HttpMethod.Post, $"/v1/admin/approvals/{self["id"]}/decision", new { approve = true });
        Assert.Equal(403, (int)refused.Status);
        Assert.Contains("own request", refused.Body!["error"]!["message"]!.GetValue<string>());
        AssertLedgerBalanced();
    }

    [Fact]
    public async Task Patterns_raise_explainable_alerts_and_trace_shows_inferred_flow()
    {
        var a = await WalletUser("ring-a@w.test", "Ringo Alpha", "US");
        var b = await WalletUser("ring-b@w.test", "Rita Beta", "US");
        var c = await WalletUser("ring-c@w.test", "Rex Gamma", "US");
        await a.Post("/v1/wallet/fund", new { currency = "USD", amount = 300_000 });
        var t1 = await a.Post("/v1/wallet/transfers", new { recipient = await Handle(b), source_currency = "USD", amount = 150_000 }, 201);
        await b.Post("/v1/wallet/transfers", new { recipient = await Handle(c), source_currency = "USD", amount = 140_000 }, 201);
        var closing = await c.Post("/v1/wallet/transfers", new { recipient = await Handle(a), source_currency = "USD", amount = 130_000 }, 201);

        var analyst = await Staff("analyst2@w.test", "AML_ANALYST");
        var alerts = (await analyst.Get("/v1/admin/alerts?type=aml"))["data"]!.AsArray();
        var circular = alerts.FirstOrDefault(x => x!["rule_key"]!.GetValue<string>() == "circular" && x["transfer_id"]!.GetValue<string>() == closing["id"]!.GetValue<string>());
        Assert.NotNull(circular);
        Assert.Contains(alerts, x => x!["rule_key"]!.GetValue<string>() == "rapid_pass_through");
        Assert.DoesNotContain("launder", circular!.ToJsonString(), StringComparison.OrdinalIgnoreCase);

        // Fan-out: one sender to five recipients in a day.
        var hub = await WalletUser("hub@w.test", "Hubert Hub", "US");
        await hub.Post("/v1/wallet/fund", new { currency = "USD", amount = 400_000 });
        for (var i = 0; i < 5; i++)
        {
            var r = await WalletUser($"leaf{i}@w.test", $"Leaf Person{i}", "US");
            await hub.Post("/v1/wallet/transfers", new { recipient = await Handle(r), source_currency = "USD", amount = 10_000 + i }, 201);
        }
        Assert.Contains((await analyst.Get("/v1/admin/alerts?type=aml"))["data"]!.AsArray(), x => x!["rule_key"]!.GetValue<string>() == "fan_out");

        // Trace from the first transfer: the loop's onward hops are labelled inferred, never proven.
        var trace = await analyst.Get($"/v1/admin/transfers/{t1["id"]}/trace?hops=3");
        var edges = trace["edges"]!.AsArray();
        Assert.Equal("actual", edges.First(e => e!["id"]!.GetValue<string>() == t1["id"]!.GetValue<string>())!["relation"]!.GetValue<string>());
        Assert.Contains(edges, e => e!["relation"]!.GetValue<string>() == "inferred_onward");

        // Case with immutable finalized note and hashed evidence.
        var caseFile = await analyst.Post("/v1/admin/cases", new { subject_type = "user", subject_id = circular["subject_id"]!.GetValue<string>(), title = "Loop between three wallets", priority = "HIGH", alerts = new[] { circular["id"]!.GetValue<string>() } }, 201);
        var note = await analyst.Post($"/v1/admin/cases/{caseFile["id"]}/notes", new { kind = "observation", body = "Funds returned to origin within the hour.", finalize = true });
        await analyst.Post($"/v1/admin/case_notes/{note["id"]}/finalize", null, 409);
        var ev = await analyst.Post($"/v1/admin/cases/{caseFile["id"]}/evidence", new { ref_type = "transfer", ref_id = closing["id"]!.GetValue<string>(), description = "Closing leg" });
        Assert.Equal(64, ev["sha256"]!.GetValue<string>().Length);
        // Restrictive outcomes need a second reviewer.
        var decision = await analyst.Post($"/v1/admin/cases/{caseFile["id"]}/decision", new { decision = "FREEZE", reason = "Pattern persists after information request" });
        Assert.Equal("approval_request", decision["object"]!.GetValue<string>());
        Assert.Equal("pending", decision["status"]!.GetValue<string>());
    }

    [Fact]
    public async Task Sanctions_match_holds_beneficiary_transfer_and_confirmation_freezes_after_approval()
    {
        var sender = await WalletUser("sender@w.test", "Sally Sender", "GB");
        var listed = await WalletUser("listed@w.test", "Viktor Testovich Blocked", "GB", dob: "1971-03-02");
        var listedUser = await listed.Get("/v1/me");
        Assert.Equal("REVIEW", listedUser["user"]!["kyc_status"]!.GetValue<string>());

        var compliance = await Staff("cmp@w.test", "COMPLIANCE_ADMIN");
        var officer = await Staff("officer@w.test", "COMPLIANCE_ADMIN");
        var listedId = listedUser["user"]!["id"]!.GetValue<string>();
        // KYC reviewer clears the identity documents (screening is a separate control).
        await compliance.Post($"/v1/admin/users/{listedId}/kyc_decision", new { approve = true, level = 2, reason = "Documents authentic; screening handled separately" });
        await listed.Post("/v1/wallet/activate");

        await sender.Post("/v1/wallet/fund", new { currency = "GBP", amount = 50_000 });
        var t = await sender.Post("/v1/wallet/transfers", new { recipient = await Handle(listed), source_currency = "GBP", amount = 10_000 }, 201);
        Assert.Equal("HELD", t["status"]!.GetValue<string>());
        var alert = (await compliance.Get("/v1/admin/alerts?type=sanctions"))["data"]!.AsArray().First(a => a!["transfer_id"]?.GetValue<string>() == t["id"]!.GetValue<string>())!;
        Assert.Equal("Potential sanctions match", alert["summary"]!.GetValue<string>());
        Assert.Equal("CRITICAL", alert["severity"]!.GetValue<string>());

        var approval = await compliance.Post($"/v1/admin/alerts/{alert["id"]}/conclude", new { conclusion = "TRUE_MATCH", note = "Name, DOB and alias match the listed entry" });
        Assert.Equal("approval_request", approval["object"]!.GetValue<string>());
        await Scenario.StepUp(officer);
        var done = await officer.Post($"/v1/admin/approvals/{approval["id"]}/decision", new { approve = true, note = "Confirmed per procedure" });
        Assert.Equal("executed", done["status"]!.GetValue<string>());
        Assert.Equal("FROZEN", (await compliance.Get($"/v1/admin/users/{listedId}"))["identity"]!["status"]!.GetValue<string>());
        var blocked = await sender.Get($"/v1/wallet/transfers/{t["id"]}");
        Assert.Equal("CANCELLED", blocked["status"]!.GetValue<string>());
        Assert.DoesNotContain("sanction", blocked["message"]!.GetValue<string>(), StringComparison.OrdinalIgnoreCase); // no tipping off (§71)
        Assert.Equal(50_000, Available(await sender.Get("/v1/wallet"), "GBP"));        // hold released
        AssertLedgerBalanced();
    }

    [Fact]
    public async Task Withdrawals_new_bank_is_held_normal_pays_out_and_bank_returns_refund_the_wallet()
    {
        var root = await Scenario.Admin(_http);
        var dana = await WalletUser("dana@w.test", "Dana Okafor", "US");
        await dana.Post("/v1/wallet/fund", new { currency = "USD", amount = 300_000 });
        var fresh = await dana.Post("/v1/wallet/bank_accounts", new { country = "US", currency = "USD", bank_name = "Test Bank", account_holder = "Dana Okafor", account_number = "12345678901", routing = "110000000" }, 201);
        var held = await dana.Post("/v1/wallet/withdrawals", new { currency = "USD", amount = 50_000, bank_account = fresh["id"]!.GetValue<string>() }, 201);
        Assert.Equal("HELD", held["status"]!.GetValue<string>());

        // Age the accounts past the "new bank" window.
        var old = await dana.Post("/v1/wallet/bank_accounts", new { country = "US", currency = "USD", bank_name = "Old Bank", account_holder = "Dana Okafor", account_number = "99887766", routing = "110000000" }, 201);
        var closed = await dana.Post("/v1/wallet/bank_accounts", new { country = "US", currency = "USD", bank_name = "Closed Bank", account_holder = "Dana Okafor", account_number = "55550000", routing = "110000000" }, 201);
        f.WithDb(db => { foreach (var b in db.BankAccounts.Where(b => b.Id == old["id"]!.GetValue<string>() || b.Id == closed["id"]!.GetValue<string>())) b.CreatedAt = DateTime.UtcNow.AddDays(-10); return db.SaveChanges(); });

        var paid = await dana.Post("/v1/wallet/withdrawals", new { currency = "USD", amount = 40_000, bank_account = old["id"]!.GetValue<string>() }, 201);
        Assert.Equal("PROCESSING", paid["status"]!.GetValue<string>());
        var returned = await dana.Post("/v1/wallet/withdrawals", new { currency = "USD", amount = 30_000, bank_account = closed["id"]!.GetValue<string>() }, 201);
        await root.Post("/v1/test_helpers/run_jobs");
        Assert.Equal("COMPLETED", (await dana.Get($"/v1/wallet/transfers/{paid["id"]}"))["status"]!.GetValue<string>());
        Assert.Equal("RETURNED", (await dana.Get($"/v1/wallet/transfers/{returned["id"]}"))["status"]!.GetValue<string>());
        Assert.Equal(300_000 - 50_000 - 40_000, Available(await dana.Get("/v1/wallet"), "USD")); // 50k on hold, 40k paid out, 30k returned

        // Shared bank account across users shows up as a network signal.
        var other = await WalletUser("other@w.test", "Otto Other", "US");
        await other.Post("/v1/wallet/bank_accounts", new { country = "US", currency = "USD", bank_name = "Old Bank", account_holder = "Otto Other", account_number = "99887766", routing = "110000000" }, 201);
        var danaId = f.WithDb(db => db.Users.First(u => u.Email == "dana@w.test").Id);
        var network = await root.Get($"/v1/admin/users/{danaId}/network");
        Assert.Contains(network["links"]!.AsArray(), l => l!["signal"]!.GetValue<string>() == "shared_bank_account");
        AssertLedgerBalanced();
    }

    [Fact]
    public async Task Admin_roles_are_separated_and_access_is_logged()
    {
        var support = await Staff("support@w.test", "SUPPORT_ADMIN");
        var auditor = await Staff("auditor@w.test", "AUDITOR");
        var target = await WalletUser("masked@w.test", "Mona Masked", "US");
        var id = f.WithDb(db => db.Users.First(u => u.Email == "masked@w.test").Id);
        await support.Get("/v1/admin/alerts", 403);                               // support has no AML access (§129)
        var view = await support.Get($"/v1/admin/users/{id}?unmask=true");
        Assert.Equal("m***@w.test", view["identity"]!["email"]!.GetValue<string>()); // masked without pii.unmask (§137)
        await auditor.Get("/v1/admin/audit_logs");
        await auditor.Post("/v1/admin/reconciliation/run", null, 403);             // auditors are read-only (§89)
        Assert.True(f.WithDb(db => db.DataAccessLogs.Any(l => l.ObjectId == id)));  // access itself is audited (§134)
        _ = target;
    }
}
