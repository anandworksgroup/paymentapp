using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Compliance;
using PaymentApp.Api.Modules.Ledger;

namespace PaymentApp.Api.Modules.Marketplace;

/// <summary>
/// Marketplace split settlement (§101). A platform merchant onboards sellers; a checkout for a seller
/// splits the net sale in the ledger at the moment of payment:
///   customer paid − tax (remitted by the MoR) − MoR fee − marketplace commission = seller share.
/// Refunds and chargebacks claw back the seller's proportional share; sellers settle and get paid out
/// from their own ledger accounts, never mixed with the merchant's balance.
/// </summary>
public class MarketplaceService(AppDb db, Uow uow, LedgerService ledger, ScreeningService screening, FieldEncryptor encryptor)
{
    public const string SellerPending = "seller_pending";
    public const string SellerAvailable = "seller_available";

    private Task<LedgerAccount> Account(string sellerId, string code, string currency, bool livemode) => ledger.Account("seller", sellerId, code, currency, livemode);

    public async Task<Seller> Onboard(string orgId, string name, string email, string country, string currency, int commissionBps)
    {
        if (string.IsNullOrWhiteSpace(name)) throw ApiException.Invalid("name is required.");
        if (commissionBps is < 0 or > 5000) throw ApiException.Invalid("commission_bps must be 0-5000.");
        var id = Ids.New("sel");
        var result = await screening.Screen("seller", id, name, null, country, "seller_onboarding");
        return await uow.Run(async () =>
        {
            var s = new Seller
            {
                Id = id, CreatedAt = uow.Now, OrgId = orgId, Name = name.Trim(), Email = email.Trim().ToLowerInvariant(), Country = country.ToUpperInvariant(),
                DefaultCurrency = Money.Normalize(currency), CommissionBps = commissionBps, ScreeningStatus = result.Result,
                // A clean screen activates immediately; a potential match waits for platform compliance review.
                Status = result.Result == "clear" ? "active" : "pending_verification",
            };
            db.Sellers.Add(s);
            uow.Audit("seller.onboard", "seller", s.Id, after: new { s.Name, s.Country, s.CommissionBps, s.Status });
            await Task.CompletedTask;
            return s;
        });
    }

    public async Task<Seller> SetPayoutAccount(string sellerId, string bankName, string currency, string accountNumber)
    {
        accountNumber = new string(accountNumber.Where(char.IsLetterOrDigit).ToArray()).ToUpperInvariant();
        if (accountNumber.Length is < 6 or > 34) throw ApiException.Invalid("account_number looks invalid.");
        return await uow.Run(async () =>
        {
            var s = await db.Sellers.FirstOrDefaultAsync(x => x.Id == sellerId) ?? throw ApiException.NotFound("seller");
            s.PayoutBankName = bankName;
            s.PayoutCurrency = Money.Normalize(currency);
            s.PayoutLast4 = accountNumber[^4..];
            s.PayoutAccountEnc = encryptor.Encrypt(accountNumber);
            uow.Audit("seller.payout_account", "seller", s.Id, after: new { bankName, last4 = s.PayoutLast4 });
            return s;
        });
    }

    /// <summary>Called inside the payment's unit of work, right after the MoR posting.</summary>
    public async Task Split(Payment p, CheckoutSession session, BalanceTransaction merchantTxn, int settlementDelayDays)
    {
        var seller = await db.Sellers.FirstOrDefaultAsync(s => s.Id == session.SellerId);
        if (seller == null) return;
        var sale = p.Amount - p.TaxAmount;
        var commission = Money.ApplyBps(sale, session.ApplicationFeeBps ?? seller.CommissionBps, p.Currency);
        var share = Math.Max(0, sale - p.FeeAmount - commission);
        p.SellerId = seller.Id;
        p.SellerAmount = share;
        p.ApplicationFeeAmount = commission;
        if (share == 0) return;
        var ltx = await ledger.Post("seller_split", $"seller_split:{p.Id}", $"Seller share of {p.Id} to {seller.Name}", "payment", p.Id, p.OrgId, p.Livemode,
        [
            Leg.Debit(await ledger.Merchant(p.OrgId, Accounts.MerchantPending, p.Currency, p.Livemode), share),
            Leg.Credit(await Account(seller.Id, SellerPending, p.Currency, p.Livemode), share),
        ]);
        merchantTxn.Net -= share;
        merchantTxn.SellerAmount = share;
        merchantTxn.Description += $"; {Money.Format(share, p.Currency)} to seller {seller.Name}";
        db.SellerBalanceTransactions.Add(new SellerBalanceTransaction
        {
            Id = Ids.New("stxn"), CreatedAt = uow.Now, OrgId = p.OrgId, Livemode = p.Livemode, SellerId = seller.Id, Type = "sale", Amount = share, Currency = p.Currency,
            Status = "pending", AvailableOn = uow.Now.AddDays(settlementDelayDays), SourceType = "payment", SourceId = p.Id, LedgerTransactionId = ltx.Id,
            Description = $"Sale {p.Id}: {Money.Format(sale, p.Currency)} − fees {Money.Format(p.FeeAmount, p.Currency)} − commission {Money.Format(commission, p.Currency)}",
        });
        uow.Emit("seller.payment_split", p);
    }

    /// <summary>
    /// Moves the seller's proportional share of a refund or chargeback back to the merchant, which bore
    /// the full debit (§101 seller disputes). <paramref name="reverse"/> undoes it when a dispute is won.
    /// </summary>
    public async Task Clawback(Payment p, long netAmountAffected, string type, string sourceType, string sourceId, bool reverse = false)
    {
        if (p.SellerId == null || p.SellerAmount == 0) return;
        var sale = p.Amount - p.TaxAmount;
        var portion = Money.Ratio(p.SellerAmount, netAmountAffected, Math.Max(1, sale), p.Currency);
        if (portion <= 0) return;
        var sellerAcct = await Account(p.SellerId, SellerAvailable, p.Currency, p.Livemode);
        var merchantAcct = await ledger.Merchant(p.OrgId, Accounts.MerchantAvailable, p.Currency, p.Livemode);
        var ltx = await ledger.Post($"seller_{type}", $"seller_{type}:{sourceId}", $"Seller share of {type} {sourceId}", sourceType, sourceId, p.OrgId, p.Livemode,
            reverse ? [Leg.Debit(merchantAcct, portion), Leg.Credit(sellerAcct, portion)] : [Leg.Debit(sellerAcct, portion), Leg.Credit(merchantAcct, portion)]);
        db.SellerBalanceTransactions.Add(new SellerBalanceTransaction
        {
            Id = Ids.New("stxn"), CreatedAt = uow.Now, OrgId = p.OrgId, Livemode = p.Livemode, SellerId = p.SellerId, Type = type, Amount = reverse ? portion : -portion,
            Currency = p.Currency, Status = "available", AvailableOn = uow.Now, SourceType = sourceType, SourceId = sourceId, LedgerTransactionId = ltx.Id,
            Description = $"{(reverse ? "Returned" : "Share of")} {type} on {p.Id}",
        });
    }

    public async Task<int> SettleSellers(DateTime now)
    {
        List<SellerBalanceTransaction> due;
        using (db.Tenant.Elevate())
            due = await db.SellerBalanceTransactions.AsNoTracking().Where(t => t.Status == "pending" && t.AvailableOn <= now).Take(500).ToListAsync();
        foreach (var snapshot in due)
        {
            using var _ = db.Tenant.Use(snapshot.OrgId, snapshot.Livemode);
            await uow.Run(async () =>
            {
                var t = await db.SellerBalanceTransactions.FirstAsync(x => x.Id == snapshot.Id);
                if (t.Status != "pending") return;
                await ledger.Post("seller_settlement", $"seller_settle:{t.Id}", $"Seller funds available ({t.SourceId})", t.SourceType, t.SourceId, t.OrgId, t.Livemode,
                [
                    Leg.Debit(await Account(t.SellerId, SellerPending, t.Currency, t.Livemode), t.Amount),
                    Leg.Credit(await Account(t.SellerId, SellerAvailable, t.Currency, t.Livemode), t.Amount),
                ], t.LedgerTransactionId);
                t.Status = "available";
            });
        }
        return due.Count;
    }

    public async Task<object> Balance(string sellerId, bool livemode)
    {
        var accounts = await db.LedgerAccounts.Where(a => a.OwnerType == "seller" && a.OwnerId == sellerId && a.Livemode == livemode).ToListAsync();
        var list = new List<object>();
        foreach (var currency in accounts.Select(a => a.Currency).Distinct())
        {
            async Task<long> Of(string code) { var a = accounts.FirstOrDefault(x => x.Code == code && x.Currency == currency); return a == null ? 0 : await ledger.Balance(a); }
            list.Add(new { currency, pending = await Of(SellerPending), available = await Of(SellerAvailable) });
        }
        return new { @object = "seller_balance", seller = sellerId, balances = list, source = "ledger" };
    }

    public async Task<SellerPayout> CreatePayout(string sellerId, bool livemode, string currency)
    {
        return await uow.Run(async () =>
        {
            var s = await db.Sellers.FirstOrDefaultAsync(x => x.Id == sellerId) ?? throw ApiException.NotFound("seller");
            if (s.Status != "active") throw new ApiException(403, "seller_not_active", "Payouts are available once the seller is active.");
            if (s.PayoutLast4 == null || s.PayoutCurrency != currency) throw new ApiException(400, "no_payout_destination", $"Add a {currency} payout account for this seller first.");
            var available = await ledger.Balance(await Account(s.Id, SellerAvailable, currency, livemode));
            if (available <= 0) throw new ApiException(400, "insufficient_balance", "The seller has no available balance.");
            var payout = new SellerPayout { Id = Ids.New("spo"), CreatedAt = uow.Now, SellerId = s.Id, Amount = available, Currency = currency, BankLast4 = s.PayoutLast4 };
            db.SellerPayouts.Add(payout);
            var ltx = await ledger.Post("seller_payout", $"seller_payout:{payout.Id}", $"Seller payout {payout.Id} to ****{s.PayoutLast4}", "seller_payout", payout.Id, s.OrgId, livemode,
            [
                Leg.Debit(await Account(s.Id, SellerAvailable, currency, livemode), available),
                Leg.Credit(await ledger.Platform(Accounts.PayoutClearing, currency, livemode), available),
            ]);
            payout.LedgerTransactionId = ltx.Id;
            db.SellerBalanceTransactions.Add(new SellerBalanceTransaction
            {
                Id = Ids.New("stxn"), CreatedAt = uow.Now, SellerId = s.Id, Type = "payout", Amount = -available, Currency = currency, Status = "available",
                AvailableOn = uow.Now, SourceType = "seller_payout", SourceId = payout.Id, LedgerTransactionId = ltx.Id, PayoutId = payout.Id, Description = "Payout to bank",
            });
            uow.Emit("seller.payout_created", payout);
            uow.Audit("seller.payout", "seller_payout", payout.Id, after: new { available, currency }, orgId: s.OrgId);
            return payout;
        });
    }

    /// <summary>Sandbox bank rail: PENDING → PROCESSING → PAID (accounts ending 0000 are returned).</summary>
    public async Task<int> ProcessPayouts()
    {
        List<SellerPayout> open;
        using (db.Tenant.Elevate())
            open = await db.SellerPayouts.AsNoTracking().Where(p => p.Status == "PENDING" || p.Status == "PROCESSING").Take(200).ToListAsync();
        foreach (var snapshot in open)
        {
            using var _ = db.Tenant.Use(snapshot.OrgId, snapshot.Livemode);
            await uow.Run(async () =>
            {
                var p = await db.SellerPayouts.FirstAsync(x => x.Id == snapshot.Id);
                if (p.Status == "PENDING") { uow.Transition("seller_payout", p.Id, "PENDING", "PROCESSING", p.OrgId); p.Status = "PROCESSING"; return; }
                var clearing = await ledger.Platform(Accounts.PayoutClearing, p.Currency, p.Livemode);
                if (p.BankLast4 == "0000")
                {
                    var ltx = await ledger.Post("seller_payout_failure", $"seller_payout_failed:{p.Id}", $"Seller payout {p.Id} returned", "seller_payout", p.Id, p.OrgId, p.Livemode,
                    [
                        Leg.Debit(clearing, p.Amount),
                        Leg.Credit(await Account(p.SellerId, SellerAvailable, p.Currency, p.Livemode), p.Amount),
                    ], p.LedgerTransactionId);
                    db.SellerBalanceTransactions.Add(new SellerBalanceTransaction
                    {
                        Id = Ids.New("stxn"), CreatedAt = uow.Now, OrgId = p.OrgId, Livemode = p.Livemode, SellerId = p.SellerId, Type = "payout_failure", Amount = p.Amount,
                        Currency = p.Currency, Status = "available", AvailableOn = uow.Now, SourceType = "seller_payout", SourceId = p.Id, LedgerTransactionId = ltx.Id, Description = "Payout returned",
                    });
                    uow.Transition("seller_payout", p.Id, "PROCESSING", "FAILED", p.OrgId, "bank returned");
                    p.Status = "FAILED";
                    p.FailureReason = "The receiving bank returned the payout.";
                    uow.Emit("seller.payout_failed", p);
                    return;
                }
                await ledger.Post("seller_payout_paid", $"seller_payout_paid:{p.Id}", $"Seller payout {p.Id} paid", "seller_payout", p.Id, p.OrgId, p.Livemode,
                [
                    Leg.Debit(clearing, p.Amount),
                    Leg.Credit(await ledger.Platform(Accounts.PlatformBank, p.Currency, p.Livemode), p.Amount),
                ], p.LedgerTransactionId);
                uow.Transition("seller_payout", p.Id, "PROCESSING", "PAID", p.OrgId);
                p.Status = "PAID";
                p.PaidAt = uow.Now;
                uow.Emit("seller.payout_paid", p);
            });
        }
        return open.Count;
    }
}
