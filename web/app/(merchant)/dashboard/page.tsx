"use client";

import Link from "next/link";
import { useState } from "react";
import type { List } from "@/lib/api";
import { useApi, qs } from "@/lib/merchant/hooks";
import type { AttentionItem, Checklist, Dashboard, Payment } from "@/lib/merchant/types";
import { Card, CardHeader, Chip, Empty, ErrorNote, PageHeader, Segmented, ShareBars, Skeleton, StatusChip, cx } from "@/components/ui";
import { compactMoney, date, flag, money, pct, titleCase } from "@/lib/format";
import { useMerchant } from "@/components/merchant/context";
import { DeltaChip, HeroCard, RevenueChart } from "@/components/merchant/charts";
import { InfoPopover, Loaded, TxRow, rollingSpark } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { fixText } from "@/lib/merchant/text";

type Period = "7" | "30" | "90";

function startFor(days: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1))).toISOString();
}

export default function DashboardPage() {
  const { me, org, can } = useMerchant();
  const [range, setRange] = useState<{ period: Period; from: string }>(() => ({ period: "30", from: startFor(30) }));
  const days = Number(range.period);
  const dash = useApi<Dashboard>(can("analytics.read") ? `/v1/reports/dashboard${qs({ from: range.from })}` : null);
  const attention = useApi<{ items: AttentionItem[] }>(can("payments.read") ? "/v1/reports/attention" : null);
  const recent = useApi<List<Payment>>(can("payments.read") ? "/v1/payments?limit=8" : null);
  const checklist = useApi<Checklist>(org.go_live_state !== "PRODUCTION" && can("team.read") ? "/v1/organization/checklist" : null);
  const d = dash.data;
  const cur = d?.reporting_currency ?? org.default_currency;
  const bal = d?.balance.balances.find((b) => b.currency === cur) ?? d?.balance.balances[0];
  const firstName = me.user.name.split(" ")[0];
  const spark = d ? d.series.slice(-12).map((s) => s.gross) : undefined;

  return (
    <>
      <PageHeader
        eyebrow={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        title={`Hello, ${firstName}`}
        subtitle="Here's how your business is doing."
        actions={
          can("analytics.read") && (
            <Segmented<Period>
              value={range.period}
              onChange={(p) => setRange({ period: p, from: startFor(Number(p)) })}
              options={[{ value: "7", label: "7d" }, { value: "30", label: "30d" }, { value: "90", label: "90d" }]}
            />
          )
        }
      />

      {checklist.data && !checklist.data.items.every((i) => i.state === "done" || i.state === "optional") ? <SetupChecklist list={checklist.data} /> : null}

      {can("analytics.read") ? (
        <>
          {/* Q1–Q2: how much did I make, and what can I take out? */}
          <section aria-label="Key figures" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {d ? (
              <>
                <HeroCard tone="sage" label="Available balance" minor={bal?.available ?? 0} currency={bal?.currency ?? cur}
                  chip={<Chip tone="lemon">{titleCase(d.balance.source)}</Chip>}
                  footer={bal ? <>{money(bal.pending, bal.currency)} pending · {money(bal.in_transit_to_bank, bal.currency)} in transit</> : "No balance yet"} />
                <HeroCard label="Gross revenue" minor={d.gross_revenue} currency={cur} chip={<DeltaChip value={d.change_pct} />} spark={spark}
                  info={<InfoPopover label="Gross revenue">{fixText(d.definitions.gross_revenue)}</InfoPopover>}
                  footer={`${d.successful_payments} successful payments`} />
                <HeroCard label="Net revenue" minor={d.net_revenue} currency={cur}
                  info={<InfoPopover label="Net revenue">{fixText(d.definitions.net_revenue)}</InfoPopover>}
                  footer={<>{money(d.platform_fees, cur)} fees · {money(d.refunds, cur)} refunds</>} />
                <HeroCard label="MRR" minor={d.mrr} currency={cur} chip={<Chip tone="sage">{pct(d.conversion_rate_pct)} conversion</Chip>}
                  info={<InfoPopover label="MRR">{fixText(d.definitions.mrr)}</InfoPopover>}
                  footer={`${d.active_subscriptions} active subscriptions`} />
              </>
            ) : dash.error ? (
              <div className="sm:col-span-2 xl:col-span-4"><ErrorNote error={dash.error} /></div>
            ) : (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[176px] rounded-card" />)
            )}
          </section>

          <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader
                title="Daily revenue"
                subtitle={d ? `${compactMoney(d.gross_revenue, cur)} gross over ${days} days · excludes tax` : "Gross revenue per day"}
                action={d && <Chip tone="lemon-soft">{d.transactions} payments</Chip>}
              />
              <Loaded data={d} error={dash.error} skeleton={<Skeleton className="h-64" />}>
                {(data) => (data.series.length ? <RevenueChart series={data.series} from={range.from} days={days} currency={cur} /> : <Empty title="No revenue in this period">Payments you receive will show up here day by day.</Empty>)}
              </Loaded>
            </Card>
            <AttentionCenter state={attention} />
          </div>
        </>
      ) : (
        <div className="mb-5"><AttentionCenter state={attention} /></div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {can("payments.read") && <RecentPayments state={recent} />}
        {d && (
          <div className="space-y-5">
            <Card>
              <CardHeader title="Revenue by country" subtitle="Gross, excluding tax" />
              {d.by_country.length ? (
                <ShareBars rows={d.by_country.slice(0, 6).map((c) => ({ label: <span className="inline-flex items-center gap-2"><span aria-hidden>{flag(c.country)}</span>{c.country}</span>, value: c.gross, sub: `${c.count}` }))} format={(v) => compactMoney(v, cur)} />
              ) : <p className="text-[13px] text-muted">No sales in this period.</p>}
            </Card>
            <Card>
              <CardHeader title="Payments by method" subtitle="Count and success rate" />
              {d.by_method.length ? (
                <ShareBars rows={d.by_method.map((m) => ({ label: titleCase(m.method), value: m.count, sub: `${pct(m.success_rate)} ok` }))} format={(v) => `${v}`} />
              ) : <p className="text-[13px] text-muted">No payments in this period.</p>}
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

function AttentionCenter({ state }: { state: { data?: { items: AttentionItem[] }; error?: unknown; loading: boolean; reload: () => void } }) {
  const icons: Record<string, string> = { failed_payments: "alert", disputes: "scale", risk_review: "shield", at_risk: "repeat", payouts: "bank", compliance: "check" };
  return (
    <Card>
      <CardHeader title="Needs attention" subtitle="Things that need a decision from you" />
      <Loaded data={state.data} error={state.error} onRetry={state.reload} skeleton={<div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>}>
        {(a) =>
          a.items.length ? (
            <ul className="space-y-2">
              {a.items.map((it) => (
                <li key={it.kind}>
                  <Link href={it.link} className="flex items-center gap-3 rounded-inner bg-surface-2 px-4 py-3 transition hover:bg-surface-3">
                    <span className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-full", it.kind === "disputes" || it.kind === "failed_payments" ? "bg-peach-soft text-peach-ink" : "bg-lemon-soft text-lemon-ink")}>
                      <Icon name={icons[it.kind] ?? "info"} size={17} />
                    </span>
                    <span className="flex-1 text-[13.5px] text-text">{it.label}</span>
                    <Icon name="right" size={15} className="text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="All clear" icon={<Icon name="check" />}>Nothing needs your attention right now.</Empty>
          )
        }
      </Loaded>
    </Card>
  );
}

function RecentPayments({ state }: { state: { data?: List<Payment>; error?: unknown; reload: () => void } }) {
  return (
    <Card>
      <CardHeader title="Recent payments" action={<Link href="/payments" className="rounded-full bg-surface-2 px-3.5 py-1.5 text-[12.5px] text-text-2 hover:bg-surface-3">View all</Link>} />
      <Loaded data={state.data} error={state.error} onRetry={state.reload} skeleton={<div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>}>
        {(list) =>
          list.data.length ? (
            <div>
              {list.data.map((p, i) => (
                <TxRow
                  key={p.id}
                  href={`/payments/${p.id}`}
                  label={<>{p.customer_email ?? p.description ?? p.id} · {date(p.created_at, true)}</>}
                  minor={p.amount}
                  currency={p.currency}
                  country={p.country}
                  spark={rollingSpark(list.data, i, (x) => x.amount)}
                  right={<StatusChip status={p.status} />}
                />
              ))}
            </div>
          ) : (
            <Empty title="No payments yet">Create a payment link and pay it with a test card to see your first payment here.</Empty>
          )
        }
      </Loaded>
    </Card>
  );
}

function SetupChecklist({ list }: { list: Checklist }) {
  const links: Record<string, string> = {
    business_verification: "/settings/verification", payout_account: "/settings/payout-accounts", product: "/products", price: "/products",
    checkout: "/payment-links", webhook: "/developers/webhooks", test_payment: "/payment-links", go_live: "/settings/go-live",
  };
  const done = list.items.filter((i) => i.state === "done").length;
  return (
    <Card className="mb-5 lemon-gradient">
      <CardHeader
        title="Get ready to go live"
        subtitle={`${done} of ${list.items.length} steps complete · you're in test mode until production is activated`}
        action={list.can_go_live ? <Link href="/settings/go-live" className="whitespace-nowrap rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-white">Go live</Link> : null}
      />
      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {list.items.map((i) => (
          <li key={i.key}>
            <Link href={links[i.key] ?? "/dashboard"} className="flex h-full items-center gap-3 rounded-inner bg-white/70 px-4 py-3 text-[13px] transition hover:bg-white">
              <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full", i.state === "done" ? "bg-sage-500 text-white" : i.state === "attention" ? "bg-peach text-peach-ink" : "border border-line-strong bg-white text-faint")}>
                {i.state === "done" ? <Icon name="check" size={13} /> : null}
              </span>
              <span className={cx("flex-1", i.state === "done" ? "text-muted line-through decoration-faint" : "text-text")}>{i.label}</span>
              {i.state !== "done" && <StatusChip status={i.state === "todo" ? "pending" : i.state} />}
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
