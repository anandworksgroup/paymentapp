"use client";

import { useParams } from "next/navigation";
import { date, flag } from "@/lib/format";
import { useApi } from "@/lib/merchant/hooks";
import { Amount, Card, CardHeader, Chip, Empty, PageHeader, StatusChip } from "@/components/ui";
import { useMerchant } from "@/components/merchant/context";
import { BackLink, DetailSkeleton, KV, Loaded, Mono, NoAccess, Timeline } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { BalanceTxTable } from "@/components/merchant/finance/BalanceTxTable";
import { PayoutBreakdownCard } from "@/components/merchant/finance/PayoutBreakdownCard";
import type { PayoutDetail } from "@/components/merchant/finance/types";

export default function PayoutDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useMerchant();
  const res = useApi<PayoutDetail>(can("payouts.read") ? `/v1/payouts/${id}` : null);
  if (!can("payouts.read")) return <NoAccess what="payouts" />;
  return (
    <>
      <BackLink href="/payouts">Payouts</BackLink>
      <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<DetailSkeleton />}>
        {(d) => <Detail d={d} />}
      </Loaded>
    </>
  );
}

function Detail({ d }: { d: PayoutDetail }) {
  const p = d.payout;
  const dest = d.destination;
  return (
    <>
      <PageHeader
        eyebrow={<Mono>{p.id}</Mono>}
        title={
          <span className="flex flex-wrap items-baseline gap-3">
            <Amount minor={p.amount} currency={p.currency} size="lg" />
            <StatusChip status={p.status} className="text-[12.5px]" />
            <Chip tone={p.automatic ? "sky" : "neutral"}>{p.automatic ? "Automatic" : "Manual"}</Chip>
          </span>
        }
        subtitle={<>Created {date(p.created_at, true)} · {p.status === "PAID" && p.paid_at ? `paid ${date(p.paid_at, true)}` : `expected ${date(p.arrival_date)}`}</>}
      />

      {p.status === "FAILED" && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-inner bg-rose-soft px-5 py-4 text-[13.5px] text-rose-ink">
          <Icon name="alert" className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">{p.failure_reason ?? "The bank returned this payout."}</div>
            <div className="opacity-80">The amount went back to your available balance. Check your payout account details before the next payout.</div>
          </div>
        </div>
      )}
      {p.status === "ON_HOLD" && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-inner bg-peach-soft px-5 py-4 text-[13.5px] text-peach-ink">
          <Icon name="clock" className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">This payout is on hold</div>
            <div className="opacity-80">{p.hold_reason ?? "It requires additional review."} It will be sent once the review is complete.</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <PayoutBreakdownCard breakdown={p.breakdown} currency={p.currency} />
          <Card>
            <CardHeader title="Included balance transactions" subtitle="The payments, refunds and other movements this payout covers" />
            <BalanceTxTable
              rows={d.balance_transactions}
              showPayout={false}
              empty={<Empty title="No transactions linked">This payout has no balance transactions attached to it.</Empty>}
            />
          </Card>
        </div>
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Destination" />
            {dest ? (
              <KV rows={[
                ["Bank", dest.bank_name ?? "—"],
                ["Account", `•••• ${dest.last4}`],
                ["Holder", dest.account_holder],
                ["Country", <>{flag(dest.bank_country)} {dest.bank_country}</>],
                ["Currency", dest.currency],
                ["Routing", dest.routing_number ?? dest.swift ?? null],
                ["Status", <StatusChip key="s" status={dest.status} />],
              ]} />
            ) : (
              <p className="text-[13px] text-muted">{p.destination_last4 ? `Bank account •••• ${p.destination_last4} (no longer on file).` : "No destination recorded."}</p>
            )}
          </Card>
          <Card>
            <CardHeader title="Details" />
            <KV rows={[
              ["Bank reference", p.bank_reference ? <span className="font-mono text-[12.5px]">{p.bank_reference}</span> : null],
              ["Arrival date", date(p.arrival_date)],
              ["Paid", p.paid_at ? date(p.paid_at, true) : null],
              ["Failure", p.failure_reason],
              ["Hold reason", p.hold_reason],
            ]} />
          </Card>
          <Card>
            <CardHeader title="Status timeline" />
            <Timeline items={d.timeline} />
          </Card>
        </div>
      </div>
    </>
  );
}
