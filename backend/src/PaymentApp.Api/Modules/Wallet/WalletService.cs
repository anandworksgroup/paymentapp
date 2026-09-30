using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Compliance;
using PaymentApp.Api.Modules.Ledger;
using PaymentApp.Api.Modules.Payments;

namespace PaymentApp.Api.Modules.Wallet;

public class FxService(AppDb db, Uow uow, IConfiguration config)
{
    public async Task<(long RateE9, DateTime AsOf, string Source)> MidRate(string from, string to)
    {
        if (from == to) return (1_000_000_000, uow.Now, "identity");
        async Task<FxRate?> Latest(string b, string q) => await db.FxRates.Where(r => r.Base == b && r.Quote == q).OrderByDescending(r => r.AsOf).FirstOrDefaultAsync();
        var direct = await Latest(from, to);
        if (direct != null) return (direct.RateE9, direct.AsOf, direct.Source);
        var a = await Latest("USD", from) ?? throw ApiException.Invalid($"No FX rate for {from}.");
        var b = await Latest("USD", to) ?? throw ApiException.Invalid($"No FX rate for {to}.");
        return ((long)((Int128)b.RateE9 * 1_000_000_000 / a.RateE9), a.AsOf < b.AsOf ? a.AsOf : b.AsOf, $"{a.Source} (cross via USD)");
    }

    /// <summary>A binding quote: the customer sees rate, spread, fee and exact received amount before confirming (§38).</summary>
    public async Task<FxQuote> Quote(string userId, string from, string to, long sourceAmount)
    {
        from = Money.Normalize(from);
        to = Money.Normalize(to);
        if (sourceAmount <= 0) throw ApiException.Invalid("amount must be positive.");
        var (mid, asOf, source) = await MidRate(from, to);
        var spreadBps = from == to ? 0 : config.GetValue("Wallet:FxSpreadBps", 50);
        var customerRate = mid - (long)((Int128)mid * spreadBps / 10_000);
        var midAmount = Money.Convert(sourceAmount, from, to, mid, RoundingMode.Down);
        var destAmount = Money.Convert(sourceAmount, from, to, customerRate, RoundingMode.Down);
        var q = new FxQuote
        {
            Id = Ids.New("fxq"), CreatedAt = uow.Now, UserId = userId, FromCurrency = from, ToCurrency = to, SourceAmount = sourceAmount,
            DestinationAmount = destAmount, MidRateE9 = mid, CustomerRateE9 = customerRate, SpreadBps = spreadBps, SpreadAmount = midAmount - destAmount,
            FeeAmount = TransferFee(sourceAmount, from, from != to), RateTimestamp = asOf, RateSource = source, ExpiresAt = uow.Now.AddMinutes(5),
        };
        db.FxQuotes.Add(q);
        await db.SaveChangesAsync();
        return q;
    }

    public long TransferFee(long amount, string currency, bool crossCurrency) =>
        crossCurrency ? Money.ApplyBps(amount, config.GetValue("Wallet:CrossCurrencyFeeBps", 30), currency) : 0;
}

public record SendRequest(string Recipient, string SourceCurrency, long Amount, string? DestinationCurrency, string? QuoteId, string? Purpose, string? Note, string? SourceOfFunds);

/// <summary>
/// Global Wallet (§29-§45): multi-currency balances held as ledger accounts, internal and cross-currency
/// transfers, funding and bank withdrawals. Every movement passes restrictions, limits, sanctions
/// screening and transaction monitoring before it is posted.
/// </summary>
public class WalletService(AppDb db, Uow uow, LedgerService ledger, FxService fx, ScreeningService screening, MonitoringService monitoring,
    FieldEncryptor encryptor, IConfiguration config)
{
    public async Task<Data.Wallet> ForUser(User user, bool create = true)
    {
        var w = await db.Wallets.FirstOrDefaultAsync(x => x.OwnerType == "user" && x.OwnerId == user.Id);
        if (w != null || !create) return w!;
        var country = user.Country == null ? null : await db.Countries.FirstOrDefaultAsync(c => c.Country == user.Country);
        if (country is { WalletEnabled: false }) throw new ApiException(403, "wallet_unavailable", "The wallet is not available in your country yet.");
        if (user.KycLevel < (country?.WalletKycLevelRequired ?? 1))
            throw new ApiException(403, "kyc_required", "Verify your identity to activate the wallet.");
        return await uow.Run(async () =>
        {
            var baseHandle = new string((user.Name.Split(' ')[0] + "").ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
            var wallet = new Data.Wallet
            {
                Id = Ids.New("wal"), CreatedAt = uow.Now, OwnerType = "user", OwnerId = user.Id,
                Handle = $"@{(baseHandle.Length == 0 ? "user" : baseHandle)}{Random.Shared.Next(1000, 9999)}",
                CurrenciesCsv = user.Country == "IN" ? "INR,USD" : user.Country is "DE" or "FR" ? "EUR,USD" : user.Country == "GB" ? "GBP,USD" : "USD",
            };
            db.Wallets.Add(wallet);
            uow.Audit("wallet.create", "wallet", wallet.Id);
            await Task.CompletedTask;
            return wallet;
        });
    }

    public async Task<Data.Wallet> ForOrg(string orgId)
    {
        var w = await db.Wallets.FirstOrDefaultAsync(x => x.OwnerType == "org" && x.OwnerId == orgId);
        if (w != null) return w;
        w = new Data.Wallet { Id = Ids.New("wal"), CreatedAt = uow.Now, OwnerType = "org", OwnerId = orgId, Handle = $"@biz{Random.Shared.Next(100000, 999999)}" };
        db.Wallets.Add(w);
        await db.SaveChangesAsync();
        return w;
    }

    public async Task<long> Available(Data.Wallet w, string currency)
    {
        var acct = await ledger.WalletAccount(w.Id, currency);
        var balance = await ledger.Balance(acct);
        var held = await db.WalletHolds.Where(h => h.WalletId == w.Id && h.Currency == currency && h.Status == "active").SumAsync(h => (long?)h.Amount) ?? 0;
        return balance - held;
    }

    public async Task<object> Balances(Data.Wallet w)
    {
        var codes = await db.LedgerAccounts.Where(a => a.OwnerType == "wallet" && a.OwnerId == w.Id).Select(a => a.Currency).ToListAsync();
        var currencies = codes.Union(w.CurrenciesCsv.Split(',', StringSplitOptions.RemoveEmptyEntries)).Distinct().OrderBy(c => c).ToList();
        var list = new List<object>();
        long totalUsd = 0;
        foreach (var c in currencies)
        {
            var ledgerBalance = await ledger.Balance(await ledger.WalletAccount(w.Id, c));
            var held = await db.WalletHolds.Where(h => h.WalletId == w.Id && h.Currency == c && h.Status == "active").SumAsync(h => (long?)h.Amount) ?? 0;
            var pendingIn = await db.Transfers.Where(t => t.RecipientWalletId == w.Id && t.DestinationCurrency == c && (t.Status == "HELD" || t.Status == "PENDING" || t.Status == "PROCESSING" || t.Status == "SCREENING")).SumAsync(t => (long?)t.DestinationAmount) ?? 0;
            totalUsd += FxTable.ToUsd(ledgerBalance, c);
            list.Add(new { currency = c, available = ledgerBalance - held, held, pending_incoming = pendingIn, ledger_balance = ledgerBalance });
        }
        return new { @object = "wallet_balances", wallet = w.Id, handle = w.Handle, status = w.Status, balances = list, estimated_total_usd = totalUsd, estimate_note = "Estimated at mid-market reference rates." };
    }

    private void EnsureCanMove(User user, Data.Wallet w, string kind)
    {
        if (w.Status != "active") throw new ApiException(403, "wallet_restricted", "This wallet requires additional review. Contact support.");
        var blocked = user.Status switch
        {
            "FROZEN" or "CLOSED" or "COMPLIANCE_HOLD" => true,
            "TRANSFERS_DISABLED" => kind == "transfer",
            "WITHDRAWALS_DISABLED" => kind == "withdrawal",
            "LIMITED" => kind == "withdrawal",
            _ => false,
        };
        if (blocked) throw new ApiException(403, "account_restricted", "This action is unavailable while your account is under review.");
    }

    /// <summary>Configurable limits by country, KYC level and type, measured in USD (§42).</summary>
    private async Task EnforceLimits(User user, Data.Wallet w, string type, long amount, string currency)
    {
        var limits = await db.WalletLimits.ToListAsync();
        var limit = limits.Where(l => (l.Country == user.Country || l.Country == "*") && l.KycLevel <= user.KycLevel && (l.TransferType == type || l.TransferType == "*"))
            .OrderByDescending(l => l.KycLevel).ThenByDescending(l => l.Country != "*").ThenByDescending(l => l.TransferType != "*").FirstOrDefault()
            ?? throw new ApiException(403, "kyc_required", "Verify your identity to use this feature.");
        var usd = FxTable.ToUsd(amount, currency);
        if (usd > limit.PerTransactionUsd)
            throw new ApiException(400, "limit_exceeded", $"This exceeds your per-transaction limit of {Money.Format(limit.PerTransactionUsd, "USD")}. Verify further to raise it.");
        var day = uow.Now.AddDays(-1);
        var month = uow.Now.AddDays(-30);
        var outgoing = await db.Transfers.Where(t => t.SenderWalletId == w.Id && t.Type == type && t.Status != "FAILED" && t.Status != "CANCELLED" && t.Status != "RETURNED" && t.CreatedAt >= month).ToListAsync();
        var dayUsd = outgoing.Where(t => t.CreatedAt >= day).Sum(t => FxTable.ToUsd(t.SourceAmount, t.SourceCurrency)) + usd;
        var monthUsd = outgoing.Sum(t => FxTable.ToUsd(t.SourceAmount, t.SourceCurrency)) + usd;
        if (dayUsd > limit.DailyUsd) throw new ApiException(400, "limit_exceeded", $"This exceeds your daily limit of {Money.Format(limit.DailyUsd, "USD")}.");
        if (monthUsd > limit.MonthlyUsd) throw new ApiException(400, "limit_exceeded", $"This exceeds your 30-day limit of {Money.Format(limit.MonthlyUsd, "USD")}.");
    }

    private async Task EnforceMaxBalance(User user, Data.Wallet w, long incoming, string currency)
    {
        var limit = (await db.WalletLimits.ToListAsync()).Where(l => (l.Country == user.Country || l.Country == "*") && l.KycLevel <= user.KycLevel)
            .OrderByDescending(l => l.KycLevel).FirstOrDefault();
        if (limit == null) return;
        var current = await ledger.Balance(await ledger.WalletAccount(w.Id, currency));
        if (FxTable.ToUsd(current + incoming, currency) > limit.MaxBalanceUsd)
            throw new ApiException(400, "balance_limit", $"This would exceed the maximum wallet balance of {Money.Format(limit.MaxBalanceUsd, "USD")} for your verification level.");
    }

    // ───────────────────────── Funding (§32) ─────────────────────────

    public async Task<Transfer> Fund(User user, string currency, long amount, string source)
    {
        currency = Money.Normalize(currency);
        if (amount <= 0) throw ApiException.Invalid("amount must be positive.");
        if (source is not ("bank_transfer" or "card")) throw ApiException.Invalid("source must be bank_transfer or card (sandbox rails).");
        var w = await ForUser(user);
        EnsureCanMove(user, w, "funding");
        await EnforceLimits(user, w, "funding", amount, currency);
        await EnforceMaxBalance(user, w, amount, currency);
        return await uow.Run(async () =>
        {
            var t = NewTransfer("funding", user, null, w.Id, currency, amount, currency, amount);
            t.FundingSource = source;
            t.Rail = source == "card" ? "sandbox_card" : "sandbox_bank_transfer";
            t.SenderCountry = user.Country;
            t.RecipientCountry = user.Country;
            db.Transfers.Add(t);
            var outcome = await monitoring.Evaluate(t, user);
            if (outcome.Hold) { await Hold(t, null, outcome.Reason); return t; }
            await PostFunding(t, w);
            return t;
        });
    }

    private async Task PostFunding(Transfer t, Data.Wallet w)
    {
        var ltx = await ledger.Post("wallet_funding", $"transfer:{t.Id}", $"Wallet funded via {t.FundingSource}", "transfer", t.Id, null, Accounts.WalletLivemode,
        [
            Leg.Debit(await ledger.Platform(Accounts.SafeguardingBank, t.DestinationCurrency, Accounts.WalletLivemode), t.DestinationAmount),
            Leg.Credit(await ledger.WalletAccount(w.Id, t.DestinationCurrency), t.DestinationAmount),
        ]);
        Complete(t, ltx.Id, "Money added to your wallet.");
    }

    // ───────────────────────── Send (§34-§37) ─────────────────────────

    public async Task<Data.Wallet> ResolveRecipient(string recipient)
    {
        recipient = recipient.Trim();
        if (recipient.StartsWith('@'))
            return await db.Wallets.FirstOrDefaultAsync(w => w.Handle == recipient.ToLowerInvariant()) ?? throw ApiException.NotFound("recipient");
        var u = await db.Users.FirstOrDefaultAsync(x => x.Email == recipient.ToLowerInvariant()) ?? throw ApiException.NotFound("recipient");
        return await db.Wallets.FirstOrDefaultAsync(w => w.OwnerType == "user" && w.OwnerId == u.Id)
               ?? throw new ApiException(400, "recipient_no_wallet", "The recipient has not activated a wallet yet.");
    }

    public async Task<Transfer> Send(User user, Data.Wallet source, SendRequest r)
    {
        var srcCur = Money.Normalize(r.SourceCurrency);
        var dstCur = Money.Normalize(r.DestinationCurrency ?? r.SourceCurrency);
        if (r.Amount <= 0) throw ApiException.Invalid("amount must be positive.");
        EnsureCanMove(user, source, "transfer");
        var recipientWallet = await ResolveRecipient(r.Recipient);
        if (recipientWallet.Id == source.Id) throw ApiException.Invalid("You cannot send money to yourself.");
        if (recipientWallet.Status != "active") throw new ApiException(400, "recipient_unavailable", "The recipient cannot receive money right now.");
        var recipientUser = recipientWallet.OwnerType == "user" ? await db.Users.FirstAsync(u => u.Id == recipientWallet.OwnerId) : null;
        if (recipientUser is { Status: "FROZEN" or "CLOSED" }) throw new ApiException(400, "recipient_unavailable", "The recipient cannot receive money right now.");
        await EnsureCorridor(user.Country, recipientUser?.Country);
        await EnforceLimits(user, source, "internal", r.Amount, srcCur);
        if (recipientUser != null) await EnforceMaxBalance(recipientUser, recipientWallet, 0, dstCur);

        FxQuote? quote = null;
        if (srcCur != dstCur)
        {
            if (r.QuoteId == null) throw ApiException.Invalid("Cross-currency transfers need a quote_id from POST /v1/fx/quotes.");
            quote = await db.FxQuotes.FirstOrDefaultAsync(q => q.Id == r.QuoteId && q.UserId == user.Id) ?? throw ApiException.NotFound("quote");
            if (quote.UsedAt != null) throw ApiException.Conflict("quote_used", "This quote was already used.");
            if (quote.ExpiresAt < uow.Now) throw ApiException.Conflict("quote_expired", "This quote has expired. Get a new one.");
            if (quote.FromCurrency != srcCur || quote.ToCurrency != dstCur || quote.SourceAmount != r.Amount) throw ApiException.Invalid("The quote does not match this transfer.");
        }
        var fee = quote?.FeeAmount ?? fx.TransferFee(r.Amount, srcCur, false);
        var destAmount = quote?.DestinationAmount ?? r.Amount;

        var recipientName = recipientUser?.Name ?? (await db.Organizations.FirstOrDefaultAsync(o => o.Id == recipientWallet.OwnerId))?.Name ?? "";
        var screen = await screening.Screen("user", recipientWallet.OwnerId, recipientName, recipientUser?.DateOfBirth, recipientUser?.Country, "transfer_beneficiary");

        return await uow.Run(async () =>
        {
            var available = await Available(source, srcCur);
            if (available < r.Amount + fee)
                throw new ApiException(400, "insufficient_funds", $"Available {Money.Format(available, srcCur)}; this transfer needs {Money.Format(r.Amount + fee, srcCur)} including fees.");
            var t = NewTransfer("internal", user, source.Id, recipientWallet.Id, srcCur, r.Amount, dstCur, destAmount);
            t.FeeAmount = fee;
            t.Purpose = r.Purpose;
            t.Note = r.Note;
            t.SourceOfFunds = r.SourceOfFunds;
            t.Rail = "internal_ledger";
            t.SenderCountry = user.Country;
            t.RecipientCountry = recipientUser?.Country;
            t.ScreeningResult = screen.Result;
            if (quote != null)
            {
                quote.UsedAt = uow.Now;
                t.FxQuoteId = quote.Id;
                t.FxRateE9 = quote.CustomerRateE9;
                t.FxMidRateE9 = quote.MidRateE9;
                t.FxRateTimestamp = quote.RateTimestamp;
                t.FxSpreadAmount = quote.SpreadAmount;
            }
            db.Transfers.Add(t);
            if (screen.Result == "potential_match")
            {
                await Hold(t, source, "Potential sanctions match on beneficiary — compliance review", screen.AlertId);
                return t;
            }
            var outcome = await monitoring.Evaluate(t, user);
            if (outcome.Hold) { await Hold(t, source, outcome.Reason); return t; }
            await PostInternal(t);
            return t;
        });
    }

    private async Task EnsureCorridor(string? from, string? to)
    {
        if (from == null || to == null || from == to) return;
        foreach (var c in new[] { from, to })
        {
            var cap = await db.Countries.FirstOrDefaultAsync(x => x.Country == c);
            if (cap is { WalletEnabled: false }) throw new ApiException(400, "corridor_unavailable", $"Transfers involving {c} are not available.");
        }
    }

    public async Task PostInternal(Transfer t)
    {
        var src = await ledger.WalletAccount(t.SenderWalletId!, t.SourceCurrency);
        var dst = await ledger.WalletAccount(t.RecipientWalletId!, t.DestinationCurrency);
        var legs = new List<Leg> { Leg.Debit(src, t.SourceAmount + t.FeeAmount) };
        if (t.FeeAmount > 0) legs.Add(Leg.Credit(await ledger.Platform(Accounts.FeeRevenue, t.SourceCurrency, Accounts.WalletLivemode), t.FeeAmount));
        if (t.SourceCurrency == t.DestinationCurrency)
        {
            legs.Add(Leg.Credit(dst, t.SourceAmount));
        }
        else
        {
            // Two balanced currency legs through the FX position, spread booked as FX revenue (§124).
            var midAmount = t.DestinationAmount + t.FxSpreadAmount;
            legs.Add(Leg.Credit(await ledger.Platform(Accounts.FxClearing, t.SourceCurrency, Accounts.WalletLivemode), t.SourceAmount));
            legs.Add(Leg.Debit(await ledger.Platform(Accounts.FxClearing, t.DestinationCurrency, Accounts.WalletLivemode), midAmount));
            legs.Add(Leg.Credit(dst, t.DestinationAmount));
            if (t.FxSpreadAmount > 0) legs.Add(Leg.Credit(await ledger.Platform(Accounts.FxRevenue, t.DestinationCurrency, Accounts.WalletLivemode), t.FxSpreadAmount));
        }
        var ltx = await ledger.Post(t.SourceCurrency == t.DestinationCurrency ? "transfer" : "fx_transfer", $"transfer:{t.Id}", $"Wallet transfer {t.Id}", "transfer", t.Id, null, Accounts.WalletLivemode, legs);
        Complete(t, ltx.Id, "Sent.");
    }

    /// <summary>Converts between the user's own balances using a binding quote (the Exchange action).</summary>
    public async Task<Transfer> Exchange(User user, string quoteId)
    {
        var w = await ForUser(user, create: false) ?? throw ApiException.NotFound("wallet");
        EnsureCanMove(user, w, "transfer");
        var quote = await db.FxQuotes.FirstOrDefaultAsync(q => q.Id == quoteId && q.UserId == user.Id) ?? throw ApiException.NotFound("quote");
        if (quote.UsedAt != null) throw ApiException.Conflict("quote_used", "This quote was already used.");
        if (quote.ExpiresAt < uow.Now) throw ApiException.Conflict("quote_expired", "This quote has expired. Get a new one.");
        if (quote.FromCurrency == quote.ToCurrency) throw ApiException.Invalid("Pick two different currencies.");
        await EnforceLimits(user, w, "conversion", quote.SourceAmount, quote.FromCurrency);
        await EnforceMaxBalance(user, w, quote.DestinationAmount, quote.ToCurrency);
        return await uow.Run(async () =>
        {
            var available = await Available(w, quote.FromCurrency);
            if (available < quote.SourceAmount + quote.FeeAmount)
                throw new ApiException(400, "insufficient_funds", $"Available {Money.Format(available, quote.FromCurrency)}; this needs {Money.Format(quote.SourceAmount + quote.FeeAmount, quote.FromCurrency)} including fees.");
            var t = NewTransfer("conversion", user, w.Id, w.Id, quote.FromCurrency, quote.SourceAmount, quote.ToCurrency, quote.DestinationAmount);
            t.FeeAmount = quote.FeeAmount;
            t.Rail = "internal_ledger";
            t.FxQuoteId = quote.Id; t.FxRateE9 = quote.CustomerRateE9; t.FxMidRateE9 = quote.MidRateE9; t.FxRateTimestamp = quote.RateTimestamp; t.FxSpreadAmount = quote.SpreadAmount;
            t.SenderCountry = t.RecipientCountry = user.Country;
            quote.UsedAt = uow.Now;
            db.Transfers.Add(t);
            await PostInternal(t);
            t.CustomerMessage = $"Converted to {t.DestinationCurrency}.";
            return t;
        });
    }

    // ───────────────────────── Withdraw (§40) ─────────────────────────

    public async Task<Transfer> Withdraw(User user, string currency, long amount, string bankAccountId, string? quoteId)
    {
        currency = Money.Normalize(currency);
        var w = await ForUser(user, create: false) ?? throw ApiException.NotFound("wallet");
        EnsureCanMove(user, w, "withdrawal");
        var bank = await db.BankAccounts.FirstOrDefaultAsync(b => b.Id == bankAccountId && b.OwnerType == "user" && b.OwnerId == user.Id && b.RemovedAt == null)
                   ?? throw ApiException.NotFound("bank account");
        if (bank.VerificationStatus != "verified") throw new ApiException(400, "bank_unverified", "Verify this bank account first.");
        await EnforceLimits(user, w, "withdrawal", amount, currency);
        FxQuote? quote = null;
        if (bank.Currency != currency)
        {
            quote = await db.FxQuotes.FirstOrDefaultAsync(q => q.Id == quoteId && q.UserId == user.Id) ?? throw ApiException.Invalid("Withdrawing to a different currency needs a quote_id.");
            if (quote.UsedAt != null || quote.ExpiresAt < uow.Now || quote.FromCurrency != currency || quote.ToCurrency != bank.Currency || quote.SourceAmount != amount)
                throw ApiException.Invalid("The quote is expired, used, or does not match.");
        }
        var fee = Money.ApplyBps(amount, config.GetValue("Wallet:WithdrawalFeeBps", 0), currency) + (quote?.FeeAmount ?? 0);
        var screen = await screening.Screen("user", user.Id, bank.AccountHolder, user.DateOfBirth, bank.Country, "withdrawal_beneficiary");
        return await uow.Run(async () =>
        {
            var available = await Available(w, currency);
            if (available < amount + fee) throw new ApiException(400, "insufficient_funds", $"Available {Money.Format(available, currency)}.");
            var t = NewTransfer("withdrawal", user, w.Id, null, currency, amount, bank.Currency, quote?.DestinationAmount ?? amount);
            t.BankAccountId = bank.Id;
            t.FeeAmount = fee;
            t.Rail = $"sandbox_local_rail_{bank.Country}";
            t.SenderCountry = user.Country;
            t.RecipientCountry = bank.Country;
            t.ScreeningResult = screen.Result;
            if (quote != null)
            {
                quote.UsedAt = uow.Now;
                t.FxQuoteId = quote.Id; t.FxRateE9 = quote.CustomerRateE9; t.FxMidRateE9 = quote.MidRateE9; t.FxRateTimestamp = quote.RateTimestamp; t.FxSpreadAmount = quote.SpreadAmount;
            }
            db.Transfers.Add(t);
            if (screen.Result == "potential_match") { await Hold(t, w, "Potential sanctions match on withdrawal beneficiary", screen.AlertId); return t; }
            var outcome = await monitoring.Evaluate(t, user);
            if (outcome.Hold) { await Hold(t, w, outcome.Reason); return t; }
            await PostWithdrawal(t);
            return t;
        });
    }

    public async Task PostWithdrawal(Transfer t)
    {
        var legs = new List<Leg> { Leg.Debit(await ledger.WalletAccount(t.SenderWalletId!, t.SourceCurrency), t.SourceAmount + t.FeeAmount) };
        var feeFx = t.FxQuoteId != null ? (await db.FxQuotes.FirstAsync(q => q.Id == t.FxQuoteId)).FeeAmount : 0;
        var platformFee = t.FeeAmount;
        if (platformFee > 0) legs.Add(Leg.Credit(await ledger.Platform(Accounts.FeeRevenue, t.SourceCurrency, Accounts.WalletLivemode), platformFee));
        if (t.SourceCurrency == t.DestinationCurrency)
            legs.Add(Leg.Credit(await ledger.Platform(Accounts.PayoutClearing, t.SourceCurrency, Accounts.WalletLivemode), t.SourceAmount));
        else
        {
            legs.Add(Leg.Credit(await ledger.Platform(Accounts.FxClearing, t.SourceCurrency, Accounts.WalletLivemode), t.SourceAmount));
            legs.Add(Leg.Debit(await ledger.Platform(Accounts.FxClearing, t.DestinationCurrency, Accounts.WalletLivemode), t.DestinationAmount + t.FxSpreadAmount));
            legs.Add(Leg.Credit(await ledger.Platform(Accounts.PayoutClearing, t.DestinationCurrency, Accounts.WalletLivemode), t.DestinationAmount));
            if (t.FxSpreadAmount > 0) legs.Add(Leg.Credit(await ledger.Platform(Accounts.FxRevenue, t.DestinationCurrency, Accounts.WalletLivemode), t.FxSpreadAmount));
        }
        _ = feeFx;
        var ltx = await ledger.Post("withdrawal", $"transfer:{t.Id}", $"Withdrawal {t.Id} to bank", "transfer", t.Id, null, Accounts.WalletLivemode, legs);
        t.LedgerTransactionId = ltx.Id;
        uow.Transition("transfer", t.Id, t.Status, "PROCESSING", null);
        t.Status = "PROCESSING";
        t.CustomerMessage = "Your withdrawal is on its way to your bank.";
        t.UpdatedAt = uow.Now;
        uow.Emit("withdrawal.created", t, null, Accounts.WalletLivemode, t.InitiatedBy);
    }

    /// <summary>Bank rail settlement for withdrawals (sandbox). Account numbers ending 0000 are returned.</summary>
    public async Task<int> SettleWithdrawals()
    {
        var processing = await db.Transfers.Where(t => t.Type == "withdrawal" && t.Status == "PROCESSING").Take(200).ToListAsync();
        foreach (var t in processing)
        {
            await uow.Run(async () =>
            {
                var bank = await db.BankAccounts.FirstAsync(b => b.Id == t.BankAccountId);
                var clearing = await ledger.Platform(Accounts.PayoutClearing, t.DestinationCurrency, Accounts.WalletLivemode);
                if (bank.Last4 == "0000")
                {
                    // Returned by the bank: funds come back to the wallet in the destination currency.
                    var ltx = await ledger.Post("withdrawal_return", $"transfer_return:{t.Id}", $"Withdrawal {t.Id} returned", "transfer", t.Id, null, Accounts.WalletLivemode,
                    [
                        Leg.Debit(clearing, t.DestinationAmount),
                        Leg.Credit(await ledger.WalletAccount(t.SenderWalletId!, t.DestinationCurrency), t.DestinationAmount),
                    ], t.LedgerTransactionId);
                    uow.Transition("transfer", t.Id, t.Status, "RETURNED", null, "bank_returned");
                    t.Status = "RETURNED";
                    t.FailureReason = "The receiving bank returned the funds.";
                    t.CustomerMessage = "Your bank returned this withdrawal. The money is back in your wallet.";
                    _ = ltx;
                    uow.Emit("withdrawal.returned", t, null, Accounts.WalletLivemode, t.InitiatedBy);
                }
                else
                {
                    await ledger.Post("withdrawal_paid", $"transfer_paid:{t.Id}", $"Withdrawal {t.Id} paid out", "transfer", t.Id, null, Accounts.WalletLivemode,
                    [
                        Leg.Debit(clearing, t.DestinationAmount),
                        Leg.Credit(await ledger.Platform(Accounts.SafeguardingBank, t.DestinationCurrency, Accounts.WalletLivemode), t.DestinationAmount),
                    ], t.LedgerTransactionId);
                    uow.Transition("transfer", t.Id, t.Status, "COMPLETED", null);
                    t.Status = "COMPLETED";
                    t.CompletedAt = uow.Now;
                    t.CustomerMessage = "Withdrawal completed.";
                    uow.Emit("withdrawal.completed", t, null, Accounts.WalletLivemode, t.InitiatedBy);
                }
                t.UpdatedAt = uow.Now;
            });
        }
        return processing.Count;
    }

    // ───────────────────────── Merchant proceeds → wallet (§118) ─────────────────────────

    public async Task<Transfer> MoveMerchantProceeds(string orgId, bool livemode, string currency, long amount)
    {
        if (livemode != Accounts.WalletLivemode) throw new ApiException(400, "mode_mismatch", "Wallet rails in this environment are sandbox-only; use test mode.");
        currency = Money.Normalize(currency);
        return await uow.Run(async () =>
        {
            var available = await ledger.MerchantBalance(orgId, Accounts.MerchantAvailable, currency, livemode);
            if (amount <= 0 || amount > available) throw new ApiException(400, "insufficient_balance", $"Only {Money.Format(available, currency)} is available.");
            var w = await ForOrg(orgId);
            var t = new Transfer
            {
                Id = Ids.New("tr"), CreatedAt = uow.Now, UpdatedAt = uow.Now, Type = "merchant_proceeds", Status = "CREATED", RecipientWalletId = w.Id, SourceOrgId = orgId,
                SourceCurrency = currency, SourceAmount = amount, DestinationCurrency = currency, DestinationAmount = amount, InitiatedBy = uow.Ctx.ActorId, Rail = "internal_ledger",
            };
            db.Transfers.Add(t);
            var ltx = await ledger.Post("transfer_to_wallet", $"transfer:{t.Id}", "Merchant proceeds to business wallet", "transfer", t.Id, orgId, livemode,
            [
                Leg.Debit(await ledger.Merchant(orgId, Accounts.MerchantAvailable, currency, livemode), amount),
                Leg.Credit(await ledger.WalletAccount(w.Id, currency), amount),
            ]);
            db.BalanceTransactions.Add(new BalanceTransaction
            {
                Id = Ids.New("txn"), CreatedAt = uow.Now, Type = "transfer_to_wallet", Amount = -amount, Net = -amount, Currency = currency, SourceType = "transfer",
                SourceId = t.Id, Status = "available", AvailableOn = uow.Now, LedgerTransactionId = ltx.Id, Description = "Moved to business wallet",
            });
            Complete(t, ltx.Id, "Moved to your business wallet.");
            uow.Audit("wallet.merchant_proceeds", "transfer", t.Id, after: new { amount, currency });
            return t;
        });
    }

    // ───────────────────────── Holds & release (§70, §127) ─────────────────────────

    private async Task Hold(Transfer t, Data.Wallet? source, string internalReason, string? alertId = null)
    {
        if (source != null)
        {
            var hold = new WalletHold
            {
                Id = Ids.New("hold"), CreatedAt = uow.Now, WalletId = source.Id, Currency = t.SourceCurrency, Amount = t.SourceAmount + t.FeeAmount,
                Reason = "compliance_review", RefType = "transfer", RefId = t.Id,
            };
            db.WalletHolds.Add(hold);
            t.HoldId = hold.Id;
        }
        uow.Transition("transfer", t.Id, t.Status, "HELD", null, internalReason);
        t.Status = "HELD";
        t.InternalReason = internalReason;
        // Neutral customer copy: nothing about detection logic or investigations (§71, §159).
        t.CustomerMessage = "This transaction requires additional review. We'll update you soon.";
        t.UpdatedAt = uow.Now;
        await db.SaveChangesAsync();
        if (alertId != null)
        {
            var alert = await db.Alerts.FirstOrDefaultAsync(a => a.Id == alertId);
            if (alert != null) alert.TransferId = t.Id;
        }
        uow.Emit("transfer.held", t, null, Accounts.WalletLivemode, t.InitiatedBy);
    }

    public async Task<Transfer> DecideHeld(string transferId, bool release, string reason)
    {
        return await uow.Run(async () =>
        {
            var t = await db.Transfers.FirstOrDefaultAsync(x => x.Id == transferId) ?? throw ApiException.NotFound("transfer");
            if (t.Status != "HELD") throw ApiException.Conflict("invalid_state", "Transfer is not on hold.");
            if (t.HoldId != null)
            {
                var hold = await db.WalletHolds.FirstAsync(h => h.Id == t.HoldId);
                hold.Status = "released";
                hold.ReleasedAt = uow.Now;
            }
            if (release)
            {
                if (t.SenderWalletId != null && t.Type != "withdrawal")
                {
                    var w = await db.Wallets.FirstAsync(x => x.Id == t.SenderWalletId);
                    await db.SaveChangesAsync();
                    if (await Available(w, t.SourceCurrency) < t.SourceAmount + t.FeeAmount) throw new ApiException(400, "insufficient_funds", "Sender no longer has sufficient funds.");
                }
                switch (t.Type)
                {
                    case "internal": await PostInternal(t); break;
                    case "withdrawal": await PostWithdrawal(t); break;
                    case "funding": await PostFunding(t, await db.Wallets.FirstAsync(x => x.Id == t.RecipientWalletId)); break;
                }
            }
            else
            {
                uow.Transition("transfer", t.Id, "HELD", "CANCELLED", null, reason);
                t.Status = "CANCELLED";
                t.FailureReason = reason;
                t.CustomerMessage = "This transaction could not be completed. Any held funds have been released.";
                uow.Emit("transfer.cancelled", t, null, Accounts.WalletLivemode, t.InitiatedBy);
            }
            uow.Audit(release ? "transfer.release" : "transfer.reject", "transfer", t.Id, reason: reason);
            t.UpdatedAt = uow.Now;
            return t;
        });
    }

    private Transfer NewTransfer(string type, User user, string? sender, string? recipient, string srcCur, long srcAmt, string dstCur, long dstAmt) => new()
    {
        Id = Ids.New("tr"), CreatedAt = uow.Now, UpdatedAt = uow.Now, Type = type, Status = "SCREENING", SenderWalletId = sender, RecipientWalletId = recipient,
        SourceCurrency = srcCur, SourceAmount = srcAmt, DestinationCurrency = dstCur, DestinationAmount = dstAmt, InitiatedBy = user.Id,
        Ip = uow.Ctx.Ip, DeviceId = uow.Ctx.DeviceId,
    };

    private void Complete(Transfer t, string ledgerTxnId, string message)
    {
        uow.Transition("transfer", t.Id, t.Status, "COMPLETED", null);
        t.Status = "COMPLETED";
        t.LedgerTransactionId = ledgerTxnId;
        t.CompletedAt = uow.Now;
        t.CustomerMessage = message;
        t.UpdatedAt = uow.Now;
        uow.Emit($"transfer.completed", t, null, Accounts.WalletLivemode, t.InitiatedBy);
    }

    // ───────────────────────── Bank accounts (§39, §113) ─────────────────────────

    public async Task<BankAccount> AddBankAccount(string ownerType, string ownerId, string ownerName, string country, string currency, string bankName,
        string holder, string accountNumber, string? routing)
    {
        accountNumber = new string(accountNumber.Where(char.IsLetterOrDigit).ToArray()).ToUpperInvariant();
        if (accountNumber.Length is < 6 or > 34) throw ApiException.Invalid("account_number looks invalid.");
        currency = Money.Normalize(currency);
        var pepper = config["Security:FingerprintPepper"] ?? "dev-pepper";
        return await uow.Run(async () =>
        {
            var ba = new BankAccount
            {
                Id = Ids.New("ba"), CreatedAt = uow.Now, OwnerType = ownerType, OwnerId = ownerId, Country = country.ToUpperInvariant(), Currency = currency,
                BankName = bankName, AccountHolder = holder, AccountNumberEnc = encryptor.Encrypt(accountNumber), Last4 = accountNumber[^4..], Routing = routing,
                Fingerprint = Crypto.HmacSha256Hex(pepper, accountNumber + "|" + routing),
                NameMatch = NamesMatch(ownerName, holder),
            };
            ba.VerificationStatus = ba.NameMatch ? "verified" : "verification_required";
            db.BankAccounts.Add(ba);
            db.SecurityEvents.Add(new SecurityEvent { Id = Ids.New("sev"), CreatedAt = uow.Now, UserId = ownerType == "user" ? ownerId : null, Type = "bank_account_added", Ip = uow.Ctx.Ip, Detail = $"****{ba.Last4}" });
            uow.Audit("bank_account.add", "bank_account", ba.Id, after: new { ba.Country, ba.Currency, last4 = ba.Last4, ba.NameMatch });
            await Task.CompletedTask;
            return ba;
        });
    }

    private static bool NamesMatch(string a, string b)
    {
        static HashSet<string> Tokens(string s) => s.ToLowerInvariant().Split([' ', '.', ','], StringSplitOptions.RemoveEmptyEntries).ToHashSet();
        var ta = Tokens(a);
        var tb = Tokens(b);
        return ta.Count > 0 && ta.Intersect(tb).Count() >= Math.Min(2, Math.Min(ta.Count, tb.Count));
    }
}
