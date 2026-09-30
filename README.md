# Monetization Platform — Merchant of Record, Global Wallet & Compliance Console

Payments, billing, tax, payouts and financial-crime controls for digital businesses, built from the two
User Requirements Specifications. There are three products on one financial core:

- **Merchant of Record platform:**
  - catalog and pricing engine (one-time, recurring, per-seat, tiered volume/graduated, package, usage, credits, hybrid, min/max);
  - hosted checkout and payment links;
  - payment orchestration with failover, 3-D Secure, async methods and risk scoring;
  - subscriptions, usage metering, credits, invoices, proration and dunning;
  - tax as Merchant of Record;
  - refunds and disputes;
  - settlement, rolling reserves, payouts and statements;
  - webhooks, API keys, idempotency, test clocks, SDK and CLI;
  - an AI financial copilot.
- **Global Wallet:** multi-currency balances, funding, internal and cross-currency transfers with binding FX quotes, withdrawals, holds and KYC-tiered limits.
- **Admin & financial-crime console:**
  - KYB/KYC review and sanctions/PEP screening;
  - transaction monitoring (large, velocity, pass-through, fan-in/out, circular, dormant, new-bank, structuring, account-takeover);
  - alerts, cases with hashed evidence, four-eyes approvals and fund-flow tracing;
  - reconciliation, ledger integrity, a tamper-evident audit log and role separation.

| Folder | What | Stack |
|---|---|---|
| `backend/` | API + financial core + jobs | ASP.NET Core (.NET 10), EF Core, SQLite (dev) |
| `web/` | Merchant dashboard, admin console, hosted checkout, payment links, customer portal | Next.js 16, React 19, Tailwind 4 |
| `mobile/` | Merchant operations and wallet app | Flutter |
| `sdk/typescript/` | Server-side SDK with webhook verification | TypeScript |
| `cli/` | `platform` CLI (`trigger`, `logs`, `events`, `listen` to forward webhooks locally) | Node 22 |
| `docs/` | [Architecture](docs/ARCHITECTURE.md), [Design language](docs/DESIGN.md), [Requirements traceability](docs/TRACEABILITY.md) | |

## Run it locally

Prerequisites: .NET 10 SDK, Node 22, Flutter 3.32.

```bash
cd backend/src/PaymentApp.Api
dotnet run -- seed --reset        # creates paymentapp.db with ~2 months of realistic demo data (~2-4 min)
dotnet run --launch-profile http  # API on http://localhost:5080  (OpenAPI: /openapi/v1.json)
```

```bash
cd web && npm install && npm run dev   # http://localhost:3000  (admin console at /admin)
```

```bash
cd mobile && flutter run --dart-define=API_URL=http://localhost:5080   # Android emulator: http://10.0.2.2:5080
```

### Demo accounts (sandbox only)

Every demo account uses the password `DemoPass!2026`.

| Who | Email |
|---|---|
| Merchant owner (Acme AI Labs, approved) | `owner@acme.test` |
| Merchant team (developer / finance / support) | `dev@acme.test`, `fin@acme.test`, `help@acme.test` |
| Merchant awaiting KYB decision | `owner@pixelforge.test` |
| Platform staff | `admin@`, `compliance@`, `analyst@`, `finance@`, `support@`, `auditor@` + `demo.test` |
| Wallet users | `alice@`, `bob@`, `carol@`, `dave@`, `erin@`, `frank@`, `gina@`, `hugo@` + `wallet.test` |

### Test payment details

| Input | Result |
|---|---|
| `4242 4242 4242 4242` | Success |
| `4000 0000 0000 9995` | Insufficient funds (soft decline) |
| `4000 0000 0000 0002` | Card declined |
| `4000 0025 0000 3155` | Requires 3-D Secure |
| `4000 0000 0000 0259` | Succeeds, then a chargeback arrives |
| `4000 0000 0000 0119` | Provider error, triggers failover to the second provider |
| `4000 0000 0000 0341` | First charge works, renewals decline (dunning) |
| UPI VPA `success@upi` | Success |
| UPI VPA `pending@upi` | Asynchronous payment |
| UPI VPA `fail@upi` | Declined |
| Bank account ending `0000` | The bank returns the payout or withdrawal |

The full list is at `GET /v1/meta`.

### AI copilot

Set `Anthropic:ApiKey` (or `ANTHROPIC_API_KEY`) for the API. The copilot uses `claude-opus-5-5` through the official Anthropic C# SDK, with server-side refusal fallback enabled.

- **Read tools** query only the caller's tenant-scoped data.
- **Write tools** only create drafts; nothing is applied until the merchant confirms.
- **High-risk actions** (refunds, payout accounts, tax) are deliberately not exposed to the copilot.

## Tests

```bash
dotnet test backend/PaymentApp.slnx      # 43 unit + end-to-end acceptance tests
cd sdk/typescript && npm install && npm run build && npm test
```

The acceptance tests drive the real HTTP API end to end and assert the financial invariants after each flow:
- every ledger transaction balances per currency;
- nothing is refunded beyond the captured amount;
- duplicate callbacks and requests have no second effect;
- concurrent credit spending never goes negative;
- ledger and audit rows cannot be updated or deleted;
- the audit hash chain verifies.

## Honest status

This is a **sandbox build**. It is not yet a licensed, production payment platform.

- **Simulated:** payment providers, KYC, sanctions lists (synthetic), FX rates, bank rails, email.
- **Sample only:** tax rates are sample configuration.
- **Database:** SQLite. The Postgres path is untested.

[docs/TRACEABILITY.md](docs/TRACEABILITY.md) maps each URS area to what is built, partial or not built, and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) lists what a production deployment still needs:
- real PSP, tax, KYC and screening adapters;
- Postgres with migrations;
- a secret manager;
- object storage;
- email/push providers;
- observability;
- legal and regulatory counsel per market (URS §34, §212-§216).
