"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import type { List } from "@/lib/api";
import { useApi } from "@/lib/merchant/hooks";
import type { Meter, Product } from "@/lib/merchant/types";
import { Button, Card, CardHeader, Chip, PageHeader, StatusChip, Table } from "@/components/ui";
import { date, flag } from "@/lib/format";
import { useMerchant } from "@/components/merchant/context";
import { BackLink, DetailSkeleton, KV, Loaded, Mono, NoAccess, Timeline } from "@/components/merchant/common";
import { intervalLabel, priceLabel } from "@/components/merchant/pickers";
import { Icon } from "@/components/merchant/icons";
import { Count, InvoiceTable, MiniStat, PillLink, TextLink } from "@/components/merchant/billing/bits";
import { ChangePlanModal } from "@/components/merchant/billing/ChangePlanModal";
import { CancelSubscriptionModal, PauseResumeModal } from "@/components/merchant/billing/SubscriptionActions";
import type { SubscriptionDetail } from "@/components/merchant/billing/types";

export default function SubscriptionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useMerchant();
  const res = useApi<SubscriptionDetail>(can("subscriptions.read") ? `/v1/subscriptions/${id}` : null);
  if (!can("subscriptions.read")) return <NoAccess what="subscriptions" />;
  return (
    <>
      <BackLink href="/subscriptions">Subscriptions</BackLink>
      <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<DetailSkeleton />}>
        {(d) => <Detail d={d} reload={res.reload} />}
      </Loaded>
    </>
  );
}

type Dialog = "change" | "cancel" | "pause" | "resume" | null;

function Detail({ d, reload }: { d: SubscriptionDetail; reload: () => void }) {
  const s = d.subscription;
  const { can } = useMerchant();
  const [dialog, setDialog] = useState<Dialog>(null);
  const products = useApi<List<Product>>(can("products.read") ? "/v1/products?limit=100" : null);
  const meters = useApi<List<Meter>>(d.current_usage.length && can("usage.read") ? "/v1/meters?limit=100" : null);
  const productNames = new Map((products.data?.data ?? []).map((p) => [p.id, p.name]));
  const meterByEvent = new Map((meters.data?.data ?? []).map((m) => [m.event_name, m]));
  const priceById = new Map(d.prices.map((p) => [p.id, p]));
  const licensed = d.items.filter((i) => priceById.get(i.price_id)?.usage_type === "licensed");
  const planItem = licensed.length === 1 ? licensed[0] : null;
  const planPrice = planItem ? priceById.get(planItem.price_id) : undefined;
  const firstPrice = d.prices[0];
  const ended = s.status === "CANCELLED" || s.status === "EXPIRED";
  const write = can("subscriptions.write");
  const done = () => {
    setDialog(null);
    reload();
  };
  const customerName = d.customer ? d.customer.name ?? d.customer.email ?? d.customer.id : s.customer_id;

  return (
    <>
      <PageHeader
        eyebrow={<Mono>{s.id}</Mono>}
        title={
          <span className="flex flex-wrap items-baseline gap-3">
            <span>{planPrice ? productNames.get(planPrice.product_id) ?? planPrice.nickname ?? "Subscription" : "Subscription"}</span>
            <StatusChip status={s.status} className="text-[12.5px]" />
            {s.cancel_at_period_end && !ended && <Chip tone="peach">Cancels {date(s.current_period_end)}</Chip>}
          </span>
        }
        subtitle={<>for <TextLink href={`/customers/${s.customer_id}`} className="text-text-2">{customerName}</TextLink> · started {date(s.created_at)}</>}
        actions={
          write && !ended && (
            <>
              {(s.status === "ACTIVE" || s.status === "TRIALING") && planPrice && (
                <Button variant="ink" icon={<Icon name="repeat" size={16} />} onClick={() => setDialog("change")}>Change plan</Button>
              )}
              {s.status === "ACTIVE" && <Button variant="soft" onClick={() => setDialog("pause")}>Pause</Button>}
              {s.status === "PAUSED" && <Button variant="soft" onClick={() => setDialog("resume")}>Resume</Button>}
              <Button variant="danger" onClick={() => setDialog("cancel")}>Cancel</Button>
            </>
          )
        }
      />

      {s.status === "PAST_DUE" && (
        <div role="status" className="mb-5 flex flex-wrap items-center gap-3 rounded-inner bg-peach-soft px-5 py-4 text-[13.5px] text-peach-ink">
          <Icon name="alert" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">The latest invoice hasn&apos;t been paid</div>
            <div className="opacity-80">
              {s.dunning_attempts} collection {s.dunning_attempts === 1 ? "attempt" : "attempts"} so far
              {s.next_retry_at ? ` · next retry ${date(s.next_retry_at, true)}` : " · no retry scheduled"}.
            </div>
          </div>
          {s.latest_invoice_id && <PillLink href={`/invoices/${s.latest_invoice_id}`}>Open invoice</PillLink>}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Items" subtitle={firstPrice ? `${intervalLabel(firstPrice)} · ${s.currency}` : undefined} />
            <Table
              rows={d.items}
              rowKey={(i) => i.id}
              empty={<p className="text-[13px] text-muted">No items.</p>}
              columns={[
                { key: "p", header: "Product", render: (i) => {
                  const p = priceById.get(i.price_id);
                  return <span className="text-text">{p ? productNames.get(p.product_id) ?? p.product_id : "—"}</span>;
                } },
                { key: "price", header: "Price", render: (i) => {
                  const p = priceById.get(i.price_id);
                  return <span className="text-text-2">{p ? priceLabel(p) : i.price_id}</span>;
                } },
                { key: "q", header: "Quantity", align: "right", render: (i) => {
                  const p = priceById.get(i.price_id);
                  return <span className="numeral">{p?.usage_type === "metered" ? "Metered" : i.quantity}</span>;
                } },
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Current usage" subtitle="Unbilled usage on metered items, billed at the next renewal" />
            {d.current_usage.length ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {d.current_usage.map((u) => {
                  const m = meterByEvent.get(u.event_name);
                  return (
                    <MiniStat key={u.event_name} label={m?.display_name ?? u.event_name}>
                      <Count value={u.quantity} unit={m?.unit} />
                    </MiniStat>
                  );
                })}
              </div>
            ) : <p className="text-[13px] text-muted">No unbilled usage.</p>}
          </Card>

          <Card>
            <CardHeader title="Invoices" />
            <InvoiceTable rows={d.invoices} empty={<p className="text-[13px] text-muted">No invoices yet.</p>} />
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Billing" />
            <KV rows={[
              ["Current period", <>{date(s.current_period_start)} – {date(s.current_period_end)}</>],
              ["Trial", s.trial_end ? `${s.status === "TRIALING" ? "Ends" : "Ended"} ${date(s.trial_end)}` : "No trial"],
              ["Collection", s.collection_method === "send_invoice" ? `Send invoice · due in ${s.days_until_due ?? 30} days` : "Charge automatically"],
              ["Payment method", s.default_payment_method_id ? <span className="font-mono text-[12px]">{s.default_payment_method_id}</span> : "Customer default"],
              ["Country", s.country ? <>{flag(s.country)} {s.country}</> : null],
              ["Cancel at period end", s.cancel_at_period_end ? "Yes" : "No"],
              ["Cancelled", s.canceled_at ? date(s.canceled_at, true) : null],
              ["Cancellation reason", s.cancellation_reason],
              ["Paused", s.paused_at ? date(s.paused_at, true) : null],
              ["Latest invoice", s.latest_invoice_id ? <TextLink href={`/invoices/${s.latest_invoice_id}`}>{s.latest_invoice_id}</TextLink> : null],
            ]} />
          </Card>

          <Card>
            <CardHeader title="Dunning" subtitle="Automatic retries of failed renewals" />
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="Attempts" tone={s.dunning_attempts > 0 ? "peach" : undefined}><Count value={s.dunning_attempts} /></MiniStat>
              <MiniStat label="Next retry"><span className="text-[15px] text-text">{s.next_retry_at ? date(s.next_retry_at, true) : "None scheduled"}</span></MiniStat>
            </div>
          </Card>

          <Card>
            <CardHeader title="Credits" action={can("credits.read") && <PillLink href={`/credits?customer=${s.customer_id}`}>Ledger</PillLink>} />
            <MiniStat label="Available to this customer" tone="sage"><Count value={d.credits} unit="credits" /></MiniStat>
          </Card>

          <Card>
            <CardHeader title="Timeline" />
            <Timeline items={d.timeline} />
          </Card>
        </div>
      </div>

      {dialog === "change" && planPrice && planItem && (
        <ChangePlanModal sub={s} current={planPrice} currentQty={planItem.quantity} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog === "cancel" && <CancelSubscriptionModal sub={s} onClose={() => setDialog(null)} onDone={done} />}
      {(dialog === "pause" || dialog === "resume") && <PauseResumeModal sub={s} mode={dialog} onClose={() => setDialog(null)} onDone={done} />}
    </>
  );
}
