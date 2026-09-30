using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PaymentApp.Api.Data;

namespace PaymentApp.Tests;

/// <summary>Captures outgoing webhook HTTP calls instead of hitting the network.</summary>
public class WebhookCapture : HttpMessageHandler
{
    public List<(string Url, Dictionary<string, string> Headers, string Body)> Requests { get; } = [];
    public HttpStatusCode Respond { get; set; } = HttpStatusCode.OK;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content == null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
        lock (Requests) Requests.Add((request.RequestUri!.ToString(), request.Headers.ToDictionary(h => h.Key, h => string.Join(",", h.Value)), body));
        return new HttpResponseMessage(Respond) { Content = new StringContent("ok") };
    }
}

public class ApiFactory : WebApplicationFactory<Program>
{
    public WebhookCapture Webhooks { get; } = new();
    public string DbPath { get; } = Path.Combine(Path.GetTempPath(), $"paymentapp-test-{Guid.NewGuid():N}.db");
    public string FilesPath { get; } = Path.Combine(Path.GetTempPath(), $"paymentapp-files-{Guid.NewGuid():N}");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.ConfigureAppConfiguration((_, cfg) => cfg.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Default"] = $"Data Source={DbPath}",
            ["Jobs:IntervalSeconds"] = "0",
            ["RateLimits:Scale"] = "1000",
            ["Platform:BootstrapAdminEmail"] = "root@admin.test",
            ["Anthropic:ApiKey"] = "",
            ["Storage:Path"] = FilesPath,
        }));
        builder.ConfigureServices(s => s.AddHttpClient("webhooks").ConfigurePrimaryHttpMessageHandler(() => Webhooks));
    }

    public T WithDb<T>(Func<AppDb, T> f)
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        using var _ = db.Tenant.Elevate();
        return f(db);
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        foreach (var f in new[] { DbPath, DbPath + "-wal", DbPath + "-shm" }) try { File.Delete(f); } catch { }
        try { if (Directory.Exists(FilesPath)) Directory.Delete(FilesPath, true); } catch { }
    }
}

/// <summary>Thin JSON client: every call returns the parsed body and asserts the expected status.</summary>
public class Api(HttpClient http)
{
    public string? Token { get; set; }
    public string? OrgId { get; set; }
    public bool Live { get; set; }
    public string? ApiKey { get; set; }
    public HttpClient Http => http;

    private HttpRequestMessage Build(HttpMethod method, string path, object? body, string? idempotencyKey)
    {
        var req = new HttpRequestMessage(method, path);
        var auth = ApiKey ?? Token;
        if (auth != null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", auth);
        if (OrgId != null && ApiKey == null) req.Headers.Add("X-Org-Id", OrgId);
        if (Live) req.Headers.Add("X-Livemode", "true");
        if (idempotencyKey != null) req.Headers.Add("Idempotency-Key", idempotencyKey);
        if (body != null) req.Content = new StringContent(JsonSerializer.Serialize(body, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower }), Encoding.UTF8, "application/json");
        return req;
    }

    public async Task<(HttpStatusCode Status, JsonNode? Body, HttpResponseMessage Raw)> Send(HttpMethod method, string path, object? body = null, string? idempotencyKey = null)
    {
        var res = await http.SendAsync(Build(method, path, body, idempotencyKey));
        var text = await res.Content.ReadAsStringAsync();
        JsonNode? node = null;
        if (text.Length > 0 && (text[0] == '{' || text[0] == '[')) node = JsonNode.Parse(text);
        return (res.StatusCode, node, res);
    }

    public async Task<JsonNode> Get(string path, int expect = 200) => await Expect(HttpMethod.Get, path, null, expect);
    public async Task<JsonNode> Post(string path, object? body = null, int expect = 200, string? idem = null) => await Expect(HttpMethod.Post, path, body ?? new { }, expect, idem);
    public async Task<JsonNode> Patch(string path, object body, int expect = 200) => await Expect(HttpMethod.Patch, path, body, expect);

    private async Task<JsonNode> Expect(HttpMethod m, string path, object? body, int expect, string? idem = null)
    {
        var (status, node, _) = await Send(m, path, body, idem);
        Assert.True((int)status == expect, $"{m} {path} → {(int)status}, expected {expect}: {node?.ToJsonString()}");
        return node ?? new JsonObject();
    }

    public Api Clone() => new(http) { Token = Token, OrgId = OrgId, Live = Live, ApiKey = ApiKey };
}

public static class Scenario
{
    public const string Password = "Correct-Horse-9";

    public static async Task<Api> SignUp(HttpClient http, string email, string name, string? org = null, string country = "US", string currency = "USD")
    {
        var api = new Api(http);
        var r = await api.Post("/v1/auth/signup", new { email, password = Password, name, country, organization_name = org, currency }, 201);
        api.Token = r["token"]!.GetValue<string>();
        if (org != null) api.OrgId = r["organization"]!["id"]!.GetValue<string>();
        return api;
    }

    public static async Task StepUp(Api api) => await api.Post("/v1/auth/step-up", new { password = Password });

    public static async Task<string> Card(Api api, string number = "4242424242424242")
    {
        var r = await new Api(api.Http).Post("/v1/public/sim/tokens", new { type = "card", number, exp_month = 12, exp_year = 2031, cvc = "123" });
        return r["id"]!.GetValue<string>();
    }

    /// <summary>Merchant with an approved application, one product and prices.</summary>
    public static async Task<(Api Merchant, Api Admin, string ProductId, string PriceId)> ApprovedMerchant(ApiFactory f, HttpClient http, string email = "owner@acme.test", string org = "Acme AI")
    {
        var merchant = await SignUp(http, email, "Olivia Owner", org);
        await merchant.Patch("/v1/organization/application", new
        {
            legal_name = org + " Inc", website = "https://acme.example", industry = "software", country = "US", registered_address = "1 Main St",
            registration_number = "REG-123", product_description = "AI writing SaaS", refund_policy_url = "https://acme.example/refunds",
            terms_url = "https://acme.example/terms", privacy_url = "https://acme.example/privacy",
            beneficial_owners = new[] { new { name = "Olivia Owner", date_of_birth = "1985-02-03", nationality = "US", country = "US", ownership_bps = 10000, relationship = "owner" } },
        });
        var submitted = await merchant.Post("/v1/organization/application/submit");
        Assert.Equal("UNDER_REVIEW", submitted["status"]!.GetValue<string>());
        var admin = await Admin(http);
        await admin.Post($"/v1/admin/merchants/{merchant.OrgId}/decision", new { approve = true, reason = "KYB documents verified" });
        var product = await merchant.Post("/v1/products", new { name = "Writer Pro", type = "saas", tax_category = "digital_service" }, 201);
        var productId = product["id"]!.GetValue<string>();
        var price = await merchant.Post("/v1/prices", new { product_id = productId, currency = "USD", type = "one_time", unit_amount = 10000 }, 201);
        return (merchant, admin, productId, price["id"]!.GetValue<string>());
    }

    public static async Task<Api> Admin(HttpClient http)
    {
        var api = new Api(http);
        var (status, body, _) = await api.Send(HttpMethod.Post, "/v1/auth/login", new { email = "root@admin.test", password = Password });
        if ((int)status == 200) { api.Token = body!["token"]!.GetValue<string>(); return api; }
        return await SignUp(http, "root@admin.test", "Root Admin");
    }

    /// <summary>Checkout with a card: creates session, confirms, returns (sessionId, confirmation).</summary>
    public static async Task<(string Session, JsonNode Result)> Buy(Api merchant, string priceId, string card = "4242424242424242", string country = "IN",
        string email = "buyer@example.com", string mode = "payment", long qty = 1, string? coupon = null, string? idem = null)
    {
        var session = await merchant.Post("/v1/checkout/sessions", new { mode, line_items = new[] { new { price_id = priceId, quantity = qty } }, success_url = "https://acme.example/thanks" }, 201);
        var id = session["id"]!.GetValue<string>();
        var token = await Card(merchant, card);
        var buyer = new Api(merchant.Http);
        var result = await buyer.Post($"/v1/public/checkout/{id}/confirm", new { email, name = "Bea Buyer", country, token, accept_terms = true, coupon_code = coupon }, 200, idem);
        return (id, result);
    }
}
