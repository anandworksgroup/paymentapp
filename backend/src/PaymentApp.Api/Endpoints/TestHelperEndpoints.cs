using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Payments;
using PaymentApp.Api.Modules.Payouts;
using PaymentApp.Api.Modules.Platform;

namespace PaymentApp.Api.Endpoints;

public record OutcomeRequest(string Outcome);

/// <summary>
/// Sandbox controls (§60, §61): drive provider-side events and background jobs on demand. Test mode only,
/// and disabled entirely in Production.
/// </summary>
public static class TestHelperEndpoints
{
    public static void Map(WebApplication app)
    {
        if (app.Environment.IsProduction() && !app.Configuration.GetValue("TestHelpers:Enabled", false)) return;
        var t = app.MapGroup("/v1/test_helpers").WithTags("Sandbox test helpers");

        static void RequireTestMode(RequestContext ctx)
        {
            if (ctx.User?.PlatformRole == "SUPER_ADMIN" && ctx.OrgId == null) return;
            ctx.RequireOrg("developers.read");
            if (ctx.Livemode) throw ApiException.Forbidden("Test helpers only work in test mode.");
        }

        t.MapPost("/run_jobs", async (RequestContext ctx, JobRunner jobs) => { RequireTestMode(ctx); return await jobs.RunAll(); });
        t.MapPost("/balance/settle_now", async (RequestContext ctx, AppDb db, TreasuryService treasury, Modules.Marketplace.MarketplaceService market, IClock clock) =>
        {
            RequireTestMode(ctx);
            // Skip the settlement delay for this org's pending test funds (merchant and sellers), then run settlement.
            foreach (var bt in await db.BalanceTransactions.Where(b => b.Status == "pending" && !b.HeldForReview).ToListAsync()) bt.AvailableOn = clock.UtcNow;
            foreach (var st in await db.SellerBalanceTransactions.Where(b => b.Status == "pending").ToListAsync()) st.AvailableOn = clock.UtcNow;
            await db.SaveChangesAsync();
            return new { settled = await treasury.Settle(clock.UtcNow), sellers_settled = await market.SettleSellers(clock.UtcNow) };
        });
        t.MapPost("/payments/{id}/complete_async", async (string id, OutcomeRequest r, RequestContext ctx, AppDb db, PaymentService payments, IConfiguration config) =>
        {
            RequireTestMode(ctx);
            var p = await db.Payments.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("payment");
            if (p.Status != "PROCESSING" || p.ProviderTransactionId == null) throw ApiException.Conflict("invalid_state", "Only asynchronous payments that are still processing can be completed.");
            var rec = await db.SimProviderRecords.FirstAsync(x => x.ProviderReference == p.ProviderTransactionId);
            rec.Status = r.Outcome == "succeeded" ? "succeeded" : "failed";
            await db.SaveChangesAsync();
            var payload = Json.Serialize(new { id = Ids.New("simevt"), type = r.Outcome == "succeeded" ? "charge.succeeded" : "charge.failed", provider_transaction_id = p.ProviderTransactionId, fee = rec.Fee });
            await payments.HandleProviderWebhook(p.ProviderId!, payload, SimulatorProvider.SignWebhook(config, payload));
            return await db.Payments.FirstAsync(x => x.Id == id);
        });
        t.MapPost("/payments/{id}/dispute", async (string id, RequestContext ctx, AppDb db, PaymentService payments) =>
        {
            RequireTestMode(ctx);
            var p = await db.Payments.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("payment");
            if (p.AmountCaptured == 0) throw ApiException.Conflict("invalid_state", "Only captured payments can be disputed.");
            await payments.SimulateProviderDispute(p, "product_not_received");
            return await db.Disputes.Where(d => d.PaymentId == id).OrderByDescending(d => d.CreatedAt).FirstAsync();
        });
        t.MapPost("/disputes/{id}/close", async (string id, OutcomeRequest r, RequestContext ctx, AppDb db, PaymentService payments, IConfiguration config) =>
        {
            RequireTestMode(ctx);
            var d = await db.Disputes.FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("dispute");
            var p = await db.Payments.FirstAsync(x => x.Id == d.PaymentId);
            var payload = Json.Serialize(new { id = Ids.New("simevt"), type = "dispute.closed", provider_transaction_id = p.ProviderTransactionId, dispute_id = d.ProviderDisputeId, outcome = r.Outcome == "won" ? "won" : "lost" });
            await payments.HandleProviderWebhook(p.ProviderId!, payload, SimulatorProvider.SignWebhook(config, payload));
            return await db.Disputes.FirstAsync(x => x.Id == id);
        });
    }
}
