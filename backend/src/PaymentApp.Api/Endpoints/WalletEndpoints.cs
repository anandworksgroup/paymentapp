using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Wallet;

namespace PaymentApp.Api.Endpoints;

public record FundRequest(string Currency, long Amount, string Source = "bank_transfer");
public record FxQuoteRequest(string FromCurrency, string ToCurrency, long Amount);
public record SendMoneyRequest(string Recipient, string SourceCurrency, long Amount, string? DestinationCurrency, string? QuoteId, string? Purpose, string? Note, string? SourceOfFunds);
public record WithdrawRequest(string Currency, long Amount, string BankAccount, string? QuoteId);
public record BankAccountRequest(string Country, string Currency, string BankName, string AccountHolder, string AccountNumber, string? Routing);

public static class WalletEndpoints
{
    public static void Map(WebApplication app)
    {
        var w = app.MapGroup("/v1/wallet").WithTags("Wallet");
        w.MapGet("/", async (RequestContext ctx, WalletService wallets) =>
        {
            var user = ctx.RequireUser();
            var wallet = await wallets.ForUser(user, create: false);
            if (wallet == null) return (object)new { @object = "wallet", activated = false, kyc_level = user.KycLevel, kyc_status = user.KycStatus };
            return await wallets.Balances(wallet);
        });
        w.MapPost("/activate", async (RequestContext ctx, WalletService wallets) => await wallets.Balances(await wallets.ForUser(ctx.RequireUser())));
        w.MapPost("/fund", async (FundRequest r, RequestContext ctx, WalletService wallets) => await wallets.Fund(ctx.RequireUser(), r.Currency, r.Amount, r.Source))
            .RequireRateLimiting("financial");
        w.MapPost("/fx/quotes", async (FxQuoteRequest r, RequestContext ctx, FxService fx) => await fx.Quote(ctx.RequireUser().Id, r.FromCurrency, r.ToCurrency, r.Amount));
        w.MapGet("/recipients/lookup", async (HttpRequest req, RequestContext ctx, WalletService wallets, AppDb db) =>
        {
            ctx.RequireUser();
            var target = await wallets.ResolveRecipient(req.Query["q"].ToString());
            var name = target.OwnerType == "user" ? (await db.Users.FirstAsync(u => u.Id == target.OwnerId)).Name : (await db.Organizations.FirstAsync(o => o.Id == target.OwnerId)).Name;
            // Only a display name and handle: no email, country or balance leaks through lookup.
            return new { handle = target.Handle, display_name = MaskName(name), type = target.OwnerType };
        });
        w.MapPost("/transfers", async (SendMoneyRequest r, RequestContext ctx, WalletService wallets) =>
        {
            var user = ctx.RequireUser();
            var source = await wallets.ForUser(user, create: false) ?? throw ApiException.NotFound("wallet");
            return Results.Json(View(await wallets.Send(user, source, new SendRequest(r.Recipient, r.SourceCurrency, r.Amount, r.DestinationCurrency, r.QuoteId, r.Purpose, r.Note, r.SourceOfFunds)), source.Id), statusCode: 201);
        }).RequireRateLimiting("financial");
        w.MapPost("/withdrawals", async (WithdrawRequest r, RequestContext ctx, WalletService wallets) =>
        {
            var user = ctx.RequireUser();
            var t = await wallets.Withdraw(user, r.Currency, r.Amount, r.BankAccount, r.QuoteId);
            return Results.Json(View(t, t.SenderWalletId!), statusCode: 201);
        }).RequireRateLimiting("financial");
        w.MapGet("/transactions", async (HttpRequest req, RequestContext ctx, WalletService wallets, AppDb db) =>
        {
            var user = ctx.RequireUser();
            var wallet = await wallets.ForUser(user, create: false) ?? throw ApiException.NotFound("wallet");
            var list = await db.Transfers.Where(t => t.SenderWalletId == wallet.Id || t.RecipientWalletId == wallet.Id).OrderByDescending(t => t.CreatedAt)
                .Take(Math.Clamp(int.TryParse(req.Query["limit"], out var n) ? n : 50, 1, 200)).ToListAsync();
            var counterpartIds = list.SelectMany(t => new[] { t.SenderWalletId, t.RecipientWalletId }).Where(x => x != null && x != wallet.Id).Distinct().ToList();
            var handles = await db.Wallets.Where(x => counterpartIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, x => x.Handle);
            var banks = await db.BankAccounts.Where(b => list.Select(t => t.BankAccountId).Contains(b.Id)).ToDictionaryAsync(b => b.Id);
            return new
            {
                @object = "list",
                data = list.Select(t =>
                {
                    var outgoing = t.SenderWalletId == wallet.Id;
                    var counterparty = t.Type switch
                    {
                        "funding" => t.FundingSource == "card" ? "Card top-up" : "Bank transfer",
                        "withdrawal" => banks.TryGetValue(t.BankAccountId!, out var b) ? $"{b.BankName} ****{b.Last4}" : "Bank",
                        "merchant_proceeds" => "Merchant proceeds",
                        _ => handles.GetValueOrDefault((outgoing ? t.RecipientWalletId : t.SenderWalletId) ?? "", "wallet"),
                    };
                    return new
                    {
                        t.Id, t.Type, t.Status, direction = outgoing ? "out" : "in", counterparty,
                        amount = outgoing ? t.SourceAmount : t.DestinationAmount, currency = outgoing ? t.SourceCurrency : t.DestinationCurrency,
                        fee = outgoing ? t.FeeAmount : 0, fx = t.FxRateE9 == null ? null : new { rate = t.FxRateE9 / 1e9, from = t.SourceCurrency, to = t.DestinationCurrency, received = t.DestinationAmount },
                        message = t.CustomerMessage, t.Note, t.Purpose, t.CreatedAt, t.CompletedAt,
                    };
                }),
            };
        });
        w.MapGet("/transfers/{id}", async (string id, RequestContext ctx, WalletService wallets, AppDb db) =>
        {
            var user = ctx.RequireUser();
            var wallet = await wallets.ForUser(user, create: false) ?? throw ApiException.NotFound("wallet");
            var t = await db.Transfers.FirstOrDefaultAsync(x => x.Id == id && (x.SenderWalletId == wallet.Id || x.RecipientWalletId == wallet.Id)) ?? throw ApiException.NotFound("transfer");
            return View(t, wallet.Id);
        });
        w.MapGet("/bank_accounts", async (RequestContext ctx, AppDb db) =>
        {
            var user = ctx.RequireUser();
            return new { @object = "list", data = await db.BankAccounts.Where(b => b.OwnerType == "user" && b.OwnerId == user.Id && b.RemovedAt == null).ToListAsync() };
        });
        w.MapPost("/bank_accounts", async (BankAccountRequest r, RequestContext ctx, WalletService wallets) =>
        {
            var user = ctx.RequireUser();
            return Results.Json(await wallets.AddBankAccount("user", user.Id, user.Name, r.Country, r.Currency, r.BankName, r.AccountHolder, r.AccountNumber, r.Routing), statusCode: 201);
        });
        w.MapDelete("/bank_accounts/{id}", async (string id, RequestContext ctx, AppDb db, Uow uow) =>
        {
            var user = ctx.RequireUser();
            await uow.Run(async () =>
            {
                var b = await db.BankAccounts.FirstOrDefaultAsync(x => x.Id == id && x.OwnerId == user.Id) ?? throw ApiException.NotFound("bank account");
                b.RemovedAt = uow.Now;
                uow.Audit("bank_account.remove", "bank_account", b.Id);
            });
            return Results.NoContent();
        });
        w.MapGet("/limits", async (RequestContext ctx, AppDb db) =>
        {
            var user = ctx.RequireUser();
            var limits = await db.WalletLimits.Where(l => (l.Country == user.Country || l.Country == "*")).OrderBy(l => l.KycLevel).ToListAsync();
            return new { @object = "wallet_limits", kyc_level = user.KycLevel, currency = "USD", limits };
        });

        // Business wallet for merchant proceeds (§118).
        app.MapGet("/v1/business_wallet", async (RequestContext ctx, WalletService wallets, AppDb db) =>
        {
            var orgId = ctx.RequireOrg("wallet.read");
            var wallet = await db.Wallets.FirstOrDefaultAsync(x => x.OwnerType == "org" && x.OwnerId == orgId);
            return wallet == null ? new { @object = "wallet", activated = false } : await wallets.Balances(wallet);
        }).WithTags("Wallet");
    }

    private static string MaskName(string name)
    {
        var parts = name.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length <= 1 ? name : $"{parts[0]} {parts[^1][0]}.";
    }

    /// <summary>The customer's view (§224): amounts, FX, fees, neutral status message — never internal reasons.</summary>
    private static object View(Transfer t, string walletId) => new
    {
        t.Id, @object = "transfer", t.Type, t.Status, direction = t.SenderWalletId == walletId ? "out" : "in",
        t.SourceAmount, t.SourceCurrency, t.DestinationAmount, t.DestinationCurrency, t.FeeAmount,
        fx_rate = t.FxRateE9 == null ? (double?)null : t.FxRateE9.Value / 1e9, t.FxRateTimestamp, message = t.CustomerMessage, t.CreatedAt, t.CompletedAt,
    };
}
