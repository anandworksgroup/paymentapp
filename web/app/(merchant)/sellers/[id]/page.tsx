"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useApi } from "@/lib/merchant/hooks";
import { date, flag, titleCase } from "@/lib/format";
import { Amount, Button, Card, CardHeader, Chip, PageHeader, Stat, StatusChip, Table } from "@/components/ui";
import { useMerchant } from "@/components/merchant/context";
import { BackLink, DetailSkeleton, InfoPopover, KV, Loaded, Mono, NoAccess } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { Snippet } from "@/components/merchant/developers/shared";
import { API_URL } from "@/lib/api";
import { bpsLabel, StateChip } from "@/components/merchant/growth/helpers";
import { PayoutAccountModal, SellerPayoutModal, SplitBreakdown } from "@/components/merchant/growth/SellerModals";
import type { SellerDetail } from "@/components/merchant/growth/types";

export default function SellerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useMerchant();
  const res = useApi<SellerDetail>(can("customers.read") ? `/v1/sellers/${id}` : null);
  if (!can("customers.read")) return <NoAccess what="sellers" />;
  return (
    <>
      <BackLink href="/sellers">Sellers</BackLink>
      <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<DetailSkeleton />}>
        {(d) => <Detail d={d} reload={res.reload} />}
      </Loaded>
    </>
  );
}

function Detail({ d, reload }: { d: SellerDetail; reload: () => void }) {
  const s = d.seller;
  const { can } = useMerchant();
  const router = useRouter();
  const [editingAccount, setEditingAccount] = useState(false);
  const [paying, setPaying] = useState(false);
  const balances = d.balance.balances;
  const canPay = can("payouts.manage") && s.status === "active" && balances.some((b) => b.available > 0);
  const latest = d.payments.find((p) => p.status === "SUCCEEDED" || p.seller_amount > 0) ?? d.payments[0];

  return (
    <>
      <PageHeader
        eyebrow={<Mono>{s.id}</Mono>}
        title={
          <span className="flex flex-wrap items-baseline gap-3">
            <span>{s.name}</span>
            <StateChip status={s.status} className="text-[12px]" />
          </span>
        }
        subtitle={<>{s.email} · {flag(s.country)} {s.country} · added {date(s.created_at)}</>}
        actions={
          <>
            {can("payouts.destination") && (
              <Button variant="soft" icon={<Icon name="bank" size={16} />} onClick={() => setEditingAccount(true)}>
                {s.payout_last4 ? "Replace payout account" : "Add payout account"}
              </Button>
            )}
            {can("payouts.manage") && (
              <Button icon={<Icon name="send" size={16} />} disabled={!canPay} onClick={() => setPaying(true)} title={canPay ? undefined : "Nothing available to pay out yet"}>
                Pay out
              </Button>
            )}
          </>
        }
      />

      {s.status === "pending_verification" && (
        <div role="status" className="mb-5 rounded-inner bg-lemon-soft px-5 py-4 text-[13.5px] text-lemon-ink">
          This seller requires additional review before it can sell. Our compliance team checks screening results, usually within one business day.
        </div>
      )}
      {(s.status === "rejected" || s.status === "restricted") && (
        <div role="status" className="mb-5 rounded-inner bg-peach-soft px-5 py-4 text-[13.5px] text-peach-ink">
          This seller can&apos;t take new sales{s.decision_reason ? `: ${s.decision_reason}` : "."} Existing balances are kept and remain visible here.
        </div>
      )}

      <section aria-label="Seller balance" className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {balances.length === 0 ? (
          <>
            <Stat label="Available"><Amount minor={0} currency={s.default_currency} size="md" /></Stat>
            <Stat label="Pending"><Amount minor={0} currency={s.default_currency} size="md" /></Stat>
          </>
        ) : (
          balances.flatMap((b) => [
            <Stat key={`${b.currency}-a`} label={`Available · ${b.currency}`} chip={b.available > 0 ? <Chip tone="sage">Ready to pay out</Chip> : undefined}>
              <Amount minor={b.available} currency={b.currency} size="md" />
            </Stat>,
            <Stat key={`${b.currency}-p`} label={`Pending · ${b.currency}`} chip={<InfoPopover label="Pending">Seller share of recent sales. It becomes available after your settlement delay.</InfoPopover>}>
              <Amount minor={b.pending} currency={b.currency} size="md" />
            </Stat>,
          ])
        )}
      </section>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Payments" subtitle="Latest 50 sales for this seller, split at payment time" />
            <Table
              rows={d.payments}
              rowKey={(p) => p.id}
              onRowClick={can("payments.read") ? (p) => router.push(`/payments/${p.id}`) : undefined}
              empty={<p className="text-[13px] text-muted">No sales yet. Create a checkout session or payment link with <code className="font-mono text-[12px]">seller: {s.id}</code>.</p>}
              columns={[
                { key: "a", header: "Sale", render: (p) => <Amount minor={p.amount} currency={p.currency} size="sm" /> },
                { key: "t", header: "Tax", align: "right", render: (p) => <Amount minor={p.tax_amount} currency={p.currency} size="sm" showCode={false} className="text-text-2" /> },
                { key: "f", header: <span className="whitespace-nowrap">MoR fee</span>, align: "right", render: (p) => <Amount minor={p.fee_amount} currency={p.currency} size="sm" showCode={false} className="text-text-2" /> },
                { key: "c", header: "Commission", align: "right", render: (p) => <Amount minor={p.application_fee_amount} currency={p.currency} size="sm" showCode={false} className="text-text-2" /> },
                { key: "s", header: <span className="whitespace-nowrap">Seller share</span>, align: "right", render: (p) => <Amount minor={p.seller_amount} currency={p.currency} size="sm" showCode={false} /> },
                { key: "st", header: "Status", render: (p) => <StatusChip status={p.status} /> },
                { key: "d", header: "Date", align: "right", render: (p) => <span className="whitespace-nowrap text-muted">{date(p.created_at, true)}</span> },
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Balance activity" subtitle="Every movement in the seller's ledger balance" />
            <Table
              rows={d.balance_transactions}
              rowKey={(t) => t.id}
              empty={<p className="text-[13px] text-muted">No balance activity yet.</p>}
              columns={[
                { key: "type", header: "Type", render: (t) => <span className="whitespace-nowrap text-text">{titleCase(t.type)}</span> },
                { key: "amount", header: "Amount", render: (t) => <Amount minor={t.amount} currency={t.currency} size="sm" className="whitespace-nowrap" /> },
                { key: "status", header: "Status", render: (t) => <StateChip status={t.status} tones={{ available: "sage" }} /> },
                { key: "desc", header: "Details", render: (t) => <span className="block max-w-[300px] truncate text-[12.5px] text-text-2" title={t.description ?? undefined}>{t.description ?? t.source_id}</span> },
                { key: "on", header: <span className="whitespace-nowrap">Available on</span>, align: "right", render: (t) => <span className="whitespace-nowrap text-muted">{date(t.available_on)}</span> },
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Payouts" />
            <Table
              rows={d.payouts}
              rowKey={(p) => p.id}
              empty={<p className="text-[13px] text-muted">No payouts yet.</p>}
              columns={[
                { key: "a", header: "Amount", render: (p) => <Amount minor={p.amount} currency={p.currency} size="sm" /> },
                { key: "s", header: "Status", render: (p) => <StatusChip status={p.status} /> },
                { key: "b", header: "Bank", render: (p) => <span className="whitespace-nowrap text-text-2">{p.bank_last4 ? `••••${p.bank_last4}` : "—"}</span> },
                { key: "r", header: "Notes", render: (p) => <span className="text-[12.5px] text-text-2">{p.failure_reason ?? (p.paid_at ? `Paid ${date(p.paid_at, true)}` : "—")}</span> },
                { key: "d", header: "Created", align: "right", render: (p) => <span className="whitespace-nowrap text-muted">{date(p.created_at, true)}</span> },
              ]}
            />
          </Card>
        </div>

        <div className="order-first grid min-w-0 grid-cols-1 content-start gap-5 lg:grid-cols-2 2xl:order-none 2xl:grid-cols-1">
          <Card>
            <CardHeader title="Split of the latest sale" subtitle={latest ? `${latest.id} · ${date(latest.created_at, true)}` : "Shown after the first sale"} />
            {latest ? (
              <SplitBreakdown p={latest} />
            ) : (
              <p className="text-[13px] text-muted">
                Sale − tax − MoR fee − your {bpsLabel(s.commission_bps)} commission = seller share. The breakdown of each sale appears here once the seller has one.
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title="Profile" />
            <KV
              rows={[
                ["Email", s.email],
                ["Country", `${flag(s.country)} ${s.country}`],
                ["Default currency", s.default_currency],
                ["Commission", <span key="c">{bpsLabel(s.commission_bps)} <span className="text-muted">of each sale excluding tax</span></span>],
                ["Screening", <StateChip key="sc" status={s.screening_status} />],
                ["Payout account", s.payout_last4 ? `${s.payout_bank_name ?? "Bank"} ••••${s.payout_last4} · ${s.payout_currency}` : <Chip key="m" tone="peach">Not added</Chip>],
              ]}
            />
          </Card>

          <Card className="lg:col-span-2 2xl:col-span-1">
            <CardHeader title="Sell for this seller" subtitle="Pass the seller id when you create a checkout" />
            <Snippet
              title="cURL"
              code={`curl ${API_URL}/v1/checkout/sessions \\
  -H "Authorization: Bearer sk_test_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "mode": "payment",
    "line_items": [{ "price_id": "price_...", "quantity": 1 }],
    "seller": "${s.id}"
  }'`}
            />
            <p className="mt-3 text-[12px] text-muted">
              Add <code className="font-mono">&quot;application_fee_bps&quot;</code> to override the {bpsLabel(s.commission_bps)} commission for one checkout. Payment links accept the same fields.
            </p>
          </Card>
        </div>
      </div>

      {editingAccount && (
        <PayoutAccountModal
          seller={s}
          onClose={() => setEditingAccount(false)}
          onSaved={() => {
            setEditingAccount(false);
            reload();
          }}
        />
      )}
      {paying && (
        <SellerPayoutModal
          seller={s}
          balances={balances}
          onClose={() => setPaying(false)}
          onDone={() => {
            setPaying(false);
            reload();
          }}
        />
      )}
    </>
  );
}
