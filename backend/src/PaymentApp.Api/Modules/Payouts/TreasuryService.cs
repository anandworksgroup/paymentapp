using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Ledger;

namespace PaymentApp.Api.Modules.Payouts;

/// <summary>
/// Settlement, reserves, payouts and balances (§38, §69, §279-§284). Balances are always read from the
/// ledger; balance transactions are the merchant-facing explanation of every movement (§144).
/// </summary>
public class TreasuryService(AppDb db, Uow uow, LedgerService ledger)
{
    public async Task<object> Balance(string orgId, bool livemode)
    {
        var accounts = await db.LedgerAccounts.Where(a => a.OwnerType == "org" && a.OwnerId == orgId && a.Livemode == livemode).ToListAsync();
        var byCurrency = new List<object>();
        foreach (var currency in accounts.Select(a => a.Currency).Distinct().OrderBy(c => c))
        {
            async Task<long> Of(string code) { var a = accounts.FirstOrDefault(x => x.Code == code && x.Currency == currency); return a == null ? 0 : await ledger.Balance(a); }
            var inTransit = await db.Payouts.Where(p => p.Currency == currency && (p.Status == "PENDING" || p.Status == "PROCESSING" || p.Status == "ON_HOLD")).SumAsync(p => (long?)p.Amount) ?? 0;
            var heldForReview = await db.BalanceTransactions.Where(t => t.Currency == currency && t.Status == "pending" && t.HeldForReview).SumAsync(t => (long?)t.Net) ?? 0;
            byCurrency.Add(new
            {
                currency,
                available = await Of(Accounts.MerchantAvailable),
                pending = await Of(Accounts.MerchantPending),
                reserved = await Of(Accounts.MerchantReserve),
                held_for_review = heldForReview,
                in_transit_to_bank = inTransit,
            });
        }
        return new { @object = "balance", livemode, balances = byCurrency, source = "ledger" };
    }

    /// <summary>Moves matured pending funds to available, carving out the rolling reserve (§280, §69).</summary>
    public async Task<int> Settle(DateTime now)
    {
        List<BalanceTransaction> due;
        using (db.Tenant.Elevate())
            due = await db.BalanceTransactions.AsNoTracking()
                .Where(t => t.Status == "pending" && !t.HeldForReview && t.AvailableOn <= now).OrderBy(t => t.AvailableOn).Take(500).ToListAsync();
        foreach (var snapshot in due)
        {
            using var _ = db.Tenant.Use(snapshot.OrgId, snapshot.Livemode);
            await uow.Run(async () =>
            {
                var t = await db.BalanceTransactions.FirstAsync(x => x.Id == snapshot.Id);
                if (t.Status != "pending") return;
                var org = await db.Organizations.FirstAsync(o => o.Id == t.OrgId);
                var reserve = t.Net > 0 && org.ReserveBps > 0 ? Money.ApplyBps(t.Net, org.ReserveBps, t.Currency) : 0;
                var pending = await ledger.Merchant(t.OrgId, Accounts.MerchantPending, t.Currency, t.Livemode);
                var available = await ledger.Merchant(t.OrgId, Accounts.MerchantAvailable, t.Currency, t.Livemode);
                var legs = new List<Leg> { Leg.Debit(pending, t.Net), Leg.Credit(available, t.Net - reserve) };
                if (reserve > 0) legs.Add(Leg.Credit(await ledger.Merchant(t.OrgId, Accounts.MerchantReserve, t.Currency, t.Livemode), reserve));
                await ledger.Post("settlement", $"settle:{t.Id}", $"Funds available for {t.SourceId}", t.SourceType, t.SourceId, t.OrgId, t.Livemode, legs, t.LedgerTransactionId);
                t.Status = "available";
                t.ReserveAmount = reserve;
                t.ReserveReleaseOn = reserve > 0 ? now.AddDays(org.ReserveHoldDays) : null;
            });
        }
        return due.Count;
    }

    /// <summary>Scheduled reserve releases always create explicit ledger events (§284).</summary>
    public async Task<int> ReleaseReserves(DateTime now)
    {
        List<BalanceTransaction> due;
        using (db.Tenant.Elevate())
            due = await db.BalanceTransactions.AsNoTracking()
                .Where(t => t.ReserveAmount > 0 && !t.ReserveReleased && t.ReserveReleaseOn != null && t.ReserveReleaseOn <= now).Take(500).ToListAsync();
        foreach (var snapshot in due)
        {
            using var _ = db.Tenant.Use(snapshot.OrgId, snapshot.Livemode);
            await uow.Run(async () =>
            {
                var t = await db.BalanceTransactions.FirstAsync(x => x.Id == snapshot.Id);
                if (t.ReserveReleased) return;
                var ltx = await ledger.Post("reserve_release", $"reserve_release:{t.Id}", $"Reserve released for {t.SourceId}", t.SourceType, t.SourceId, t.OrgId, t.Livemode,
                [
                    Leg.Debit(await ledger.Merchant(t.OrgId, Accounts.MerchantReserve, t.Currency, t.Livemode), t.ReserveAmount),
                    Leg.Credit(await ledger.Merchant(t.OrgId, Accounts.MerchantAvailable, t.Currency, t.Livemode), t.ReserveAmount),
                ]);
                t.ReserveReleased = true;
                db.BalanceTransactions.Add(new BalanceTransaction
                {
                    Id = Ids.New("txn"), CreatedAt = uow.Now, OrgId = t.OrgId, Livemode = t.Livemode, Type = "reserve_release", Amount = t.ReserveAmount,
                    Net = t.ReserveAmount, Currency = t.Currency, SourceType = t.SourceType, SourceId = t.SourceId, Status = "available", AvailableOn = uow.Now,
                    LedgerTransactionId = ltx.Id, Description = "Rolling reserve released",
                });
            });
        }
        return due.Count;
    }

    public async Task<Payout> CreatePayout(string orgId, bool livemode, string currency, long? amount, bool automatic)
    {
        return await uow.Run(async () =>
        {
            var org = await db.Organizations.FirstAsync(o => o.Id == orgId);
            if (org.Status != "APPROVED" && livemode) throw new ApiException(403, "account_not_approved", "Payouts require an approved account.");
            if (org.Restriction is "SUSPENDED" or "RESTRICT") throw new ApiException(403, "account_restricted", "Payouts are unavailable for this account.");
            var destination = await db.PayoutDestinations.FirstOrDefaultAsync(d => d.IsDefault && d.Currency == currency && d.Status == "verified")
                              ?? throw new ApiException(400, "no_payout_destination", $"Add a verified {currency} bank account first.");
            var available = await ledger.MerchantBalance(orgId, Accounts.MerchantAvailable, currency, livemode);
            var amt = amount ?? available;
            if (amt <= 0) throw new ApiException(400, "insufficient_balance", "There is no available balance to pay out.");
            if (amt > available) throw new ApiException(400, "insufficient_balance", $"Only {Money.Format(available, currency)} is available.");
            if (amt < org.MinimumPayoutMinor) throw new ApiException(400, "below_minimum", $"Minimum payout is {Money.Format(org.MinimumPayoutMinor, currency)}.");

            var included = await db.BalanceTransactions.Where(t => t.Currency == currency && t.Status == "available" && t.PayoutId == null && t.Type != "payout").ToListAsync();
            var payout = new Payout
            {
                Id = Ids.New("po"), CreatedAt = uow.Now, Amount = amt, Currency = currency, DestinationId = destination.Id, DestinationLast4 = destination.Last4,
                Automatic = automatic, ArrivalDate = uow.Now.AddDays(1).Date,
                Status = org.Restriction == "PAYOUT_HOLD" || org.Restriction == "PAYOUT_DELAY" ? "ON_HOLD" : "PENDING",
                HoldReason = org.Restriction is "PAYOUT_HOLD" or "PAYOUT_DELAY" ? "Account under review" : null,
            };
            foreach (var t in included) t.PayoutId = payout.Id;
            var paymentIds = included.Where(t => t.Type == "payment").Select(t => t.SourceId).ToList();
            payout.BreakdownJson = Json.Serialize(new
            {
                gross_collected = included.Where(t => t.Type == "payment").Sum(t => t.Amount),
                fees = -included.Sum(t => t.Fee),
                refunds = included.Where(t => t.Type == "refund").Sum(t => t.Amount),
                chargebacks = included.Where(t => t.Type is "dispute" or "dispute_reversal").Sum(t => t.Amount),
                reserve_withheld = -included.Sum(t => t.ReserveAmount),
                reserve_released = included.Where(t => t.Type == "reserve_release").Sum(t => t.Amount),
                adjustments = included.Where(t => t.Type == "adjustment").Sum(t => t.Amount),
                tax_collected_and_remitted_by_platform = await db.Payments.Where(p => paymentIds.Contains(p.Id)).SumAsync(p => (long?)p.TaxAmount) ?? 0,
                balance_transactions = included.Count,
                net_payout = amt,
                note = amt != included.Sum(t => t.Net - t.ReserveAmount) ? "Payout amount is the ledger available balance, which also reflects earlier negative balances or partial payouts." : null,
            });
            db.Payouts.Add(payout);
            var ltx = await ledger.Post("payout", $"payout:{payout.Id}", $"Payout {payout.Id} to ****{destination.Last4}", "payout", payout.Id, orgId, livemode,
            [
                Leg.Debit(await ledger.Merchant(orgId, Accounts.MerchantAvailable, currency, livemode), amt),
                Leg.Credit(await ledger.Platform(Accounts.PayoutClearing, currency, livemode), amt),
            ]);
            payout.LedgerTransactionId = ltx.Id;
            db.BalanceTransactions.Add(new BalanceTransaction
            {
                Id = Ids.New("txn"), CreatedAt = uow.Now, Type = "payout", Amount = -amt, Net = -amt, Currency = currency, SourceType = "payout",
                SourceId = payout.Id, Status = "available", AvailableOn = uow.Now, LedgerTransactionId = ltx.Id, PayoutId = payout.Id, Description = "Payout to bank",
            });
            uow.Transition("payout", payout.Id, null, payout.Status, orgId);
            uow.Emit("payout.created", payout);
            if (!automatic) uow.Audit("payout.create", "payout", payout.Id, after: new { amt, currency });
            return payout;
        });
    }

    /// <summary>Sends pending payouts to the (simulated) bank rail. Account numbers ending 0000 are returned by the bank (§282).</summary>
    public async Task<int> ProcessPayouts(DateTime now)
    {
        List<Payout> pending;
        using (db.Tenant.Elevate())
            pending = await db.Payouts.AsNoTracking().Where(p => p.Status == "PENDING" || p.Status == "PROCESSING").Take(200).ToListAsync();
        foreach (var snapshot in pending)
        {
            using var _ = db.Tenant.Use(snapshot.OrgId, snapshot.Livemode);
            await Advance(snapshot.Id);
        }
        return pending.Count;
    }

    public async Task<Payout> Advance(string payoutId)
    {
        return await uow.Run(async () =>
        {
            var p = await db.Payouts.FirstAsync(x => x.Id == payoutId);
            if (p.Status == "PENDING")
            {
                uow.Transition("payout", p.Id, "PENDING", "PROCESSING", p.OrgId);
                p.Status = "PROCESSING";
                p.BankReference = Ids.New("bank", 12).ToUpperInvariant();
                uow.Emit("payout.processing", p);
                return p;
            }
            if (p.Status != "PROCESSING") return p;
            var clearing = await ledger.Platform(Accounts.PayoutClearing, p.Currency, p.Livemode);
            if (p.DestinationLast4 == "0000")
            {
                uow.Transition("payout", p.Id, "PROCESSING", "FAILED", p.OrgId, "account_closed");
                p.Status = "FAILED";
                p.FailureReason = "The receiving bank returned the payout: account closed.";
                var ltx = await ledger.Post("payout_failure", $"payout_failed:{p.Id}", $"Payout {p.Id} returned", "payout", p.Id, p.OrgId, p.Livemode,
                [
                    Leg.Debit(clearing, p.Amount),
                    Leg.Credit(await ledger.Merchant(p.OrgId, Accounts.MerchantAvailable, p.Currency, p.Livemode), p.Amount),
                ], p.LedgerTransactionId);
                db.BalanceTransactions.Add(new BalanceTransaction
                {
                    Id = Ids.New("txn"), CreatedAt = uow.Now, Type = "payout_failure", Amount = p.Amount, Net = p.Amount, Currency = p.Currency,
                    SourceType = "payout", SourceId = p.Id, Status = "available", AvailableOn = uow.Now, LedgerTransactionId = ltx.Id, Description = "Payout returned to balance",
                });
                foreach (var t in await db.BalanceTransactions.Where(t => t.PayoutId == p.Id && t.Type != "payout").ToListAsync()) t.PayoutId = null;
                uow.Emit("payout.failed", p);
                return p;
            }
            uow.Transition("payout", p.Id, "PROCESSING", "PAID", p.OrgId);
            p.Status = "PAID";
            p.PaidAt = uow.Now;
            await ledger.Post("payout_paid", $"payout_paid:{p.Id}", $"Payout {p.Id} settled at bank", "payout", p.Id, p.OrgId, p.Livemode,
            [
                Leg.Debit(clearing, p.Amount),
                Leg.Credit(await ledger.Platform(Accounts.PlatformBank, p.Currency, p.Livemode), p.Amount),
            ], p.LedgerTransactionId);
            uow.Emit("payout.completed", p);
            return p;
        });
    }

    /// <summary>Automatic payouts per merchant schedule (§281).</summary>
    public async Task<int> RunScheduledPayouts(DateTime now)
    {
        List<(string OrgId, bool Livemode, string Currency)> candidates;
        using (db.Tenant.Elevate())
        {
            var orgs = await db.Organizations.Where(o => o.PayoutSchedule != "manual" && o.Status != "CLOSED").ToListAsync();
            var due = orgs.Where(o => o.PayoutSchedule == "daily" || (o.PayoutSchedule == "weekly" && now.DayOfWeek == DayOfWeek.Monday)
                                      || (o.PayoutSchedule == "monthly" && now.Day == 1)).Select(o => o.Id).ToHashSet();
            var accounts = await db.LedgerAccounts.Where(a => a.OwnerType == "org" && a.Code == Accounts.MerchantAvailable).ToListAsync();
            candidates = accounts.Where(a => due.Contains(a.OwnerId!)).Select(a => (a.OwnerId!, a.Livemode, a.Currency)).ToList();
        }
        var created = 0;
        foreach (var (orgId, livemode, currency) in candidates)
        {
            using var _ = db.Tenant.Use(orgId, livemode);
            var today = now.Date;
            if (await db.Payouts.AnyAsync(p => p.Automatic && p.Currency == currency && p.CreatedAt >= today)) continue;
            try { await CreatePayout(orgId, livemode, currency, null, automatic: true); created++; }
            catch (ApiException) { /* nothing eligible or no destination: skipped, not an error */ }
        }
        return created;
    }

    /// <summary>Monthly statement (§165): opening + movements = closing, all from the ledger.</summary>
    public async Task<object> Statement(string orgId, bool livemode, string currency, DateTime from, DateTime to)
    {
        var accountIds = await db.LedgerAccounts.Where(a => a.OwnerType == "org" && a.OwnerId == orgId && a.Livemode == livemode && a.Currency == currency).Select(a => a.Id).ToListAsync();
        async Task<long> BalanceAt(DateTime at)
        {
            var q = db.LedgerEntries.Where(e => accountIds.Contains(e.AccountId) && e.CreatedAt < at);
            return (await q.Where(e => e.Direction == "C").SumAsync(e => (long?)e.Amount) ?? 0) - (await q.Where(e => e.Direction == "D").SumAsync(e => (long?)e.Amount) ?? 0);
        }
        var txns = await db.BalanceTransactions.Where(t => t.Currency == currency && t.CreatedAt >= from && t.CreatedAt < to).ToListAsync();
        var opening = await BalanceAt(from);
        var closing = await BalanceAt(to);
        long Sum(params string[] types) => txns.Where(t => types.Contains(t.Type)).Sum(t => t.Amount);
        var payments = Sum("payment");
        var refunds = Sum("refund");
        var disputes = Sum("dispute", "dispute_reversal");
        var fees = -txns.Sum(t => t.Fee);
        var adjustments = Sum("adjustment");
        var payouts = Sum("payout", "payout_failure");
        var transfers = Sum("transfer_to_wallet");
        var computed = opening + payments + refunds + disputes + fees + adjustments + payouts + transfers;
        return new
        {
            @object = "statement", currency, period_start = from, period_end = to, opening_balance = opening,
            payments_net_of_tax = payments, refunds, disputes, fees, adjustments, payouts, transfers_to_wallet = transfers,
            closing_balance = closing, reconciles = computed == closing,
            tax_collected_and_remitted_by_platform = await db.TaxRecords.Where(t => t.Currency == currency && t.CreatedAt >= from && t.CreatedAt < to).SumAsync(t => (long?)t.TaxAmount) ?? 0,
        };
    }
}

/// <summary>
/// Reconciliation (§42, §155, §228): compares the platform's attempts/refunds with the provider's own
/// records, and verifies ledger integrity. Mismatches become exceptions for finance to resolve.
/// </summary>
public class ReconciliationService(AppDb db, Uow uow)
{
    public async Task<ReconRun> Run(string triggeredBy)
    {
        using var _ = db.Tenant.Elevate();
        var run = new ReconRun { Id = Ids.New("rrun"), CreatedAt = uow.Now, TriggeredBy = triggeredBy };
        var exceptions = new List<ReconException>();
        var provider = await db.SimProviderRecords.AsNoTracking().Where(r => r.Status == "succeeded").ToListAsync();
        var attempts = await db.PaymentAttempts.AsNoTracking().Where(a => a.Status == "SUCCEEDED").ToListAsync();
        var payments = await db.Payments.AsNoTracking().Where(p => attempts.Select(a => a.PaymentId).Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        var refunds = await db.Refunds.AsNoTracking().Where(r => r.Status == "SUCCEEDED").ToListAsync();
        var matched = 0;

        void Add(string type, string details, string? providerId, string? orgId, string? internalRef, string? externalRef, long? expected, long? actual, string? currency) =>
            exceptions.Add(new ReconException
            {
                Id = Ids.New("rexc"), CreatedAt = uow.Now, RunId = run.Id, Type = type, Details = details, ProviderId = providerId, OrgId = orgId,
                InternalReference = internalRef, ExternalReference = externalRef, ExpectedAmount = expected, ActualAmount = actual, Currency = currency,
            });

        var providerCharges = provider.Where(r => r.Type == "charge").ToList();
        foreach (var dup in providerCharges.GroupBy(r => r.InternalReference).Where(g => g.Key != null && g.Count() > 1))
            Add("duplicate", $"Provider reports {dup.Count()} charges for attempt {dup.Key}.", dup.First().ProviderId, null, dup.Key, string.Join(",", dup.Select(d => d.ProviderReference)), null, null, dup.First().Currency);
        foreach (var a in attempts)
        {
            var p = payments[a.PaymentId];
            var rec = providerCharges.FirstOrDefault(r => r.ProviderReference == a.ProviderTransactionId);
            if (rec == null) { Add("missing_provider", $"Payment {p.Id} succeeded internally but the provider has no matching charge.", a.ProviderId, p.OrgId, p.Id, a.ProviderTransactionId, p.Amount, null, p.Currency); continue; }
            if (rec.Currency != p.Currency) { Add("currency_mismatch", $"Payment {p.Id}: {p.Currency} internally vs {rec.Currency} at provider.", a.ProviderId, p.OrgId, p.Id, rec.ProviderReference, p.Amount, rec.Amount, p.Currency); continue; }
            if (rec.Amount != p.Amount) { Add("amount_mismatch", $"Payment {p.Id}: {Money.Format(p.Amount, p.Currency)} internally vs {Money.Format(rec.Amount, rec.Currency)} at provider.", a.ProviderId, p.OrgId, p.Id, rec.ProviderReference, p.Amount, rec.Amount, p.Currency); continue; }
            if (rec.Fee != p.ProcessorFeeAmount) { Add("fee_mismatch", $"Payment {p.Id}: processor fee {p.ProcessorFeeAmount} booked vs {rec.Fee} charged.", a.ProviderId, p.OrgId, p.Id, rec.ProviderReference, p.ProcessorFeeAmount, rec.Fee, p.Currency); continue; }
            matched++;
        }
        var known = attempts.Select(a => a.ProviderTransactionId).ToHashSet();
        foreach (var rec in providerCharges.Where(r => !known.Contains(r.ProviderReference)))
        {
            // A provider charge whose internal attempt never reached SUCCEEDED: e.g. crash between provider and commit.
            var attempt = await db.PaymentAttempts.AsNoTracking().FirstOrDefaultAsync(a => a.ProviderTransactionId == rec.ProviderReference);
            if (attempt is { Status: "REQUIRES_ACTION" or "PROCESSING" }) continue; // still in flight
            Add("missing_internal", $"Provider charge {rec.ProviderReference} ({Money.Format(rec.Amount, rec.Currency)}) has no successful internal payment.", rec.ProviderId, attempt?.OrgId, attempt?.PaymentId, rec.ProviderReference, null, rec.Amount, rec.Currency);
        }
        var providerRefunds = provider.Where(r => r.Type == "refund").ToList();
        foreach (var r in refunds)
        {
            var rec = providerRefunds.FirstOrDefault(x => x.InternalReference == r.Id);
            if (rec == null) Add("missing_provider", $"Refund {r.Id} succeeded internally but the provider has no record.", null, r.OrgId, r.Id, null, r.Amount, null, r.Currency);
            else if (rec.Amount != r.Amount) Add("amount_mismatch", $"Refund {r.Id} amount differs from provider.", rec.ProviderId, r.OrgId, r.Id, rec.ProviderReference, r.Amount, rec.Amount, r.Currency);
            else matched++;
        }
        foreach (var rec in providerRefunds.Where(x => refunds.All(r => r.Id != x.InternalReference)))
            Add("unknown_refund", $"Provider refund {rec.ProviderReference} is not known internally.", rec.ProviderId, null, rec.InternalReference, rec.ProviderReference, null, rec.Amount, rec.Currency);

        var integrity = await LedgerService.VerifyIntegrity(db);
        if (!(bool)integrity.GetType().GetProperty("balanced")!.GetValue(integrity)!)
            Add("ledger_imbalance", "Ledger integrity check failed: " + Json.Serialize(integrity), null, null, null, null, null, null, null);

        // Only new exceptions: an open exception for the same reference is not duplicated on every run.
        var open = await db.ReconExceptions.Where(e => e.Status == "open").Select(e => e.Type + "|" + e.InternalReference + "|" + e.ExternalReference).ToListAsync();
        var fresh = exceptions.Where(e => !open.Contains(e.Type + "|" + e.InternalReference + "|" + e.ExternalReference)).ToList();
        run.Matched = matched;
        run.Exceptions = fresh.Count;
        run.CompletedAt = uow.Now;
        await uow.Run(async () =>
        {
            db.ReconRuns.Add(run);
            db.ReconExceptions.AddRange(fresh);
            uow.Audit("reconciliation.run", "reconciliation_run", run.Id, after: new { matched, exceptions = fresh.Count });
            await Task.CompletedTask;
        });
        return run;
    }
}
