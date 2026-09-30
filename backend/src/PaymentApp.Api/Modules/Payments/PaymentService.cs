using Microsoft.EntityFrameworkCore;
using PaymentApp.Api.Common;
using PaymentApp.Api.Data;
using PaymentApp.Api.Infrastructure;
using PaymentApp.Api.Modules.Engines;
using PaymentApp.Api.Modules.Ledger;

namespace PaymentApp.Api.Modules.Payments;

public record PayRequest(
    string OrgId, bool Livemode, long Amount, string Currency, long TaxAmount, string? TaxCountry,
    string? CustomerId, string? Email, string? Country,
    string? PaymentMethodId, string? Token,
    string? OrderId, string? InvoiceId, string? CheckoutSessionId, string? Description,
    bool OffSession, string? Ip, string? DeviceId, string? MetadataJson = null);

/// <summary>Downstream reactions to payment outcomes, implemented by checkout/billing (§58).</summary>
public interface IFulfillment
{
    Task OnPaymentSucceeded(Payment payment);
    Task OnPaymentFailed(Payment payment);
    Task OnRefunded(Payment payment, Refund refund, bool full);
    Task OnDisputeLost(Payment payment, Dispute dispute);
}

/// <summary>
/// Payment orchestration (§17-§21). Provider calls always happen outside database transactions; every
/// outcome is then applied in a single unit of work together with its ledger postings, balance
/// transaction, state transition and outbox event.
/// </summary>
public class PaymentService(AppDb db, Uow uow, LedgerService ledger, PaymentRouter router, IPaymentProvider sim,
    IFulfillment fulfillment, IConfiguration config, Marketplace.MarketplaceService marketplace, Risk.RiskRuleService rules)
{
    private const int MaxProvidersPerPayment = 2;

    public record TokenInfo(string Token, string Method, string? Brand, string? Last4, string? CardCountry, string? PaymentMethodId, string? Behavior);

    public async Task<TokenInfo> ResolveToken(string? paymentMethodId, string? token)
    {
        if (paymentMethodId != null)
        {
            var pm = await db.PaymentMethods.FirstOrDefaultAsync(p => p.Id == paymentMethodId && !p.Detached)
                     ?? throw ApiException.NotFound("payment method");
            return new(pm.ProviderToken, pm.Type, pm.Brand, pm.Last4, pm.Country, pm.Id, null);
        }
        if (string.IsNullOrEmpty(token)) throw ApiException.Invalid("A payment method or token is required.");
        var t = await sim.DescribeToken(token) ?? throw new ApiException(400, "invalid_token", "The payment token is invalid or expired.");
        return new(t.Id, t.Type, t.Brand, t.Last4, t.Country, null, t.Behavior);
    }

    public async Task<Payment> Pay(PayRequest r)
    {
        if (r.Amount <= 0) throw ApiException.Invalid("Amount must be positive.");
        var org = await db.Organizations.FirstAsync(o => o.Id == r.OrgId);
        if (org.Restriction is "PAYMENTS_DISABLED" or "SUSPENDED" || org.Status is "SUSPENDED" or "CLOSED" or "REJECTED")
            throw new ApiException(403, "account_restricted", "This merchant cannot accept payments right now.");
        var info = await ResolveToken(r.PaymentMethodId, r.Token);

        var payment = await uow.Run(async () =>
        {
            var p = new Payment
            {
                Id = Ids.New("pay"), CreatedAt = uow.Now, UpdatedAt = uow.Now, OrgId = r.OrgId, Livemode = r.Livemode,
                Amount = r.Amount, Currency = r.Currency, TaxAmount = r.TaxAmount, CustomerId = r.CustomerId, CustomerEmail = r.Email,
                Country = r.Country, OrderId = r.OrderId, InvoiceId = r.InvoiceId, CheckoutSessionId = r.CheckoutSessionId,
                Description = r.Description, PaymentMethodType = info.Method, PaymentMethodId = info.PaymentMethodId,
                CardBrand = info.Brand, CardCountry = info.CardCountry, Last4 = info.Last4, Ip = r.Ip, DeviceId = r.DeviceId, MetadataJson = r.MetadataJson, Status = "CREATED",
            };
            p.MetadataJson ??= Json.Serialize(new Dictionary<string, string> { ["tax_country"] = r.TaxCountry ?? "" });
            db.Payments.Add(p);
            uow.Transition("payment", p.Id, null, "CREATED", r.OrgId);

            var platformDecision = await EvaluateRisk(p, info, org);
            p.RiskScore = platformDecision.Score;
            // The merchant's own rules run after the platform's scoring and can only tighten it (§22).
            var newCustomer = p.CustomerId == null || !await db.Payments.AnyAsync(x => x.CustomerId == p.CustomerId && x.Status == "SUCCEEDED");
            var (decision, rule) = await rules.Apply(platformDecision, Risk.RiskRuleService.FactsFor(p, newCustomer));
            p.RiskRuleId = rule?.Id;
            p.RiskAction = decision.Action;
            p.RiskReasonsJson = Json.Serialize(decision.Signals);
            if (decision.Action == "REVIEW") p.ReviewStatus = "pending";
            uow.Emit("payment.created", p);
            if (decision.Action == "DECLINE") await Fail(p, null, "risk_declined", "risk_declined");
            return p;
        });
        if (payment.Status == "FAILED") return payment;
        return await Attempt(payment, info, r.OffSession, payment.RiskAction == "CHALLENGE", r.TaxCountry);
    }

    private async Task<RiskDecision> EvaluateRisk(Payment p, TokenInfo info, Organization org)
    {
        var tenMinutes = uow.Now.AddMinutes(-10);
        var hour = uow.Now.AddHours(-1);
        var identity = db.Payments.IgnoreQueryFilters().Where(x => x.OrgId == p.OrgId && x.Livemode == p.Livemode && x.Id != p.Id
            && ((p.CustomerEmail != null && x.CustomerEmail == p.CustomerEmail) || (p.Ip != null && x.Ip == p.Ip)));
        var attempts = await identity.CountAsync(x => x.CreatedAt >= tenMinutes);
        var failures = await identity.CountAsync(x => x.CreatedAt >= hour && x.Status == "FAILED");
        var disputes = p.CustomerEmail == null ? 0 : await db.Disputes.IgnoreQueryFilters()
            .Join(db.Payments.IgnoreQueryFilters(), d => d.PaymentId, x => x.Id, (d, x) => x)
            .CountAsync(x => x.CustomerEmail == p.CustomerEmail);
        var newCustomer = p.CustomerId == null || !await db.Payments.AnyAsync(x => x.CustomerId == p.CustomerId && x.Status == "SUCCEEDED");
        var input = new RiskInput(FxTable.ToUsd(p.Amount, p.Currency), p.CustomerEmail, p.Country, info.CardCountry, p.Ip,
            attempts, failures, disputes, org.RiskLevel, newCustomer);
        return RiskEngine.Evaluate(input,
            config.GetValue("Risk:ReviewScore", 60), config.GetValue("Risk:DeclineScore", 85), config.GetValue("Risk:ChallengeScore", 40));
    }

    private async Task<Payment> Attempt(Payment payment, TokenInfo info, bool offSession, bool forceChallenge, string? taxCountry)
    {
        var candidates = await router.Candidates(payment.OrgId, payment.Livemode, payment.Country, payment.Currency, info.Method, payment.Id);
        if (candidates.Count == 0)
            return await uow.Run(async () => { await Fail(payment, null, "no_provider_available", "provider_unavailable"); return payment; });

        var tried = 0;
        foreach (var candidate in candidates)
        {
            if (tried++ >= MaxProvidersPerPayment) break;
            var attempt = await uow.Run(async () =>
            {
                var a = new PaymentAttempt
                {
                    Id = Ids.New("pa"), CreatedAt = uow.Now, OrgId = payment.OrgId, Livemode = payment.Livemode, PaymentId = payment.Id,
                    ProviderId = candidate.Provider.Id, Status = "PROCESSING", RoutingReason = tried > 1 ? $"failover: {candidate.Reason}" : candidate.Reason,
                };
                db.PaymentAttempts.Add(a);
                if (payment.Status != "PROCESSING")
                {
                    uow.Transition("payment", payment.Id, payment.Status, "PROCESSING", payment.OrgId);
                    payment.Status = "PROCESSING";
                    payment.UpdatedAt = uow.Now;
                    uow.Emit("payment.processing", payment);
                }
                return a;
            });

            var charge = new ProviderCharge(candidate.Provider.Id, info.Token, payment.Amount, payment.Currency, attempt.Id, offSession, forceChallenge);
            var result = await sim.Authorize(candidate.Provider, charge, capture: true);
            var providerFault = result.Status == "unavailable";
            await router.RecordHealth(candidate.Provider, !providerFault, result.LatencyMs, providerFault ? result.ErrorCode : null, payment.Country, info.Method);
            if (providerFault)
            {
                await uow.Run(async () =>
                {
                    attempt.Status = "FAILED";
                    attempt.ErrorCode = "provider_error";
                    attempt.ProviderErrorCode = result.ErrorCode;
                    attempt.LatencyMs = result.LatencyMs;
                    attempt.CompletedAt = uow.Now;
                    await Task.CompletedTask;
                });
                continue; // smart retry on the next provider; issuer declines never reach here
            }
            var applied = await ApplyResult(payment.Id, attempt.Id, result);
            if (result.Behavior == "dispute" && applied.Status == "SUCCEEDED")
                await SimulateProviderDispute(applied);
            return applied;
        }
        return await uow.Run(async () => { await Fail(payment, null, "provider_unavailable", "provider_unavailable"); return payment; });
    }

    /// <summary>Applies a provider outcome. Safe to call more than once for the same result (duplicate webhooks).</summary>
    public async Task<Payment> ApplyResult(string paymentId, string attemptId, ProviderResult result)
    {
        var owner = await db.Payments.IgnoreQueryFilters().AsNoTracking().Where(x => x.Id == paymentId).Select(x => new { x.OrgId, x.Livemode }).FirstAsync();
        using var _ = db.Tenant.Use(owner.OrgId, owner.Livemode);
        return await uow.Run(async () =>
        {
            var p = await db.Payments.IgnoreQueryFilters().FirstAsync(x => x.Id == paymentId);
            var a = await db.PaymentAttempts.IgnoreQueryFilters().FirstAsync(x => x.Id == attemptId);
            if (p.Status is "SUCCEEDED" or "FAILED" or "REFUNDED" or "PARTIALLY_REFUNDED" or "DISPUTED" or "CHARGEBACK" or "CANCELLED")
                return p; // terminal: duplicate callbacks cannot create duplicate financial effects (§151)
            a.LatencyMs = result.LatencyMs;
            a.ProviderTransactionId = result.ProviderTransactionId ?? a.ProviderTransactionId;
            a.ThreeDsResult = result.ThreeDsResult ?? a.ThreeDsResult;
            switch (result.Status)
            {
                case "succeeded":
                    await MarkSucceeded(p, a, result);
                    break;
                case "requires_action":
                    a.Status = "REQUIRES_ACTION";
                    uow.Transition("payment", p.Id, p.Status, "REQUIRES_ACTION", p.OrgId);
                    p.Status = "REQUIRES_ACTION";
                    p.ProviderId = a.ProviderId;
                    p.ProviderTransactionId = result.ProviderTransactionId;
                    p.NextActionJson = Json.Serialize(new { type = "three_d_secure", redirect_url = result.NextActionUrl });
                    p.UpdatedAt = uow.Now;
                    uow.Emit("payment.requires_action", p);
                    break;
                case "processing":
                    a.Status = "PROCESSING";
                    p.ProviderId = a.ProviderId;
                    p.ProviderTransactionId = result.ProviderTransactionId;
                    p.UpdatedAt = uow.Now;
                    break;
                default:
                    a.Status = "FAILED";
                    a.CompletedAt = uow.Now;
                    a.ProviderErrorCode = result.ErrorCode;
                    var decline = DeclineCatalog.For(result.ErrorCode ?? "payment_failed");
                    a.ErrorCode = decline.Code;
                    a.DeclineType = decline.Soft ? "soft" : "hard";
                    p.ThreeDsResult = result.ThreeDsResult ?? p.ThreeDsResult;
                    await Fail(p, a.ProviderId, decline.Code, result.ErrorCode ?? "payment_failed");
                    break;
            }
            return p;
        });
    }

    private async Task Fail(Payment p, string? providerId, string code, string providerCode)
    {
        var decline = DeclineCatalog.For(code);
        uow.Transition("payment", p.Id, p.Status, "FAILED", p.OrgId, code);
        p.Status = "FAILED";
        p.ProviderId = providerId ?? p.ProviderId;
        p.FailureCode = decline.Code;
        p.FailureMessage = decline.Message;
        p.SuggestedAction = decline.SuggestedAction;
        p.ProviderFailureCode = providerCode;
        p.NextActionJson = null;
        p.UpdatedAt = uow.Now;
        uow.Emit("payment.failed", p);
        await fulfillment.OnPaymentFailed(p);
    }

    private async Task MarkSucceeded(Payment p, PaymentAttempt a, ProviderResult result)
    {
        var org = await db.Organizations.FirstAsync(o => o.Id == p.OrgId);
        a.Status = "SUCCEEDED";
        a.CompletedAt = uow.Now;
        uow.Transition("payment", p.Id, p.Status, "SUCCEEDED", p.OrgId);
        p.Status = "SUCCEEDED";
        p.AmountCaptured = p.Amount;
        p.ProviderId = a.ProviderId;
        p.ProviderTransactionId = result.ProviderTransactionId ?? a.ProviderTransactionId;
        p.ThreeDsResult = result.ThreeDsResult ?? a.ThreeDsResult;
        p.NextActionJson = null;
        p.ProcessorFeeAmount = result.Fee;
        p.CardBrand ??= result.Brand;
        p.Last4 ??= result.Last4;

        var schedules = await db.FeeSchedules.Where(f => f.Active).ToListAsync();
        var fee = FeeEngine.Compute(p.Amount, p.Currency, p.PaymentMethodType ?? "card", p.Country, org.Country, p.OrgId, schedules,
            (amt, from, to) => Money.Convert(amt, from, to, FxTable.MidRateE9(from, to)));
        p.FeeAmount = fee.Total;
        p.NetAmount = p.Amount - p.TaxAmount - p.FeeAmount;
        p.UpdatedAt = uow.Now;

        // MoR posting (§40): the platform receives the full charge at the PSP, owes the tax to the
        // jurisdiction and the remainder (minus its fee) to the merchant, and books its PSP cost.
        var taxCountry = Json.Deserialize<Dictionary<string, string>>(p.MetadataJson)?.GetValueOrDefault("tax_country");
        if (string.IsNullOrEmpty(taxCountry)) taxCountry = p.Country ?? org.Country;
        var clearing = await ledger.Platform(Accounts.ProviderClearing(p.ProviderId!), p.Currency, p.Livemode);
        var legs = new List<Leg>
        {
            Leg.Debit(clearing, p.Amount),
            Leg.Credit(await ledger.Merchant(p.OrgId, Accounts.MerchantPending, p.Currency, p.Livemode), p.Amount - p.TaxAmount),
            Leg.Debit(await ledger.Merchant(p.OrgId, Accounts.MerchantPending, p.Currency, p.Livemode), p.FeeAmount),
            Leg.Credit(await ledger.Platform(Accounts.FeeRevenue, p.Currency, p.Livemode), p.FeeAmount),
            Leg.Debit(await ledger.Platform(Accounts.ProcessorFees, p.Currency, p.Livemode), p.ProcessorFeeAmount),
            Leg.Credit(clearing, p.ProcessorFeeAmount),
        };
        if (p.TaxAmount > 0) legs.Add(Leg.Credit(await ledger.Platform(Accounts.TaxPayable(taxCountry), p.Currency, p.Livemode), p.TaxAmount));
        var ltx = await ledger.Post("payment", $"payment:{p.Id}", $"Payment {p.Id}", "payment", p.Id, p.OrgId, p.Livemode, legs);

        var held = p.RiskAction == "REVIEW" || org.Restriction == "PAYOUT_HOLD";
        var merchantTxn = new BalanceTransaction
        {
            Id = Ids.New("txn"), CreatedAt = uow.Now, OrgId = p.OrgId, Livemode = p.Livemode, Type = "payment",
            Amount = p.Amount - p.TaxAmount, Fee = p.FeeAmount, Net = p.NetAmount, Currency = p.Currency,
            SourceType = "payment", SourceId = p.Id, Status = "pending", AvailableOn = uow.Now.AddDays(org.SettlementDelayDays),
            LedgerTransactionId = ltx.Id, HeldForReview = held,
            Description = $"Payment {p.Id} (tax {Money.Format(p.TaxAmount, p.Currency)} remitted by platform)",
        };
        db.BalanceTransactions.Add(merchantTxn);
        if (p.CheckoutSessionId != null && await db.CheckoutSessions.FirstOrDefaultAsync(s => s.Id == p.CheckoutSessionId) is { SellerId: not null } session)
            await marketplace.Split(p, session, merchantTxn, org.SettlementDelayDays);
        uow.Emit("payment.succeeded", p);
        await fulfillment.OnPaymentSucceeded(p);
    }

    // ───────────────────────── 3-D Secure / async completion ─────────────────────────

    public async Task<Payment> CompleteAuthentication(Payment payment, bool passed)
    {
        if (payment.Status != "REQUIRES_ACTION") throw ApiException.Conflict("invalid_state", "This payment does not require authentication.");
        var attempt = await db.PaymentAttempts.IgnoreQueryFilters().Where(a => a.PaymentId == payment.Id).OrderByDescending(a => a.CreatedAt).FirstAsync();
        var provider = await db.Providers.FirstAsync(p => p.Id == attempt.ProviderId);
        var result = await sim.CompleteAuthentication(provider, attempt.ProviderTransactionId!, passed);
        return await ApplyResult(payment.Id, attempt.Id, result);
    }

    // ───────────────────────── Refunds (§36, §153) ─────────────────────────

    public async Task<Refund> CreateRefund(string paymentId, long? amount, string? reason)
    {
        var refund = await uow.Run(async () =>
        {
            var p = await db.Payments.FirstOrDefaultAsync(x => x.Id == paymentId) ?? throw ApiException.NotFound("payment");
            if (p.Status is not ("SUCCEEDED" or "PARTIALLY_REFUNDED"))
                throw ApiException.Conflict("payment_not_refundable", $"A payment in status {p.Status} cannot be refunded.");
            var inFlight = await db.Refunds.Where(r => r.PaymentId == p.Id && (r.Status == "REQUESTED" || r.Status == "PROCESSING")).SumAsync(r => (long?)r.Amount) ?? 0;
            var refundable = p.AmountCaptured - p.AmountRefunded - p.AmountDisputed - inFlight;
            var amt = amount ?? refundable;
            if (amt <= 0) throw ApiException.Invalid("Refund amount must be positive.");
            if (amt > refundable)
                throw ApiException.Conflict("amount_too_large", $"Refund of {Money.Format(amt, p.Currency)} exceeds the refundable {Money.Format(refundable, p.Currency)}.");

            // Pro-rata tax, with the final refund taking the exact remainder so rounding never drifts.
            var taxRefunded = await db.Refunds.Where(r => r.PaymentId == p.Id && r.Status == "SUCCEEDED").SumAsync(r => (long?)r.TaxAmount) ?? 0;
            var taxInFlight = await db.Refunds.Where(r => r.PaymentId == p.Id && (r.Status == "REQUESTED" || r.Status == "PROCESSING")).SumAsync(r => (long?)r.TaxAmount) ?? 0;
            var isFinal = amt == refundable && p.AmountDisputed == 0;
            var tax = isFinal ? p.TaxAmount - taxRefunded - taxInFlight : Money.Ratio(p.TaxAmount, amt, p.Amount, p.Currency);

            var r = new Refund
            {
                Id = Ids.New("rfnd"), CreatedAt = uow.Now, PaymentId = p.Id, Amount = amt, TaxAmount = tax, Currency = p.Currency,
                Status = "PROCESSING", Reason = reason, RequestedBy = uow.Ctx.ActorId,
            };
            db.Refunds.Add(r);
            uow.Transition("refund", r.Id, null, "REQUESTED", p.OrgId);
            uow.Transition("refund", r.Id, "REQUESTED", "PROCESSING", p.OrgId);
            uow.Emit("refund.created", r);
            uow.Audit("refund.create", "refund", r.Id, after: new { r.PaymentId, r.Amount, r.Currency, r.Reason });
            return r;
        });

        var payment = await db.Payments.FirstAsync(x => x.Id == paymentId);
        var provider = await db.Providers.FirstAsync(x => x.Id == payment.ProviderId);
        var result = await sim.Refund(provider, payment.ProviderTransactionId!, refund.Amount, refund.Currency, refund.Id);
        return await CompleteRefund(refund.Id, result.Status == "succeeded", result.ProviderTransactionId, result.ErrorCode);
    }

    private async Task<Refund> CompleteRefund(string refundId, bool succeeded, string? providerRef, string? error)
    {
        return await uow.Run(async () =>
        {
            var r = await db.Refunds.FirstAsync(x => x.Id == refundId);
            if (r.Status is "SUCCEEDED" or "FAILED") return r;
            var p = await db.Payments.FirstAsync(x => x.Id == r.PaymentId);
            if (!succeeded)
            {
                uow.Transition("refund", r.Id, r.Status, "FAILED", p.OrgId, error);
                r.Status = "FAILED";
                r.FailureReason = error;
                uow.Emit("refund.failed", r);
                return r;
            }
            uow.Transition("refund", r.Id, r.Status, "SUCCEEDED", p.OrgId);
            r.Status = "SUCCEEDED";
            r.ProviderRefundId = providerRef;
            r.CompletedAt = uow.Now;
            p.AmountRefunded += r.Amount;
            if (p.AmountRefunded > p.AmountCaptured) throw new InvalidOperationException("Over-refund prevented.");
            var newStatus = p.AmountRefunded == p.AmountCaptured ? "REFUNDED" : "PARTIALLY_REFUNDED";
            uow.Transition("payment", p.Id, p.Status, newStatus, p.OrgId);
            p.Status = newStatus;
            p.UpdatedAt = uow.Now;

            var taxCountry = Json.Deserialize<Dictionary<string, string>>(p.MetadataJson)?.GetValueOrDefault("tax_country") ?? p.Country ?? "US";
            var legs = new List<Leg>
            {
                Leg.Debit(await ledger.Merchant(p.OrgId, Accounts.MerchantAvailable, p.Currency, p.Livemode), r.Amount - r.TaxAmount),
                Leg.Credit(await ledger.Platform(Accounts.ProviderClearing(p.ProviderId!), p.Currency, p.Livemode), r.Amount),
            };
            if (r.TaxAmount > 0) legs.Add(Leg.Debit(await ledger.Platform(Accounts.TaxPayable(taxCountry), p.Currency, p.Livemode), r.TaxAmount));
            var paymentLtx = await db.LedgerTransactions.FirstAsync(t => t.PostingKey == $"payment:{p.Id}");
            var ltx = await ledger.Post("refund", $"refund:{r.Id}", $"Refund {r.Id} of {p.Id}", "refund", r.Id, p.OrgId, p.Livemode, legs, parentId: paymentLtx.Id);
            await marketplace.Clawback(p, r.Amount - r.TaxAmount, "refund", "refund", r.Id);
            db.BalanceTransactions.Add(new BalanceTransaction
            {
                Id = Ids.New("txn"), CreatedAt = uow.Now, OrgId = p.OrgId, Livemode = p.Livemode, Type = "refund",
                Amount = -(r.Amount - r.TaxAmount), Fee = 0, Net = -(r.Amount - r.TaxAmount), Currency = p.Currency,
                SourceType = "refund", SourceId = r.Id, Status = "available", AvailableOn = uow.Now, LedgerTransactionId = ltx.Id,
                Description = $"Refund of {p.Id} (platform fee retained)",
            });
            var originalTaxType = await db.TaxRecords.Where(t => t.TaxAmount > 0 && ((p.OrderId != null && t.OrderId == p.OrderId) || (p.InvoiceId != null && t.InvoiceId == p.InvoiceId)))
                .Select(t => t.TaxType).FirstOrDefaultAsync() ?? "VAT";
            if (r.TaxAmount > 0)
                db.TaxRecords.Add(new TaxRecord
                {
                    Id = Ids.New("taxrec"), CreatedAt = uow.Now, OrgId = p.OrgId, Livemode = p.Livemode, SourceType = "refund", SourceId = r.Id,
                    OrderId = p.OrderId, InvoiceId = p.InvoiceId, Country = taxCountry, TaxType = originalTaxType, TaxableAmount = -(r.Amount - r.TaxAmount),
                    TaxAmount = -r.TaxAmount, Currency = p.Currency,
                });
            uow.Emit("refund.succeeded", r);
            uow.Emit("payment.refunded", p);
            await fulfillment.OnRefunded(p, r, newStatus == "REFUNDED");
            return r;
        });
    }

    // ───────────────────────── Disputes (§37, §285) ─────────────────────────

    public async Task SimulateProviderDispute(Payment p, string reason = "fraudulent")
    {
        var payload = Json.Serialize(new
        {
            id = Ids.New("simevt"),
            type = "dispute.created",
            provider_transaction_id = p.ProviderTransactionId,
            dispute_id = Ids.New("pdp", 14),
            amount = p.Amount - p.AmountRefunded,
            currency = p.Currency,
            reason,
        });
        await HandleProviderWebhook(p.ProviderId!, payload, SimulatorProvider.SignWebhook(config, payload));
    }

    /// <summary>Provider webhooks: authenticated, deduplicated, stored, then processed (§227).</summary>
    public async Task<ProviderEvent> HandleProviderWebhook(string providerId, string payload, string signature)
    {
        var provider = await db.Providers.FirstOrDefaultAsync(p => p.Id == providerId) ?? throw ApiException.NotFound("provider");
        if (!sim.VerifyWebhookSignature(provider, payload, signature)) throw new ApiException(400, "invalid_signature", "Webhook signature verification failed.");
        var doc = System.Text.Json.JsonDocument.Parse(payload).RootElement;
        var eventId = doc.GetProperty("id").GetString()!;
        var existing = await db.ProviderEvents.FirstOrDefaultAsync(e => e.ProviderId == providerId && e.ProviderEventId == eventId);
        if (existing != null) return existing; // duplicate delivery: acknowledged, not reprocessed
        var pe = new ProviderEvent
        {
            Id = Ids.New("pevt"), CreatedAt = uow.Now, ProviderId = providerId, ProviderEventId = eventId,
            Type = doc.GetProperty("type").GetString()!, Payload = payload,
        };
        db.ProviderEvents.Add(pe);
        await db.SaveChangesAsync();
        try
        {
            await ProcessProviderEvent(pe, doc);
            pe.Status = "processed";
        }
        catch (Exception ex) when (ex is not ApiException)
        {
            pe.Status = "failed";
            pe.Error = ex.Message;
        }
        pe.ProcessedAt = uow.Now;
        await db.SaveChangesAsync();
        return pe;
    }

    private async Task ProcessProviderEvent(ProviderEvent pe, System.Text.Json.JsonElement doc)
    {
        var providerTxn = doc.GetProperty("provider_transaction_id").GetString();
        var payment = await db.Payments.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.ProviderTransactionId == providerTxn)
                      ?? throw new InvalidOperationException($"Unknown provider transaction {providerTxn}.");
        switch (pe.Type)
        {
            case "charge.succeeded":
            case "charge.failed":
            {
                var attempt = await db.PaymentAttempts.IgnoreQueryFilters().FirstAsync(a => a.PaymentId == payment.Id && a.ProviderTransactionId == providerTxn);
                var ok = pe.Type == "charge.succeeded";
                var fee = doc.TryGetProperty("fee", out var f) ? f.GetInt64() : 0;
                await ApplyResult(payment.Id, attempt.Id, ok ? new ProviderResult("succeeded", providerTxn, Fee: fee) : new ProviderResult("failed", providerTxn, ErrorCode: "upi_declined"));
                break;
            }
            case "dispute.created":
                await OpenDispute(payment, doc.GetProperty("dispute_id").GetString()!, doc.GetProperty("amount").GetInt64(), doc.GetProperty("reason").GetString() ?? "general");
                break;
            case "dispute.closed":
                await CloseDispute(doc.GetProperty("dispute_id").GetString()!, doc.GetProperty("outcome").GetString() == "won");
                break;
        }
    }

    private async Task OpenDispute(Payment snapshot, string providerDisputeId, long amount, string reason)
    {
        using var _ = db.Tenant.Use(snapshot.OrgId, snapshot.Livemode);
        await uow.Run(async () =>
        {
            var p = await db.Payments.FirstAsync(x => x.Id == snapshot.Id);
            if (await db.Disputes.AnyAsync(d => d.ProviderDisputeId == providerDisputeId)) return;
            var feeUsd = config.GetValue<long>("Fees:DisputeFeeUsdMinor", 1500);
            var fee = p.Currency == "USD" ? feeUsd : Money.Convert(feeUsd, "USD", p.Currency, FxTable.MidRateE9("USD", p.Currency));
            var d = new Dispute
            {
                Id = Ids.New("dspt"), CreatedAt = uow.Now, OrgId = p.OrgId, Livemode = p.Livemode, PaymentId = p.Id, Amount = amount,
                FeeAmount = fee, Currency = p.Currency, Reason = reason, ProviderDisputeId = providerDisputeId, EvidenceDueBy = uow.Now.AddDays(7),
            };
            db.Disputes.Add(d);
            var tax = Money.Ratio(p.TaxAmount, amount, p.Amount, p.Currency);
            p.AmountDisputed += amount;
            uow.Transition("payment", p.Id, p.Status, "DISPUTED", p.OrgId, reason);
            p.Status = "DISPUTED";
            p.UpdatedAt = uow.Now;
            var taxCountry = Json.Deserialize<Dictionary<string, string>>(p.MetadataJson)?.GetValueOrDefault("tax_country") ?? p.Country ?? "US";
            var available = await ledger.Merchant(p.OrgId, Accounts.MerchantAvailable, p.Currency, p.Livemode);
            var clearing = await ledger.Platform(Accounts.ProviderClearing(p.ProviderId!), p.Currency, p.Livemode);
            var legs = new List<Leg>
            {
                Leg.Debit(available, amount - tax),
                Leg.Credit(clearing, amount),
                // Dispute fee: the PSP charges the platform, the platform charges the merchant.
                Leg.Debit(available, fee),
                Leg.Credit(await ledger.Platform(Accounts.FeeRevenue, p.Currency, p.Livemode), fee),
                Leg.Debit(await ledger.Platform(Accounts.ProcessorFees, p.Currency, p.Livemode), fee),
                Leg.Credit(clearing, fee),
            };
            if (tax > 0) legs.Add(Leg.Debit(await ledger.Platform(Accounts.TaxPayable(taxCountry), p.Currency, p.Livemode), tax));
            var paymentLtx = await db.LedgerTransactions.FirstAsync(t => t.PostingKey == $"payment:{p.Id}");
            var ltx = await ledger.Post("dispute", $"dispute:{d.Id}", $"Dispute {d.Id} on {p.Id}", "dispute", d.Id, p.OrgId, p.Livemode, legs, paymentLtx.Id);
            await marketplace.Clawback(p, amount - tax, "dispute", "dispute", d.Id);
            db.BalanceTransactions.Add(new BalanceTransaction
            {
                Id = Ids.New("txn"), CreatedAt = uow.Now, OrgId = p.OrgId, Livemode = p.Livemode, Type = "dispute", Amount = -(amount - tax),
                Fee = fee, Net = -(amount - tax) - fee, Currency = p.Currency, SourceType = "dispute", SourceId = d.Id, Status = "available",
                AvailableOn = uow.Now, LedgerTransactionId = ltx.Id, Description = $"Chargeback withdrawn for {p.Id}",
            });
            if (p.OrderId != null)
            {
                var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == p.OrderId);
                if (order != null) { order.Status = "disputed"; order.UpdatedAt = uow.Now; }
            }
            uow.Emit("dispute.created", d);
        });
    }

    public async Task<Dispute> SubmitEvidence(string disputeId, IEnumerable<(string Type, string Text, string? FileId)> evidence, bool submit)
    {
        return await uow.Run(async () =>
        {
            var d = await db.Disputes.FirstOrDefaultAsync(x => x.Id == disputeId) ?? throw ApiException.NotFound("dispute");
            if (d.Status != "needs_response") throw ApiException.Conflict("dispute_not_open", "Evidence can only be added while the dispute needs a response.");
            foreach (var (type, text, fileId) in evidence)
                db.DisputeEvidence.Add(new DisputeEvidence { Id = Ids.New("dsev"), CreatedAt = uow.Now, DisputeId = d.Id, Type = type, Text = text, FileId = fileId, AddedBy = uow.Ctx.ActorId });
            if (submit)
            {
                uow.Transition("dispute", d.Id, d.Status, "under_review", d.OrgId);
                d.Status = "under_review";
                d.SubmittedAt = uow.Now;
            }
            uow.Emit("dispute.updated", d);
            uow.Audit("dispute.evidence", "dispute", d.Id, after: new { submitted = submit });
            return d;
        });
    }

    public async Task CloseDispute(string providerDisputeId, bool won)
    {
        var owner = await db.Disputes.IgnoreQueryFilters().AsNoTracking().FirstAsync(x => x.ProviderDisputeId == providerDisputeId);
        using var _ = db.Tenant.Use(owner.OrgId, owner.Livemode);
        await uow.Run(async () =>
        {
            var d = await db.Disputes.FirstAsync(x => x.ProviderDisputeId == providerDisputeId);
            if (d.Status is "won" or "lost") return;
            var p = await db.Payments.FirstAsync(x => x.Id == d.PaymentId);
            uow.Transition("dispute", d.Id, d.Status, won ? "won" : "lost", d.OrgId);
            d.Status = won ? "won" : "lost";
            d.ClosedAt = uow.Now;
            if (won)
            {
                // Funds come back; the dispute fee is not refunded.
                var tax = Money.Ratio(p.TaxAmount, d.Amount, p.Amount, p.Currency);
                var taxCountry = Json.Deserialize<Dictionary<string, string>>(p.MetadataJson)?.GetValueOrDefault("tax_country") ?? p.Country ?? "US";
                var legs = new List<Leg>
                {
                    Leg.Debit(await ledger.Platform(Accounts.ProviderClearing(p.ProviderId!), p.Currency, p.Livemode), d.Amount),
                    Leg.Credit(await ledger.Merchant(p.OrgId, Accounts.MerchantAvailable, p.Currency, p.Livemode), d.Amount - tax),
                };
                if (tax > 0) legs.Add(Leg.Credit(await ledger.Platform(Accounts.TaxPayable(taxCountry), p.Currency, p.Livemode), tax));
                var ltx = await ledger.Post("dispute_reversal", $"dispute_won:{d.Id}", $"Dispute {d.Id} won", "dispute", d.Id, p.OrgId, p.Livemode, legs);
                await marketplace.Clawback(p, d.Amount - tax, "dispute_reversal", "dispute", d.Id, reverse: true);
                db.BalanceTransactions.Add(new BalanceTransaction
                {
                    Id = Ids.New("txn"), CreatedAt = uow.Now, OrgId = p.OrgId, Livemode = p.Livemode, Type = "dispute_reversal",
                    Amount = d.Amount - tax, Net = d.Amount - tax, Currency = p.Currency, SourceType = "dispute", SourceId = d.Id,
                    Status = "available", AvailableOn = uow.Now, LedgerTransactionId = ltx.Id, Description = $"Dispute won for {p.Id}",
                });
                p.AmountDisputed -= d.Amount;
                var restored = p.AmountRefunded > 0 ? "PARTIALLY_REFUNDED" : "SUCCEEDED";
                uow.Transition("payment", p.Id, p.Status, restored, p.OrgId, "dispute won");
                p.Status = restored;
            }
            else
            {
                uow.Transition("payment", p.Id, p.Status, "CHARGEBACK", p.OrgId, "dispute lost");
                p.Status = "CHARGEBACK";
                await fulfillment.OnDisputeLost(p, d);
            }
            p.UpdatedAt = uow.Now;
            uow.Emit("dispute.updated", d);
            uow.Emit(won ? "dispute.won" : "dispute.lost", d);
        });
    }
}
