using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;

namespace PaymentApp.Api.Modules.Ledger;

/// <summary>Chart of accounts (§41, §121). Codes are stable; accounts are created lazily per owner and currency.</summary>
public static class Accounts
{
    // Platform
    public static string ProviderClearing(string providerId) => $"provider_clearing.{providerId}";
    public const string PlatformBank = "platform_bank";
    public const string SafeguardingBank = "safeguarding_bank";
    public static string TaxPayable(string country) => $"tax_payable.{country}";
    public const string FeeRevenue = "platform_revenue.fees";
    public const string FxRevenue = "platform_revenue.fx";
    public const string ProcessorFees = "processor_fees";
    public const string FxClearing = "fx_clearing";
    public const string PayoutClearing = "payout_clearing";
    public const string ChargebackLosses = "chargeback_losses";
    public const string Adjustments = "manual_adjustments";
    // Merchant (liabilities the platform owes the merchant)
    public const string MerchantPending = "merchant_pending";
    public const string MerchantAvailable = "merchant_available";
    public const string MerchantReserve = "merchant_reserve";
    // Wallet
    public const string Wallet = "wallet";
    /// <summary>Wallet rails in this build are simulated, so wallet postings are test-mode postings.</summary>
    public const bool WalletLivemode = false;

    public static string KindOf(string code) => code switch
    {
        _ when code.StartsWith("provider_clearing") => "asset",
        PlatformBank or SafeguardingBank => "asset",
        ProcessorFees or ChargebackLosses => "expense",
        FeeRevenue or FxRevenue => "revenue",
        Adjustments => "equity",
        // FX clearing is the platform's position in each currency: treated as an asset (may go negative).
        FxClearing => "asset",
        _ => "liability",
    };
}

public record Leg(LedgerAccount Account, char Direction, long Amount)
{
    public static Leg Debit(LedgerAccount a, long amount) => new(a, 'D', amount);
    public static Leg Credit(LedgerAccount a, long amount) => new(a, 'C', amount);
}

/// <summary>
/// Append-only double-entry ledger (§40). Postings are validated to balance per currency, are idempotent
/// by posting key, and can only be corrected by a reversing transaction (§278, §337). The database also
/// refuses UPDATE/DELETE on ledger rows via triggers.
/// </summary>
public class LedgerService(AppDb db, Uow uow)
{
    private readonly Dictionary<string, LedgerAccount> _cache = new();

    public async Task<LedgerAccount> Account(string ownerType, string? ownerId, string code, string currency, bool livemode)
    {
        var cacheKey = $"{ownerType}|{ownerId}|{code}|{currency}|{livemode}";
        if (_cache.TryGetValue(cacheKey, out var cached)) return cached;
        var acct = await db.LedgerAccounts.FirstOrDefaultAsync(a => a.OwnerType == ownerType && a.OwnerId == ownerId && a.Code == code && a.Currency == currency && a.Livemode == livemode);
        if (acct == null)
        {
            acct = new LedgerAccount
            {
                Id = Ids.New("la"), CreatedAt = uow.Now, OwnerType = ownerType, OwnerId = ownerId, Code = code,
                Currency = currency, Livemode = livemode, Kind = Accounts.KindOf(code),
            };
            db.LedgerAccounts.Add(acct);
            await db.SaveChangesAsync();
        }
        _cache[cacheKey] = acct;
        return acct;
    }

    public Task<LedgerAccount> Platform(string code, string currency, bool livemode) => Account("platform", null, code, currency, livemode);
    public Task<LedgerAccount> Merchant(string orgId, string code, string currency, bool livemode) => Account("org", orgId, code, currency, livemode);
    public Task<LedgerAccount> WalletAccount(string walletId, string currency) => Account("wallet", walletId, Accounts.Wallet, currency, Accounts.WalletLivemode);

    public async Task<LedgerTransaction> Post(string type, string postingKey, string description, string sourceType, string sourceId,
        string? orgId, bool livemode, IEnumerable<Leg> legs, string? parentId = null, string? reversesId = null)
    {
        if (!uow.InTransaction) throw new InvalidOperationException("Ledger postings must run inside a unit of work.");
        var existing = await db.LedgerTransactions.FirstOrDefaultAsync(t => t.PostingKey == postingKey);
        if (existing != null) return existing; // idempotent: the same business event never posts twice

        var list = legs.Where(l => l.Amount != 0).ToList();
        if (list.Count < 2) throw new InvalidOperationException($"Posting {postingKey} needs at least two legs.");
        foreach (var l in list)
        {
            if (l.Amount < 0) throw new InvalidOperationException($"Negative leg amount in {postingKey}.");
            if (l.Account.Livemode != livemode) throw new InvalidOperationException($"Mode mismatch in {postingKey}.");
        }
        foreach (var byCurrency in list.GroupBy(l => l.Account.Currency))
        {
            var debits = byCurrency.Where(l => l.Direction == 'D').Sum(l => l.Amount);
            var credits = byCurrency.Where(l => l.Direction == 'C').Sum(l => l.Amount);
            if (debits != credits)
                throw new InvalidOperationException($"Unbalanced posting {postingKey} in {byCurrency.Key}: debits {debits} != credits {credits}.");
        }

        var tx = new LedgerTransaction
        {
            Id = Ids.New("ltx"), CreatedAt = uow.Now, EffectiveAt = uow.Now, Type = type, Description = description,
            OrgId = orgId, Livemode = livemode, SourceType = sourceType, SourceId = sourceId, PostingKey = postingKey,
            ParentTransactionId = parentId, ReversesTransactionId = reversesId, RequestId = uow.Ctx.RequestId, ActorId = uow.Ctx.ActorId,
        };
        db.LedgerTransactions.Add(tx);
        foreach (var l in list)
        {
            db.LedgerEntries.Add(new LedgerEntry
            {
                Id = Ids.New("le"), CreatedAt = uow.Now, TransactionId = tx.Id, AccountId = l.Account.Id,
                Direction = l.Direction.ToString(), Amount = l.Amount, Currency = l.Account.Currency,
            });
        }
        await db.SaveChangesAsync();
        return tx;
    }

    /// <summary>Compensating entry: mirror every leg of the original (§278).</summary>
    public async Task<LedgerTransaction> Reverse(LedgerTransaction original, string reason)
    {
        var entries = await db.LedgerEntries.Where(e => e.TransactionId == original.Id).ToListAsync();
        var accounts = await db.LedgerAccounts.Where(a => entries.Select(e => e.AccountId).Contains(a.Id)).ToDictionaryAsync(a => a.Id);
        var legs = entries.Select(e => new Leg(accounts[e.AccountId], e.Direction == "D" ? 'C' : 'D', e.Amount));
        return await Post("reversal", $"reverse:{original.Id}", $"Reversal of {original.Id}: {reason}", original.SourceType, original.SourceId,
            original.OrgId, original.Livemode, legs, original.ParentTransactionId, original.Id);
    }

    /// <summary>Natural-sign balance: credit-normal accounts report credits − debits.</summary>
    public async Task<long> Balance(LedgerAccount account, DateTime? asOf = null)
    {
        var q = db.LedgerEntries.Where(e => e.AccountId == account.Id);
        if (asOf != null) q = q.Where(e => e.CreatedAt <= asOf);
        var debits = await q.Where(e => e.Direction == "D").SumAsync(e => (long?)e.Amount) ?? 0;
        var credits = await q.Where(e => e.Direction == "C").SumAsync(e => (long?)e.Amount) ?? 0;
        return IsDebitNormal(account.Kind) ? debits - credits : credits - debits;
    }

    public static bool IsDebitNormal(string kind) => kind is "asset" or "expense";

    public async Task<long> MerchantBalance(string orgId, string code, string currency, bool livemode)
    {
        var acct = await db.LedgerAccounts.FirstOrDefaultAsync(a => a.OwnerType == "org" && a.OwnerId == orgId && a.Code == code && a.Currency == currency && a.Livemode == livemode);
        return acct == null ? 0 : await Balance(acct);
    }

    /// <summary>Platform-wide integrity check: every transaction balances and the trial balance nets to zero per currency.</summary>
    public static async Task<object> VerifyIntegrity(AppDb db)
    {
        var unbalanced = await db.LedgerEntries
            .GroupBy(e => new { e.TransactionId, e.Currency })
            .Select(g => new
            {
                g.Key.TransactionId, g.Key.Currency,
                Debits = g.Where(e => e.Direction == "D").Sum(e => e.Amount),
                Credits = g.Where(e => e.Direction == "C").Sum(e => e.Amount),
            })
            .Where(x => x.Debits != x.Credits)
            .ToListAsync();
        var trial = await db.LedgerEntries.GroupBy(e => e.Currency)
            .Select(g => new
            {
                Currency = g.Key,
                Debits = g.Where(e => e.Direction == "D").Sum(e => e.Amount),
                Credits = g.Where(e => e.Direction == "C").Sum(e => e.Amount),
            }).ToListAsync();
        var transactions = await db.LedgerTransactions.CountAsync();
        return new
        {
            balanced = unbalanced.Count == 0 && trial.All(t => t.Debits == t.Credits),
            transactions_checked = transactions,
            unbalanced_transactions = unbalanced,
            trial_balance = trial,
        };
    }
}
