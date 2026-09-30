"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { date, flag, money, titleCase } from "@/lib/format";
import { useApi } from "@/lib/merchant/hooks";
import { Amount, Card, CardHeader, Chip, PageHeader, StatusChip, cx } from "@/components/ui";
import { useMerchant } from "@/components/merchant/context";
import { BackLink, DetailSkeleton, KV, Loaded, Mono, NoAccess } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { DueChip } from "@/components/merchant/finance/DueChip";
import { EvidenceForm, type DraftItem } from "@/components/merchant/finance/EvidenceForm";
import { SuggestedEvidence } from "@/components/merchant/finance/SuggestedEvidence";
import type { DisputeDetail } from "@/components/merchant/finance/types";

export default function DisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useMerchant();
  const res = useApi<DisputeDetail>(can("disputes.read") ? `/v1/disputes/${id}` : null);
  if (!can("disputes.read")) return <NoAccess what="disputes" />;
  return (
    <>
      <BackLink href="/disputes">Disputes</BackLink>
      <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<DetailSkeleton />}>
        {(d) => <Detail d={d} reload={res.reload} />}
      </Loaded>
    </>
  );
}

function Detail({ d, reload }: { d: DisputeDetail; reload: () => void }) {
  const { can } = useMerchant();
  const [now] = useState(() => Date.now());
  const [items, setItems] = useState<DraftItem[]>([]);
  const x = d.dispute;
  const p = d.payment;
  const open = x.status === "needs_response";
  const canWrite = open && can("disputes.write");
  const overdue = open && new Date(x.evidence_due_by).getTime() < now;

  return (
    <>
      <PageHeader
        eyebrow={<Mono>{x.id}</Mono>}
        title={
          <span className="flex flex-wrap items-baseline gap-3">
            <Amount minor={x.amount} currency={x.currency} size="lg" />
            <StatusChip status={x.status} className="text-[12.5px]" />
          </span>
        }
        subtitle={<>{titleCase(x.reason)} · opened {date(x.created_at, true)}</>}
      />

      <StatusBanner status={x.status} due={x.evidence_due_by} submitted={x.submitted_at} closed={x.closed_at} overdue={overdue} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <SuggestedEvidence
            s={d.suggested_evidence}
            canAdd={canWrite}
            onAdd={(s) => setItems((prev) => [...prev, { id: crypto.randomUUID(), ...s }])}
          />
          {canWrite ? (
            <EvidenceForm disputeId={x.id} items={items} setItems={setItems} hasSaved={d.evidence.length > 0} onDone={reload} />
          ) : open ? (
            <Card><p className="text-[13.5px] text-muted">Your role can view this dispute but can&apos;t respond to it. Ask an owner, admin or finance member.</p></Card>
          ) : null}
          <Card>
            <CardHeader title={open ? "Saved evidence" : "Evidence submitted"} subtitle={open ? "Saved to the dispute but not yet submitted" : undefined} />
            {d.evidence.length ? (
              <ul className="space-y-2">
                {d.evidence.map((e) => (
                  <li key={e.id} className="rounded-inner bg-surface-2 p-4">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <Chip tone="neutral">{titleCase(e.type)}</Chip>
                      <span className="text-[12px] text-muted">{date(e.created_at, true)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-2">{e.text ?? "—"}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">No evidence has been added yet.</p>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Summary" />
            <KV rows={[
              ["Status", <StatusChip key="s" status={x.status} />],
              ["Reason", titleCase(x.reason)],
              ["Disputed amount", money(x.amount, x.currency, { code: true })],
              ["Dispute fee", money(x.fee_amount, x.currency, { code: true })],
              ["Evidence due", <DueChip key="d" due={x.evidence_due_by} status={x.status} now={now} />],
              ["Submitted", x.submitted_at ? date(x.submitted_at, true) : null],
              ["Closed", x.closed_at ? date(x.closed_at, true) : null],
            ]} />
          </Card>
          <Card>
            <CardHeader title="Payment" action={<Link href={`/payments/${p.id}`} className="rounded-full bg-surface-2 px-3.5 py-1.5 text-[12.5px] text-text-2 hover:bg-surface-3">Open payment</Link>} />
            <KV rows={[
              ["Amount", money(p.amount, p.currency, { code: true })],
              ["Status", <StatusChip key="s" status={p.status} />],
              ["Customer", p.customer_id ? <Link className="underline-offset-4 hover:underline" href={`/customers/${p.customer_id}`}>{p.customer_email ?? p.customer_id}</Link> : p.customer_email],
              ["Method", <>{p.payment_method_type === "upi" ? "UPI" : titleCase(p.card_brand ?? p.payment_method_type ?? "")}{p.last4 ? ` •••• ${p.last4}` : ""}</>],
              ["Country", p.country ? <>{flag(p.country)} {p.country}</> : null],
              ["Order", p.order_id ? <Link className="underline-offset-4 hover:underline" href={`/orders/${p.order_id}`}>{p.order_id}</Link> : null],
              ["Invoice", p.invoice_id ? <Link className="underline-offset-4 hover:underline" href={`/invoices/${p.invoice_id}`}>{p.invoice_id}</Link> : null],
              ["Paid", date(p.created_at, true)],
            ]} />
          </Card>
        </div>
      </div>
    </>
  );
}

function StatusBanner({ status, due, submitted, closed, overdue }: { status: string; due: string; submitted?: string | null; closed?: string | null; overdue: boolean }) {
  const map: Record<string, { tone: string; icon: string; title: string; body: string }> = {
    needs_response: overdue
      ? { tone: "bg-peach-soft text-peach-ink", icon: "clock", title: "The response deadline has passed", body: `Evidence was due ${date(due, true)}. You can still save and submit evidence while the dispute is open.` }
      : { tone: "bg-lemon-soft text-lemon-ink", icon: "clock", title: `Respond by ${date(due, true)}`, body: "Add evidence and submit it before the deadline. If no response is submitted, the dispute is usually decided in the customer's favour." },
    under_review: { tone: "bg-sky-soft text-sky-ink", icon: "scale", title: "Your response is being reviewed", body: `Evidence was submitted ${date(submitted, true)}. The card network usually decides within a few weeks.` },
    won: { tone: "bg-sage-100 text-sage-700", icon: "check", title: "Decided in your favour", body: `Closed ${date(closed, true)}. The disputed amount was returned to your balance; the dispute fee is not refunded.` },
    lost: { tone: "bg-surface-3 text-text-2", icon: "info", title: "Decided in the customer's favour", body: `Closed ${date(closed, true)}. The disputed amount and fee stay deducted from your balance.` },
  };
  const b = map[status];
  if (!b) return null;
  return (
    <div role="status" className={cx("mb-5 flex items-start gap-3 rounded-inner px-5 py-4 text-[13.5px]", b.tone)}>
      <Icon name={b.icon} className="mt-0.5 shrink-0" />
      <div>
        <div className="font-medium">{b.title}</div>
        <div className="opacity-85">{b.body}</div>
      </div>
    </div>
  );
}
