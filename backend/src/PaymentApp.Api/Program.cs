using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Endpoints;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Billing;
using PaymentApp.Api.Modules.Checkout;
using PaymentApp.Api.Modules.Compliance;
using PaymentApp.Api.Modules.Copilot;
using PaymentApp.Api.Modules.Identity;
using PaymentApp.Api.Modules.Ledger;
using PaymentApp.Api.Modules.Merchants;
using PaymentApp.Api.Modules.Payments;
using PaymentApp.Api.Modules.Payouts;
using PaymentApp.Api.Modules.Platform;
using PaymentApp.Api.Modules.Reports;
using PaymentApp.Api.Modules.Wallet;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

builder.Services.AddDbContext<AppDb>(o => o.UseSqlite(config.GetConnectionString("Default") ?? "Data Source=paymentapp.db"));
builder.Services.ConfigureHttpJsonOptions(o => Json.Configure(o.SerializerOptions));
builder.Services.AddOpenApi();
builder.Services.AddRateLimiter(o => RateLimits.Configure(o, config));
builder.Services.AddHttpClient("webhooks", c => c.Timeout = TimeSpan.FromSeconds(10))
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins((config["Cors:Origins"] ?? "http://localhost:3000").Split(','))
    .AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("Request-Id", "Idempotent-Replayed")));

builder.Services.AddSingleton<IClock, SystemClock>();
builder.Services.AddSingleton<FieldEncryptor>();
builder.Services.AddSingleton<IPaymentProvider, SimulatorProvider>();
builder.Services.AddSingleton<JobRunner>();
builder.Services.AddHostedService<JobHost>();

builder.Services.AddScoped<TenantScope>();
builder.Services.AddScoped<RequestContext>();
builder.Services.AddScoped<Uow>();
builder.Services.AddScoped<LedgerService>();
builder.Services.AddScoped<PaymentRouter>();
builder.Services.AddScoped<PaymentService>();
builder.Services.AddScoped<Fulfillment>();
builder.Services.AddScoped<IFulfillment>(sp => sp.GetRequiredService<Fulfillment>());
builder.Services.AddScoped<BillingClock>();
builder.Services.AddScoped<EntitlementService>();
builder.Services.AddScoped<CreditService>();
builder.Services.AddScoped<BillingService>();
builder.Services.AddScoped<CheckoutCalculator>();
builder.Services.AddScoped<CheckoutService>();
builder.Services.AddScoped<TreasuryService>();
builder.Services.AddScoped<ReconciliationService>();
builder.Services.AddScoped<FxService>();
builder.Services.AddScoped<WalletService>();
builder.Services.AddScoped<ScreeningService>();
builder.Services.AddScoped<MonitoringService>();
builder.Services.AddScoped<ComplianceService>();
builder.Services.AddScoped<FundFlowService>();
builder.Services.AddScoped<IdentityService>();
builder.Services.AddScoped<MerchantService>();
builder.Services.AddScoped<ReportsService>();
builder.Services.AddScoped<OutboxProcessor>();
builder.Services.AddScoped<WebhookSender>();
builder.Services.AddScoped<Notifier>();
builder.Services.AddScoped<CopilotService>();
builder.Services.AddHttpClient("anthropic", c => c.Timeout = TimeSpan.FromSeconds(60));

var app = builder.Build();

ProductionGuard.Check(app.Environment, config);

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
    if (args.Contains("--reset")) { await db.Database.EnsureDeletedAsync(); }
    await DbInit.Initialize(db);
}
if (args.Contains("seed"))
{
    if (app.Environment.IsProduction()) throw new InvalidOperationException("Refusing to seed demo data in Production.");
    await DemoSeed.Run(app.Services);
    return;
}

app.UseMiddleware<ErrorMiddleware>();
app.UseCors();
app.UseMiddleware<AuthMiddleware>();
app.UseRateLimiter();
app.UseMiddleware<RequestLogMiddleware>();
app.UseMiddleware<IdempotencyMiddleware>();

app.MapOpenApi("/openapi/{documentName}.json");
app.MapGet("/health", async (AppDb db) => new { status = await db.Database.CanConnectAsync() ? "ok" : "degraded", time = DateTime.UtcNow }).ExcludeFromDescription();
app.MapGet("/v1/meta", async (AppDb db) => new
{
    api_version = "2026-09-30",
    environment = app.Environment.EnvironmentName,
    currencies = Money.All.Select(c => new { c.Code, c.Exponent, rounding = c.Rounding.ToString(), c.Symbol }),
    countries = await db.Countries.OrderBy(c => c.Name).ToListAsync(),
    test_cards = SimulatorProvider.TestCards.Select(c => new { number = c.Key, behavior = c.Value.Behavior, brand = c.Value.Brand, country = c.Value.Country }),
    test_upi = SimulatorProvider.TestUpi,
}).WithTags("Meta");

AccountEndpoints.Map(app);
CommerceEndpoints.Map(app);
MoneyEndpoints.Map(app);
WalletEndpoints.Map(app);
AdminEndpoints.Map(app);
TestHelperEndpoints.Map(app);
CopilotEndpoints.Map(app);

app.Run();

public partial class Program;

/// <summary>Refuses to boot a production deployment that is still wired to sandbox components.</summary>
public static class ProductionGuard
{
    public static void Check(IWebHostEnvironment env, IConfiguration config)
    {
        if (!env.IsProduction()) return;
        var problems = new List<string>();
        if (config["Security:EncryptionKeys:dev"] != null) problems.Add("the development encryption key is still configured");
        if ((config.GetConnectionString("Default") ?? "").Contains("paymentapp.db")) problems.Add("the database is the local SQLite development file");
        if (config["Security:PortalTokenSecret"]?.StartsWith("dev-") == true) problems.Add("the portal token secret is the development value");
        if (problems.Count > 0) throw new InvalidOperationException("Refusing to start in Production: " + string.Join("; ", problems) + ".");
    }
}
