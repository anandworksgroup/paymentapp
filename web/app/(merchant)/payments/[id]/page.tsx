"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction, useApi } from "@/lib/merchant/hooks";
import type { Customer, Dispute, Order, Payment, PaymentAttempt, Refund, StateTransition } from "@/lib/merchant/types";
import { Amount, Button, Card, CardHeader, Chip, PageHeader, StatusChip, Table, cx } from "@/components/ui";
import { date, flag, money, titleCase } from "@/lib/format";
import { useMerchant, useToast } from "@/components/merchant/context";
import { BackLink, ConfirmModal, DetailSkeleton, KV, Loaded, Mono, SectionTitle, Timeline } from "@/components/merchant/common";
import { RefundModal } from "@/components/merchant/payments/RefundModal";
import { Icon } from "@/components/merchant/icons";

type LedgerTx = { id: string; type: string; description: string; created_at: string; entries: { account: string; owner: string; direction: "D" | "C"; amount: number; currency: string }[] };
type PaymentDetail = {
  payment: Payment;
  fee_breakdown: { customer_paid: number; tax: number; platform_fee: number; refunded: number; disputed: number; net_to_merchant: number; currency: string };
  attempts: PaymentAttempt[];
  refunds: Refund[];
  disputes: Dispute[];
  order: Order | null;
  customer: Customer | null;
  timeline: StateTransition[];
  ledger: LedgerTx[];
  events: { id: string; type: string; created_at: string }[];
};

export default function PaymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const res = useApi<PaymentDetail>(`/v1/payments/${id}`);
  return (
    <>
      <BackLink href="/payments">Payments</BackLink>
      <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<DetailSkeleton />}>
        {(d) => <Detail d={d} reload={res.reload} />}
      </Loaded>
    </>
  );
}

function Detail({ d, reload }: { d: PaymentDetail; reload: () => void }) {
  const p = d.payment;
  const { can } = useMerchant();
  const [refundOpen, setRefundOpen] = useState(false);
  // The server decides the refundable amount; only these states accept refunds.
  const refundable = p.status === "SUCCEEDED" || p.status === "PARTIALLY_REFUNDED";
  const fb = d.fee_breakdown;

  return (
    <>
      <PageHeader
        eyebrow={<Mono>{p.id}</Mono>}
        title={
          <span className="flex flex-wrap items-baseline gap-3">
            <Amount minor={p.amount} currency={p.currency} size="lg" />
            <StatusChip status={p.status} className="text-[12.5px]" />
            {p.review_status !== "none" && <StatusChip status={p.review_status === "pending" ? "in_review" : p.review_status} />}
          </span>
        }
        subtitle={<>{p.description ?? "Payment"} · {date(p.created_at, true)}</>}
        actions={
          can("payments.refund") && refundable && (
            <Button variant="soft" icon={<Icon name="refund" size={16} />} onClick={() => setRefundOpen(true)}>Refund</Button>
          )
        }
      />

      {p.review_status === "pending" && can("payments.refund") && <ReviewBanner payment={p} onDone={reload} />}

      {p.status === "FAILED" && (
        <div className="mb-5 rounded-inner bg-rose-soft px-5 py-4 text-[13.5px] text-rose-ink" role="status">
          <div className="font-medium">{p.failure_message ?? "The payment failed."}</div>
          <div className="mt-0.5 opacity-80">{p.failure_code && <>Code <span className="font-mono">{p.failure_code}</span>{p.provider_failure_code ? ` (provider ${p.provider_failure_code})` : ""}. </>}{p.suggested_action}</div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Where the money went" subtitle="Fee transparency — figures from the ledger, not recalculated here" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Flow label="Customer paid" minor={fb.customer_paid} currency={fb.currency} tone="sage" />
              <Flow label="Tax collected & remitted by the platform" minor={fb.tax} currency={fb.currency} />
              <Flow label="Platform fee" minor={fb.platform_fee} currency={fb.currency} negative />
              {fb.refunded > 0 && <Flow label="Refunded" minor={fb.refunded} currency={fb.currency} negative />}
              {fb.disputed > 0 && <Flow label="Disputed" minor={fb.disputed} currency={fb.currency} negative />}
              <Flow label="Net to you" minor={fb.net_to_merchant} currency={fb.currency} tone="lemon" />
            </div>
          </Card>

          <Card>
            <CardHeader title="Attempts" subtitle="Each provider attempt with its routing decision" />
            <Table
              rows={d.attempts}
              rowKey={(a) => a.id}
              empty={<p className="text-[13px] text-muted">No provider attempts yet.</p>}
              columns={[
                { key: "p", header: "Provider", render: (a) => <span className="font-mono text-[12.5px]">{a.provider_id}</span> },
                { key: "s", header: "Result", render: (a) => <StatusChip status={a.status} /> },
                { key: "r", header: "Routing reason", render: (a) => <span className="text-text-2">{a.routing_reason ?? "—"}</span> },
                { key: "e", header: "Decline", render: (a) => a.error_code ? <span className="text-rose-ink">{a.error_code}{a.decline_type ? ` · ${a.decline_type}` : ""}{a.provider_error_code ? ` (${a.provider_error_code})` : ""}</span> : <span className="text-faint">—</span> },
                { key: "3ds", header: "3DS", render: (a) => a.three_ds_result ?? <span className="text-faint">—</span> },
                { key: "l", header: "Latency", align: "right", render: (a) => <span className="text-muted">{a.latency_ms} ms</span> },
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Ledger entries" subtitle="Double-entry postings created by this payment, its refunds and disputes" />
            {d.ledger.length === 0 ? <p className="text-[13px] text-muted">Nothing posted yet.</p> : (
              <div className="space-y-4">
                {d.ledger.map((t) => (
                  <div key={t.id} className="rounded-inner bg-surface-2 p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                      <span className="font-medium">{titleCase(t.type)} <span className="font-normal text-muted">· {t.description}</span></span>
                      <span className="text-muted">{date(t.created_at, true)}</span>
                    </div>
                    <table className="w-full text-[12.5px]">
                      <thead className="text-left text-muted"><tr><th className="py-1 font-normal">Account</th><th className="py-1 text-right font-normal">Debit</th><th className="py-1 text-right font-normal">Credit</th></tr></thead>
                      <tbody>
                        {t.entries.map((e, i) => (
                          <tr key={i} className="border-t border-line">
                            <td className="py-1.5"><span className="font-mono">{e.account}</span> <Chip tone={e.owner === "org" ? "sage" : "neutral"} className="ml-1">{e.owner === "org" ? "you" : e.owner}</Chip></td>
                            <td className="py-1.5 text-right numeral">{e.direction === "D" ? money(e.amount, e.currency) : ""}</td>
                            <td className="py-1.5 text-right numeral">{e.direction === "C" ? money(e.amount, e.currency) : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {(d.refunds.length > 0 || d.disputes.length > 0) && (
            <Card>
              {d.refunds.length > 0 && (
                <div className="mb-5">
                  <SectionTitle>Refunds</SectionTitle>
                  <Table rows={d.refunds} rowKey={(r) => r.id} columns={[
                    { key: "a", header: "Amount", render: (r) => <Amount minor={r.amount} currency={r.currency} size="sm" /> },
                    { key: "s", header: "Status", render: (r) => <StatusChip status={r.status} /> },
                    { key: "r", header: "Reason", render: (r) => titleCase(r.reason ?? "—") },
                    { key: "t", header: "Tax part", render: (r) => money(r.tax_amount, r.currency) },
                    { key: "d", header: "Created", align: "right", render: (r) => <span className="text-muted">{date(r.created_at, true)}</span> },
                  ]} />
                </div>
              )}
              {d.disputes.length > 0 && (
                <div>
                  <SectionTitle>Disputes</SectionTitle>
                  <ul className="space-y-2">
                    {d.disputes.map((x) => (
                      <li key={x.id}>
                        <Link href={`/disputes/${x.id}`} className="flex items-center gap-3 rounded-inner bg-surface-2 px-4 py-3 hover:bg-surface-3">
                          <Amount minor={x.amount} currency={x.currency} size="sm" />
                          <StatusChip status={x.status} />
                          <span className="flex-1 text-[13px] text-text-2">{titleCase(x.reason)}</span>
                          <span className="text-[12px] text-muted">Evidence due {date(x.evidence_due_by)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <KV rows={[
              ["Customer", d.customer ? <Link className="underline-offset-4 hover:underline" href={`/customers/${d.customer.id}`}>{d.customer.name ?? d.customer.email ?? d.customer.id}</Link> : p.customer_email],
              ["Email", p.customer_email],
              ["Method", <>{p.payment_method_type === "upi" ? "UPI" : titleCase(p.card_brand ?? p.payment_method_type ?? "")}{p.last4 ? ` •••• ${p.last4}` : ""}</>],
              ["Country", p.country ? <>{flag(p.country)} {p.country}</> : null],
              ["3-D Secure", p.three_ds_result],
              ["Provider", p.provider_id ? <span className="font-mono text-[12.5px]">{p.provider_id}</span> : null],
              ["Order", d.order ? <Link className="underline-offset-4 hover:underline" href={`/orders/${d.order.id}`}>{d.order.id}</Link> : null],
              ["Invoice", p.invoice_id ? <Link className="underline-offset-4 hover:underline" href={`/invoices/${p.invoice_id}`}>{p.invoice_id}</Link> : null],
              ["Checkout", p.checkout_session_id ? <span className="font-mono text-[12px]">{p.checkout_session_id}</span> : null],
            ]} />
          </Card>

          <Card>
            <CardHeader title="Risk" subtitle="Signals the risk engine evaluated" action={<RiskScore score={p.risk_score} action={p.risk_action} />} />
            {p.risk_reasons && p.risk_reasons.length ? (
              <ul className="space-y-2">
                {p.risk_reasons.map((r) => (
                  <li key={r.code} className="rounded-inner bg-surface-2 px-4 py-3 text-[13px]">
                    <div className="flex items-center justify-between gap-2"><span className="font-medium">{titleCase(r.code)}</span><Chip tone="peach">+{r.weight}</Chip></div>
                    <div className="mt-0.5 text-muted">{r.explanation}</div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[13px] text-muted">No risk signals were raised.</p>}
          </Card>

          <Card>
            <CardHeader title="Status timeline" />
            <Timeline items={d.timeline} />
          </Card>

          <Card>
            <CardHeader title="Events" subtitle="Webhook events emitted for this payment" />
            {d.events.length ? (
              <ul className="space-y-1.5">
                {d.events.map((e) => (
                  <li key={e.id}>
                    <Link href={`/developers/events/${e.id}`} className="flex items-center justify-between gap-2 rounded-[12px] px-3 py-2 text-[13px] hover:bg-surface-2">
                      <span className="font-mono text-[12.5px]">{e.type}</span>
                      <span className="text-muted">{date(e.created_at, true)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[13px] text-muted">No events yet.</p>}
          </Card>
        </div>
      </div>

      {refundOpen && <RefundModal payment={p} open onClose={() => setRefundOpen(false)} onDone={reload} />}
    </>
  );
}

function Flow({ label, minor, currency, tone, negative }: { label: string; minor: number; currency: string; tone?: "sage" | "lemon"; negative?: boolean }) {
  return (
    <div className={cx("rounded-inner p-4", tone === "sage" ? "sage-gradient" : tone === "lemon" ? "lemon-gradient" : "bg-surface-2")}>
      <div className="text-[12.5px] text-text-2">{label}</div>
      <Amount minor={negative ? -minor : minor} currency={currency} size="md" className="mt-2" />
    </div>
  );
}

function RiskScore({ score, action }: { score: number; action?: string | null }) {
  const tone = score >= 70 ? "rose" : score >= 40 ? "peach" : score >= 15 ? "lemon-soft" : "sage";
  return (
    <span className="flex items-center gap-2">
      <Chip tone={tone}>Score {score}</Chip>
      {action && <Chip tone="neutral">{titleCase(action)}</Chip>}
    </span>
  );
}

function ReviewBanner({ payment, onDone }: { payment: Payment; onDone: () => void }) {
  const [decision, setDecision] = useState<boolean | null>(null);
  const act = useAction();
  const toast = useToast();
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-inner bg-lemon-soft px-5 py-4">
      <Icon name="shield" className="text-lemon-ink" />
      <div className="min-w-0 flex-1 text-[13.5px] text-lemon-ink">
        <div className="font-medium">This payment requires additional review</div>
        <div className="opacity-80">Its funds are held until you approve it. Declining refunds the customer in full.</div>
      </div>
      <Button size="sm" onClick={() => setDecision(true)}>Approve</Button>
      <Button size="sm" variant="danger" onClick={() => setDecision(false)}>Decline & refund</Button>
      <ConfirmModal
        open={decision !== null}
        onClose={() => setDecision(null)}
        title={decision ? "Approve payment?" : "Decline and refund?"}
        confirmLabel={decision ? "Approve" : "Decline & refund"}
        danger={decision === false}
        busy={act.busy}
        error={act.error}
        onConfirm={async () => {
          const r = await act.run(() => api(`/v1/payments/${payment.id}/review`, { body: { approve: decision } }));
          if (r) {
            toast(decision ? "Payment approved" : "Payment declined and refunded");
            setDecision(null);
            onDone();
          }
        }}
      >
        {decision ? "The held funds will be released to your balance on the normal settlement schedule." : `The customer will be refunded ${money(payment.amount, payment.currency, { code: true })}.`}
      </ConfirmModal>
    </div>
  );
}
