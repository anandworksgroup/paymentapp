# Requirements traceability

This maps the two URS documents (MoR platform §1-§343; Wallet + Admin/AML §1-§231) to the build.

**Status:**
- **Built:** implemented and covered by automated tests (`backend/tests`).
- **Built (untested):** implemented, but without an automated test.
- **Partial:** a meaningful subset exists, and the gap is stated.
- **Sandbox:** the behaviour is real but runs against a simulator, not a live provider.
- **Not built:** absent.

UI coverage per area is in the last section.

## Financial core

| URS | Requirement | Status | Where / notes |
|---|---|---|---|
| §14, §135-§137 | Integer minor units, currency exponent, deterministic rounding | Built | `Common/Money.cs`; EngineTests |
| §40-§41, §143, §278, §337 | Append-only double-entry ledger, reversals, balances from the ledger | Built | `LedgerService`; SQLite triggers; integrity check in every acceptance test |
| §82-§84, §197-§198 | Atomic business operation plus outbox | Built | `Uow` |
| §20, §144, §238 | Idempotency on writes | Built | `IdempotencyMiddleware`, posting keys, usage/credit keys |
| §43, §87, §140, §211 | Immutable, attributed, tamper-evident audit | Built | Hash-chained `AuditLog`, `/v1/admin/ledger/integrity` |
| §19, §220 | Timestamped state transitions and timelines | Built | `StateTransition` |
| §240-§243 | Concurrency: refunds, credits, coupons, checkout | Built | Version tokens, serialized units of work, conditional coupon update, confirm lock; concurrency tests |
| §116, §117 | Backups / DR / point-in-time recovery | Not built | Operational; must come with the production database |
| — | Postgres | Partial | EF Core abstraction only; not run against Postgres; triggers are SQLite-only |

## Merchant of Record: selling

| URS | Requirement | Status | Where / notes |
|---|---|---|---|
| §5-§7, §77 | Roles and resource permissions; MFA (TOTP + recovery codes); sessions; devices | Built | `Permissions`, `IdentityService` |
| §7 | Email OTP, magic link, Google/Apple/Microsoft, passkeys | Not built | |
| §8-§12, §156, §222-§224 | Onboarding, KYB, beneficial owners, screening, review, checklist, go-live | Built | `MerchantService` |
| §12-§13, §184-§185 | Products; all pricing models; price versioning; archive | Built | `PricingEngine`; EngineTests |
| §102 | Multi-brand | Built | `Brand` shown on checkout |
| §103 | Multi-entity legal separation | Not built | |
| §106 | Country / PPP price overrides | Built | `country_amounts` |
| §15-§16, §87-§89, §225 | Hosted checkout, localization inputs, seller of record, terms version | Built | `CheckoutService`, public endpoints |
| §15 | Embedded / overlay checkout | Partial | Hosted page only; no embeddable JS widget |
| §48, §127 | Payment links (share, QR) | Built | QR rendering is in the UI |
| §49-§50, §243 | Coupons, promotions, auto-apply, atomic redemption | Built | |
| §108 | A/B experiments | Built | Payment-link experiments with p-values |
| §51 | Affiliates | Built | Attribution, commissions, ledger accrual, payout, reversal |
| §52, §182, §291-§293 | Entitlements, license keys, revocation | Built | |
| §52, §291 | Signed download delivery of digital goods | Not built | Files exist for compliance documents only |
| §253-§254 | Sales-assisted custom checkout / payment requests | Partial | Customer-specific coupons, manual invoices |

## Merchant of Record: payments

| URS | Requirement | Status | Where / notes |
|---|---|---|---|
| §17, §71 | Pluggable providers and methods (card, UPI) | Sandbox | `IPaymentProvider`, two simulators |
| §18, §72, §286-§288 | Routing rules, percentage routing, health, failover | Built | `PaymentRouter`; failover test |
| §21 | Smart retries: failover on provider errors only, never on issuer declines | Built | |
| §22, §192 | Explainable risk scoring (allow / review / challenge / decline) | Built | `RiskEngine` |
| §22 | Merchant-defined risk rules | Not built | Platform thresholds are configuration |
| §226 | 3-D Secure challenge | Sandbox | |
| §227 | Provider webhooks: signed, deduplicated, stored | Built | |
| §73 | Failure codes with customer text and suggested action | Built | `DeclineCatalog` |
| §76, §161-§162 | No PAN/CVV on the platform; tokens only | Built | Sandbox tokenization endpoint |
| §36, §153 | Refunds: partial, multiple, over-refund prevention, pro-rata tax | Built | |
| §37, §285 | Disputes, evidence (incl. files), won/lost ledger effects | Built | |

## Merchant of Record: billing

| URS | Requirement | Status | Where / notes |
|---|---|---|---|
| §25-§27, §152 | Subscriptions, trials, renewal, dunning, cancel, pause/resume | Built | `BillingService` with test clocks |
| §61 | Test clocks | Built | |
| §183 | Proration preview; upgrade charge; downgrade credit | Built | |
| §257 | Retention: reasons, save offers | Built | |
| §28-§29, §249 | Usage events: dedupe, late, corrections, batch | Built | |
| §245-§246 | Customer budgets and hard caps with threshold alerts | Built | |
| §247-§248 | AI token / model billing | Built | Meters plus tiered prices per metric |
| §30, §242 | Credits ledger with atomic consumption | Built | Automatic FIFO expiry of grants is not built (manual `expire` only) |
| §31, §123, §180 | Invoices, B2B net terms, PO, credit limits, deterministic PDF | Built | |
| §255 | Invoice reminders | Built | |
| §251 | Workspace-level billing | Not built | |

## Merchant of Record: tax

| URS | Requirement | Status | Where / notes |
|---|---|---|---|
| §32-§33, §138, §264-§266 | Versioned tax rules, inclusive/exclusive, reverse charge, traceable tax records | Built | Rates are **sample** configuration |
| §32 | Tax ID validation | Partial | Format only; no registry (VIES / GSTN) check |
| §32 | External tax-provider adapter | Not built | |
| §34 | Real legal/tax operating model per market | Not built | Requires counsel |

## Merchant of Record: money out

| URS | Requirement | Status | Where / notes |
|---|---|---|---|
| §38-§39, §154, §279-§284 | Settlement delay, rolling reserve, payout breakdown, failed payouts, schedules | Built | |
| §163-§165 | Fee transparency; monthly statement that reconciles | Built | |
| §121 | Configurable, versioned fee schedules | Built | |
| §42, §155, §228 | Provider reconciliation and exceptions | Built | |
| §229 | Bank-statement reconciliation | Partial | Payout rail outcome only |
| §230-§231 | Accounting close / period lock | Not built | |
| §99 | Accounting export | Built | Balanced journal JSON/CSV. Native QuickBooks/Xero connectors are not built |
| §263 | Revenue recognition | Built | Ratable report; not booked in the GL |
| §101 | Marketplace split settlement | Not built | Ledger owner types allow adding seller accounts later |

## Platform and developer

| URS | Requirement | Status | Where / notes |
|---|---|---|---|
| §53-§54, §133-§134, §234-§237, §269 | REST API, versioned path, error envelope, prefixed IDs, cursor pagination, OpenAPI | Built | `/openapi/v1.json` |
| §56-§57, §131-§132, §160, §178, §294 | Signed webhooks, retries/backoff, dead letter, replay, secret rotation, test send, SSRF guard | Built | |
| §58, §83 | Internal events via outbox | Built | |
| §55 | SDKs | Partial | TypeScript only (with tests). Python/Go/PHP/Java/Kotlin/C#/Ruby/Dart not built; generate from OpenAPI |
| §271-§273 | CLI (`listen`, `logs`, `trigger`) | Built | Polling forwarder instead of a tunnel |
| §60, §274-§275 | Sandbox test cards and demo merchant | Built | `dotnet run -- seed --reset` |
| §79 | Rate limiting | Partial | In-process limiter; needs a shared store behind a load balancer |
| §130 | API request log | Built | |
| §159 | Key types (publishable, secret, restricted, test/live), IP allow-list | Built | |
| §62-§63, §124-§125 | Notifications, templates with versions | Partial | Email goes to a dev outbox; push is the in-app feed; SMS not built |
| §96 | Encrypted document storage, signed links | Built | Malware-scan hook reports `not_scanned` |
| §97 | Asynchronous large exports | Partial | Synchronous CSV/JSON |
| §74, §299 | Privacy: export, anonymize | Built | Formal request-workflow tracking not built |
| §115 | Configurable retention | Not built | |
| §46-§47, §109, §169, §325-§327 | AI copilot (grounded tools, drafts need confirmation, data-used trace) | Built | Needs an Anthropic API key; the AI developer assistant and revenue-optimization recommendations are not built |
| §119 | Feature flags | Not built | |
| §110-§111 | Support tickets, incident management | Not built | |
| §173 | SSO/SAML, SCIM, custom roles | Not built | |
| §176-§177 | Custom domains / DNS validation | Not built | |
| §187-§189 | Imports / migration wizard | Not built | |
| §186 | Customer merge | Not built | |
| §93-§94 | Observability, alerting | Partial | Structured logs, request IDs, API logs, system-health endpoint. No metrics or tracing export |

## Global Wallet (URS part 2)

| URS | Requirement | Status | Where / notes |
|---|---|---|---|
| §6-§9 | Signup, KYC levels and state machine | Sandbox | Simulated KYC provider |
| §29-§32, §181 | Multi-currency wallet with available / held / pending; funding | Sandbox | Simulated rails |
| §33-§37 | Receive by handle, send, internal and cross-currency transfers | Built | |
| §38, §124 | FX quote shown before confirm; spread and fees in the ledger | Built | |
| §39-§40, §113 | Bank accounts (encrypted, fingerprinted, name match), withdrawals, bank returns | Sandbox | |
| §41-§42 | Transfer states; KYC-tier limits | Built | |
| §43-§45 | Source of funds, purpose | Partial | Captured on transfers; source-of-wealth evidence is not collected |
| §118 | Merchant proceeds into a business wallet | Built | |
| §216-§217 | Safeguarding reconciliation | Partial | Ledger accounts exist; no external bank feed |

## Admin, AML/CFT and audit (URS part 2)

| URS | Requirement | Status | Where / notes |
|---|---|---|---|
| §47-§50, §106-§111, §171-§174 | Configurable monitoring rules with explainable alerts | Built | Large, velocity, pass-through, fan-in, fan-out, circular, dormant, new/shared bank, structuring, account takeover |
| §58-§61, §166-§167, §190 | Sanctions/PEP screening with list versions, holds, rescreen | Built | **Synthetic** list |
| §62-§66, §95, §161-§164 | Alerts, conclusions, cases, SLA, immutable notes, hashed evidence | Built | |
| §68, §155-§156, §165, §206 | Four-eyes approvals, step-up, approval matrix | Built | |
| §69-§71, §125-§128, §159 | Restrictions, freezes, holds; neutral customer messages | Built | |
| §51-§53, §79-§82, §101-§105, §146-§148 | Fund-flow graph and trace (actual vs inferred), counterparty network | Built | |
| §85-§89, §129-§133 | Role separation (support / finance / AML / auditor) | Built | |
| §134, §136-§137, §298 | Access logging, export reasons, masking | Built | |
| §93, §100, §157 | Regulatory report package | Partial | Evidence-linked package plus legal hold; filing adapters not built |
| §112 | Impossible-travel signals | Not built | |
| §172-§175 | ML models and governance | Not built | Rules only |

## User interfaces

All surfaces use the reference design in `docs/DESIGN.md`: Inter, sage canvas, lemon/peach chips, pill-bar charts and large light numerals with a currency code. They read real API data only (§334).

| Surface | URS | Built | Verified by |
|---|---|---|---|
| Merchant web (`web/app/(merchant)`) | §10, §213-§224, §321-§325, §331 | Every §331 navigation section: dashboard + attention center, sales, billing, customers, catalog, finance, tax, disputes, analytics, developers, settings/verification/go-live, copilot, Ctrl+K palette, role-aware actions | tsc, eslint, `next build`; browser walkthroughs (pay via link, 3-D Secure, re-quote by country, partial refund with step-up, API key, webhook test, proration preview, support-role hiding) |
| Hosted checkout / payment links / customer portal | §15-§16, §24, §48, §87-§90 | Card and UPI via sandbox tokenization; 3-D Secure; async payments; receipt; portal subscriptions, invoices (PDF), payment methods | Browser at 375px and desktop |
| Admin & compliance console (`web/app/admin`) | Part 2 §72-§193, §333 | Overview, merchants, users (masked, timeline, fund-flow graph, network), transfers + trace, money movement, alerts, cases, approvals, screening, ledger, reconciliation, payouts, providers, configuration, audit logs, system health | Browser per role (support, auditor, analyst, finance, compliance); four-eyes release; self-approval refused; recon run; integrity check |
| Flutter app (`mobile/`) | §11, §86, §125-§126, §210-§212; part 2 §182-§186, §221 | Business mode (dashboard, payments + refunds, customers, subscriptions, payouts, disputes, links + QR, analytics, notifications, security); wallet mode (KYC, stacked balances, add money, send with FX quote, receive QR, withdraw, activity) | `flutter analyze` clean; 50 tests; web build exercised at phone size; debug APK built (not installed) |

**Known UI limits:**
- iOS screenshot protection is a TODO.
- Biometrics are untested on a device.
- There are no push notifications (in-app feed only) and no home-screen widgets (§126).
- The analytics 12-month view is daily bars.
- Admin country flows aggregate at most 1,000 transfers client-side.
- The embeddable checkout widget is not built.
