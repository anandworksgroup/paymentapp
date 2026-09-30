using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;

namespace PaymentApp.Api.Modules.Payments;

public record ProviderCharge(string ProviderId, string Token, long Amount, string Currency, string InternalReference, bool OffSession, bool ForceChallenge);

public record ProviderResult(
    string Status, // succeeded | requires_action | processing | failed | unavailable
    string? ProviderTransactionId = null,
    string? ErrorCode = null,
    long Fee = 0,
    int LatencyMs = 0,
    string? NextActionUrl = null,
    string? ThreeDsResult = null,
    string? Brand = null,
    string? Last4 = null,
    string? CardCountry = null,
    string? Behavior = null);

/// <summary>
/// Common provider abstraction (§71). Merchant-facing APIs never see a provider type; swapping or adding
/// a PSP means implementing this interface and registering the provider row.
/// </summary>
public interface IPaymentProvider
{
    string Kind { get; }
    Task<ProviderResult> Authorize(Provider provider, ProviderCharge charge, bool capture);
    Task<ProviderResult> Capture(Provider provider, string providerTransactionId, long amount);
    Task<ProviderResult> Void(Provider provider, string providerTransactionId);
    Task<ProviderResult> CompleteAuthentication(Provider provider, string providerTransactionId, bool passed);
    Task<ProviderResult> Refund(Provider provider, string providerTransactionId, long amount, string currency, string internalReference);
    Task<ProviderResult> GetPayment(Provider provider, string providerTransactionId);
    Task<SimCardToken?> DescribeToken(string token);
    bool VerifyWebhookSignature(Provider provider, string payload, string signature);
}

/// <summary>
/// Sandbox PSP. Behaves like an external processor with its own records (sim_provider_records), its own
/// fees, 3-D Secure, async methods and outages, driven by published test card numbers (§60, §274).
/// </summary>
public class SimulatorProvider(IServiceScopeFactory scopes, IClock clock, IConfiguration config) : IPaymentProvider
{
    public string Kind => "simulator";

    public static readonly Dictionary<string, (string Behavior, string Brand, string Country)> TestCards = new()
    {
        ["4242424242424242"] = ("success", "visa", "US"),
        ["5555555555554444"] = ("success", "mastercard", "US"),
        ["4000003560000008"] = ("success", "visa", "IN"),
        ["4000008260000000"] = ("success", "visa", "GB"),
        ["4000000000000002"] = ("card_declined", "visa", "US"),
        ["4000000000009995"] = ("insufficient_funds", "visa", "US"),
        ["4000000000000069"] = ("expired_card", "visa", "US"),
        ["4000002500003155"] = ("requires_action", "visa", "US"),
        ["4000000000000259"] = ("dispute", "visa", "US"),
        ["4000000000000119"] = ("processing_error", "visa", "US"),
        ["4000000000000341"] = ("fail_after_attach", "visa", "US"),
    };

    public static readonly Dictionary<string, string> TestUpi = new()
    {
        ["success@upi"] = "success",
        ["pending@upi"] = "async_success",
        ["fail@upi"] = "upi_declined",
    };

    public async Task<ProviderResult> Authorize(Provider provider, ProviderCharge charge, bool capture)
    {
        var sw = Stopwatch.StartNew();
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        db.Tenant.EnterSystem();
        if (provider.ForceOutage)
            return new("unavailable", ErrorCode: "provider_unavailable", LatencyMs: 5000);
        var token = await db.SimTokens.FirstOrDefaultAsync(t => t.Id == charge.Token);
        if (token == null) return new("failed", ErrorCode: "invalid_token", LatencyMs: (int)sw.ElapsedMilliseconds);
        var behavior = token.Behavior;
        var baseResult = new ProviderResult("failed", Brand: token.Brand, Last4: token.Last4, CardCountry: token.Country, Behavior: behavior);

        // "fail_after_attach" cards work for the first charge and decline on later off-session renewals.
        if (behavior == "fail_after_attach")
            behavior = charge.OffSession ? "card_declined" : "success";

        switch (behavior)
        {
            case "processing_error":
                return baseResult with { Status = "unavailable", ErrorCode = "processing_error", LatencyMs = (int)sw.ElapsedMilliseconds };
            case "card_declined" or "insufficient_funds" or "expired_card" or "upi_declined":
                return baseResult with { ErrorCode = behavior, LatencyMs = (int)sw.ElapsedMilliseconds };
        }

        var reference = Ids.New(provider.Id == "sim_beta" ? "bch" : "ach", 16);
        var fee = Money.ApplyBps(charge.Amount, provider.FeeBps, charge.Currency) + ConvertFixed(provider.FeeFixedMinor, charge.Currency);
        var needsAction = behavior == "requires_action" || (charge.ForceChallenge && token.Type == "card");
        if (needsAction && charge.OffSession)
            return baseResult with { ErrorCode = "authentication_required", LatencyMs = (int)sw.ElapsedMilliseconds };

        var status = needsAction ? "requires_action" : behavior == "async_success" ? "processing" : capture ? "succeeded" : "authorized";
        db.SimProviderRecords.Add(new SimProviderRecord
        {
            Id = Ids.New("simrec"), CreatedAt = clock.UtcNow, ProviderId = provider.Id, Type = "charge", ProviderReference = reference,
            InternalReference = charge.InternalReference, Amount = charge.Amount, Fee = fee, Currency = charge.Currency, Status = status,
        });
        await db.SaveChangesAsync();
        return baseResult with
        {
            Status = status == "authorized" ? "succeeded" : status,
            ProviderTransactionId = reference,
            Fee = fee,
            LatencyMs = (int)sw.ElapsedMilliseconds + 40,
            NextActionUrl = needsAction ? $"/checkout/authenticate?provider_ref={reference}" : null,
        };
    }

    private long ConvertFixed(long usdMinor, string currency) =>
        currency == "USD" ? usdMinor : Money.Convert(usdMinor, "USD", currency, FxTable.MidRateE9("USD", currency));

    public async Task<ProviderResult> CompleteAuthentication(Provider provider, string providerTransactionId, bool passed)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        db.Tenant.EnterSystem();
        var rec = await db.SimProviderRecords.FirstOrDefaultAsync(r => r.ProviderReference == providerTransactionId);
        if (rec == null || rec.Status != "requires_action") return new("failed", ErrorCode: "invalid_state");
        rec.Status = passed ? "succeeded" : "failed";
        await db.SaveChangesAsync();
        return passed
            ? new("succeeded", providerTransactionId, Fee: rec.Fee, ThreeDsResult: "authenticated")
            : new("failed", providerTransactionId, ErrorCode: "authentication_failed", ThreeDsResult: "failed");
    }

    public Task<ProviderResult> Capture(Provider provider, string providerTransactionId, long amount) =>
        Task.FromResult(new ProviderResult("succeeded", providerTransactionId));

    public async Task<ProviderResult> Void(Provider provider, string providerTransactionId)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        db.Tenant.EnterSystem();
        var rec = await db.SimProviderRecords.FirstOrDefaultAsync(r => r.ProviderReference == providerTransactionId);
        if (rec != null) { rec.Status = "voided"; await db.SaveChangesAsync(); }
        return new("succeeded", providerTransactionId);
    }

    public async Task<ProviderResult> Refund(Provider provider, string providerTransactionId, long amount, string currency, string internalReference)
    {
        if (provider.ForceOutage) return new("unavailable", ErrorCode: "provider_unavailable");
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        db.Tenant.EnterSystem();
        var charge = await db.SimProviderRecords.FirstOrDefaultAsync(r => r.ProviderReference == providerTransactionId && r.Type == "charge");
        if (charge == null) return new("failed", ErrorCode: "charge_not_found");
        var existing = await db.SimProviderRecords.FirstOrDefaultAsync(r => r.InternalReference == internalReference && r.Type == "refund");
        if (existing != null) return new("succeeded", existing.ProviderReference); // provider-side idempotency
        var reference = Ids.New("re", 16);
        db.SimProviderRecords.Add(new SimProviderRecord
        {
            Id = Ids.New("simrec"), CreatedAt = clock.UtcNow, ProviderId = provider.Id, Type = "refund", ProviderReference = reference,
            InternalReference = internalReference, Amount = amount, Currency = currency, Status = "succeeded",
        });
        await db.SaveChangesAsync();
        return new("succeeded", reference);
    }

    public async Task<ProviderResult> GetPayment(Provider provider, string providerTransactionId)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        db.Tenant.EnterSystem();
        var rec = await db.SimProviderRecords.FirstOrDefaultAsync(r => r.ProviderReference == providerTransactionId);
        return rec == null ? new("failed", ErrorCode: "not_found") : new(rec.Status, rec.ProviderReference, Fee: rec.Fee);
    }

    public async Task<SimCardToken?> DescribeToken(string token)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        db.Tenant.EnterSystem();
        return await db.SimTokens.AsNoTracking().FirstOrDefaultAsync(t => t.Id == token);
    }

    public bool VerifyWebhookSignature(Provider provider, string payload, string signature)
    {
        var secret = config["Providers:SimulatorWebhookSecret"] ?? "sim_whsec_dev";
        return Crypto.FixedTimeEquals(Crypto.HmacSha256Hex(secret, payload), signature);
    }

    public static string SignWebhook(IConfiguration config, string payload) =>
        Crypto.HmacSha256Hex(config["Providers:SimulatorWebhookSecret"] ?? "sim_whsec_dev", payload);
}

/// <summary>
/// Payment router (§18, §287, §288). Chooses an ordered list of providers for an attempt using merchant
/// and platform routing rules, capability, and live provider health; the orchestrator fails over down
/// the list only on provider-side errors, never on issuer declines (§21).
/// </summary>
public class PaymentRouter(AppDb db, IClock clock)
{
    public record Candidate(Provider Provider, string Reason);

    public async Task<List<Candidate>> Candidates(string orgId, bool livemode, string? country, string currency, string method, string routingSeed)
    {
        var providers = await db.Providers.Where(p => p.Enabled && p.Livemode == livemode).ToListAsync();
        providers = providers.Where(p => Supports(p.CountriesCsv, country) && Supports(p.CurrenciesCsv, currency) && Supports(p.MethodsCsv, method)).ToList();
        if (providers.Count == 0) return [];

        var rules = await db.RoutingRules.Where(r => r.Enabled && (r.OrgId == null || r.OrgId == orgId)).ToListAsync();
        var matching = rules.Where(r => (r.Country == null || r.Country == country) && (r.Currency == null || r.Currency == currency) && (r.Method == null || r.Method == method))
            .OrderByDescending(r => r.OrgId != null).ThenBy(r => r.Priority).ToList();

        var ordered = new List<Candidate>();
        var bucket = (int)(Convert.ToUInt32(Crypto.Sha256Hex(routingSeed)[..8], 16) % 100);
        foreach (var rule in matching)
        {
            var p = providers.FirstOrDefault(x => x.Id == rule.ProviderId);
            if (p == null || ordered.Any(c => c.Provider.Id == p.Id)) continue;
            if (rule.Percent is { } pct && bucket >= pct) continue;
            ordered.Add(new(p, rule.OrgId != null ? $"merchant rule {rule.Id}" : $"platform rule {rule.Id}"));
        }
        foreach (var p in providers.OrderBy(p => HealthRank(p.HealthState)).ThenBy(p => p.Priority))
            if (ordered.All(c => c.Provider.Id != p.Id)) ordered.Add(new(p, $"default order (health {p.HealthState}, priority {p.Priority})"));

        // Unavailable providers go last rather than disappearing: if everything is down we still try.
        return ordered.OrderBy(c => c.Provider.HealthState == "UNAVAILABLE" ? 1 : 0).ToList();
    }

    private static int HealthRank(string s) => s switch { "HEALTHY" => 0, "DEGRADED" => 1, _ => 2 };

    private static bool Supports(string csv, string? value) =>
        csv == "*" || (value != null && csv.Split(',').Contains(value, StringComparer.OrdinalIgnoreCase));

    /// <summary>Records an outcome and recomputes provider health from the recent window (§72).</summary>
    public async Task RecordHealth(Provider provider, bool success, int latencyMs, string? errorType, string? country, string? method)
    {
        var tracked = await db.Providers.FirstAsync(p => p.Id == provider.Id);
        db.ProviderHealthSamples.Add(new ProviderHealthSample
        {
            Id = Ids.New("phs"), CreatedAt = clock.UtcNow, ProviderId = provider.Id, Success = success,
            Timeout = errorType == "provider_unavailable", LatencyMs = latencyMs, ErrorType = errorType, Country = country, Method = method,
        });
        await db.SaveChangesAsync();
        var since = clock.UtcNow.AddMinutes(-15);
        var window = await db.ProviderHealthSamples.Where(s => s.ProviderId == provider.Id && s.CreatedAt >= since)
            .OrderByDescending(s => s.CreatedAt).Take(50).ToListAsync();
        var failures = window.Count(s => !s.Success);
        var rate = window.Count == 0 ? 0 : failures * 100 / window.Count;
        var avgLatency = window.Count == 0 ? 0 : window.Average(s => s.LatencyMs);
        var state = window.Count >= 3 && rate >= 50 ? "UNAVAILABLE" : (window.Count >= 3 && rate >= 20) || avgLatency > 3000 ? "DEGRADED" : "HEALTHY";
        if (tracked.HealthState != state) { tracked.HealthState = state; tracked.HealthUpdatedAt = clock.UtcNow; }
        provider.HealthState = state;
        await db.SaveChangesAsync();
    }
}

/// <summary>Static sandbox FX table used where an FX provider adapter would be plugged in (§14).</summary>
public static class FxTable
{
    // Quote-currency units per 1 USD (sample rates, clearly not live market data).
    public static readonly Dictionary<string, long> UsdRatesE9 = new()
    {
        ["USD"] = 1_000_000_000,
        ["EUR"] = 920_000_000,
        ["GBP"] = 790_000_000,
        ["INR"] = 83_500_000_000,
        ["AUD"] = 1_520_000_000,
        ["CAD"] = 1_360_000_000,
        ["SGD"] = 1_340_000_000,
        ["AED"] = 3_672_500_000,
        ["BRL"] = 5_050_000_000,
        ["JPY"] = 149_800_000_000,
        ["BHD"] = 377_000_000,
    };

    public static long MidRateE9(string from, string to)
    {
        if (from == to) return 1_000_000_000;
        if (!UsdRatesE9.TryGetValue(from, out var f) || !UsdRatesE9.TryGetValue(to, out var t))
            throw ApiException.Invalid($"No FX rate for {from}->{to}.");
        return (long)((Int128)t * 1_000_000_000 / f);
    }

    public static long ToUsd(long amount, string currency) =>
        currency == "USD" ? amount : Money.Convert(amount, currency, "USD", MidRateE9(currency, "USD"));
}
