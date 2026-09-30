# Architecture

A modular monolith (URS §316-§317). There is one deployable ASP.NET Core service with strict module
boundaries, a Next.js web app with three surfaces (merchant, admin, and buyer-facing checkout and
portal), a Flutter app with business and wallet modes, a TypeScript SDK and a CLI.

```
                        ┌────────────── web (Next.js) ──────────────┐   mobile (Flutter)
                        │ merchant dashboard · admin/compliance     │   business + wallet
                        │ hosted checkout · payment links · portal  │
                        └──────────────────┬────────────────────────┘          │
                                           │ REST /v1 (JSON, snake_case)       │
┌──────────────────────────────────────────▼───────────────────────────────────▼───────┐
│ ErrorMiddleware → CORS → AuthMiddleware (session | sk_/rk_ key → RequestContext +      │
│ TenantScope) → RateLimiter → RequestLog → Idempotency → endpoints                      │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Identity · Merchants/KYB · Catalog/Pricing · Checkout · Payments(+Router, Providers)    │
│ Billing(Subscriptions, Invoices, Usage, Credits, Test clocks) · Tax · Risk              │
│ Treasury(Settlement, Reserves, Payouts, Statements) · Reconciliation                    │
│ Wallet(FX, Transfers, Withdrawals, Bank accounts) · Compliance(Screening, Monitoring,   │
│ Cases, Approvals, Fund flow) · Reports · Copilot (Claude) · Platform(Outbox, Webhooks,   │
│ Notifications, Jobs)                                                                    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Financial core: Uow (one DB transaction per business operation) → LedgerService         │
│ (append-only double entry) → Audit (hash chain) → StateTransitions → Outbox events      │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ EF Core → SQLite (dev/test).                                                            │
│ Append-only triggers on ledger, audit, transitions, evidence and access logs.           │
└────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ provider adapters (IPaymentProvider)       ▲ JobHost: renewals, dunning, settlement,
        │ sim_alpha / sim_beta simulators            │ reserves, payouts, withdrawals, outbox,
        │ + signed provider webhooks                 │ webhooks, reconciliation
```

## The rules the code enforces

| Rule (URS) | Where |
|---|---|
| Money is integer minor units, with a per-currency exponent and rounding (§14, §135, §137) | `Common/Money.cs`. Int128 math, no floating point on money paths |
| Double-entry, append-only ledger. Corrections are reversals (§40, §278, §337) | `Modules/Ledger/LedgerService.cs` balances every posting per currency and dedupes by posting key. SQLite triggers reject UPDATE/DELETE |
| Business state, ledger, audit and events commit together (§82, §83, §197) | `Infrastructure/UnitOfWork.cs`. `BEGIN IMMEDIATE` on SQLite, SERIALIZABLE elsewhere. The outbox is written in the same transaction |
| Tenant isolation is server-side (§81, §195) | EF global query filters on every merchant-owned entity, plus a SaveChanges guard against cross-tenant writes. Only admin endpoints and jobs elevate, explicitly |
| Idempotency on every POST (§20) | `IdempotencyMiddleware` stores the first response per (scope, key) and returns 422 when a key is reused with a different body. Postings, usage and credits are also idempotent by key |
| Order ≠ payment ≠ attempt ≠ provider transaction (§141) | `Order`, `Payment`, `PaymentAttempt` and `SimProviderRecord` are separate |
| Provider calls happen outside DB transactions; outcomes apply atomically | `PaymentService.Attempt` → `ApplyResult`. Duplicate provider callbacks are no-ops once the payment is terminal |
| Failover only on provider faults, never on issuer declines (§21) | `PaymentService.Attempt` + `PaymentRouter` (rules, health, priority) |
| Balances come from the ledger (§143, §279) | `TreasuryService.Balance`. Balance transactions are only the merchant-facing explanation |
| Tax decisions are versioned and traceable (§32, §33, §266) | `TaxEngine` records the rule id and version on every line. `TaxRecord` rows link order/invoice → rule → amount |
| Billing is reproducible (§26) | Pure `PricingEngine`. Every invoice stores `calculation_inputs` |
| Risk ≠ guilt; alerts are explainable (§3.5, §94, §174) | `RiskEngine` and `MonitoringService` return named signals with observed vs threshold; titles are non-accusatory |
| Consequential actions need four eyes (§68, §206) | `ComplianceService.RequestApproval/DecideApproval`: the requester can't approve, and the approver needs `admin.approve` plus the action's permission plus a recent step-up |
| No tipping off (§71, §159) | Customers see only `customer_message`. `internal_reason` is admin-only |
| Access to sensitive data is itself logged (§134, §298) | `DataAccessLog`, written by admin user/case/fund-flow views. Masking unless `admin.pii.unmask` is granted and requested |
| Audit is tamper-evident (§140) | `AuditLog` hash chain, checked by `GET /v1/admin/ledger/integrity` |
| Secrets are never stored in plaintext (§70, §197-§199) | AES-256-GCM `FieldEncryptor` with key versions for webhook secrets, bank numbers and TOTP seeds. API keys and sessions are stored as SHA-256 hashes |
| PAN/CVV never reach the platform (§76, §162) | Hosted card fields are simulated by `/v1/public/sim/tokens`. Only tokens, last4 and brand are stored |

## Money flows as postings

| Event | Debit | Credit |
|---|---|---|
| Payment (MoR) | provider_clearing (amount); merchant_pending (platform fee); processor_fees (PSP cost) | merchant_pending (amount − tax); tax_payable.{country} (tax); platform_revenue.fees (fee); provider_clearing (PSP cost) |
| Settlement (after delay) | merchant_pending | merchant_available (+ merchant_reserve for the rolling reserve) |
| Refund | merchant_available (net); tax_payable (pro-rata tax) | provider_clearing |
| Dispute opened | merchant_available (net + fee); tax_payable; processor_fees | provider_clearing; platform_revenue.fees |
| Payout / paid / failed | merchant_available → payout_clearing → platform_bank (or back to available) | |
| Wallet funding | safeguarding_bank | wallet.{currency} |
| Wallet transfer, cross-currency | wallet(src) + fx_clearing(dst) | fx_clearing(src) + wallet(dst) + platform_revenue.fx (spread) + fees |
| Withdrawal | wallet → payout_clearing → safeguarding_bank (or returned to the wallet) | |
| Manual adjustment | via manual_adjustments, only through an executed approval | |

## Background jobs

`JobRunner.RunAll` runs these steps, each idempotent:
- subscription renewals and dunning retries;
- settlement and reserve releases;
- scheduled payouts and payout rail progression;
- withdrawal settlement;
- outbox fan-out to webhooks and notifications;
- webhook delivery with exponential backoff (1m, 5m, 15m, 1h, 6h, 24h, then dead-lettered).

`JobHost` runs the loop every `Jobs:IntervalSeconds` seconds and runs reconciliation hourly. Tests set
the interval to 0 and call `/v1/test_helpers/run_jobs`.

## What is simulated

This build is a sandbox.

| Area | Status |
|---|---|
| Payment providers | Two in-process simulators. Real PSPs plug in behind `IPaymentProvider` |
| KYC/KYB provider | Simulated |
| Sanctions/PEP lists | A synthetic list |
| FX rates | A reference table |
| Bank rails and safeguarding bank | Simulated |
| Email | A development outbox |
| Push | The in-app notification feed |
| Tax rates | Sample configuration that must be reviewed by tax counsel |
| Tax ID checks | Format validation only |
| Database | SQLite. EF Core keeps a Postgres swap contained, but the Postgres path has **not** been run, and the append-only triggers are only created for SQLite today |

`ProductionGuard` refuses to boot `Production` with the development encryption key, the local SQLite
file or the development portal secret.
