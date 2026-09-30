"use client";

import type { ReactNode } from "react";
import { Amount, Chip, Stat } from "@/components/ui";
import { money, pct } from "@/lib/format";
import { fixText } from "@/lib/merchant/text";
import type { Dashboard } from "@/lib/merchant/types";
import { DeltaChip, HeroCard } from "../charts";
import { InfoPopover } from "../common";

/** Server definition for a metric, shown in an (i) popover. Mis-encoded server text is repaired for display. */
export function Def({ d, k, label }: { d: Dashboard; k: string; label: string }) {
  const text = d.definitions?.[k];
  return text ? <InfoPopover label={label}>{fixText(text)}</InfoPopover> : null;
}

function Count({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="numeral text-[26px] text-text">{children}</span>
      {sub && <span className="text-[12px] text-muted">{sub}</span>}
    </span>
  );
}

export function HeroKpis({ d }: { d: Dashboard }) {
  const cur = d.reporting_currency;
  const spark = d.series.slice(-12).map((s) => s.gross);
  return (
    <section aria-label="Headline figures" className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <HeroCard tone="sage" label="Gross revenue" minor={d.gross_revenue} currency={cur} chip={<DeltaChip value={d.change_pct} />} spark={spark}
        info={<Def d={d} k="gross_revenue" label="Gross revenue" />}
        footer={<>Previous period {money(d.previous_period_gross_revenue, cur)}</>} />
      <HeroCard label="Net revenue" minor={d.net_revenue} currency={cur} info={<Def d={d} k="net_revenue" label="Net revenue" />}
        footer={<>After refunds, chargebacks and fees</>} />
      <HeroCard label="MRR" minor={d.mrr} currency={cur} info={<Def d={d} k="mrr" label="MRR" />}
        chip={<Chip tone="lemon-soft">{d.active_subscriptions} active</Chip>} footer="Monthly recurring revenue" />
      <HeroCard label="ARR" minor={d.arr} currency={cur} info={<Def d={d} k="arr" label="ARR" />} footer="Run rate, not recognised revenue" />
    </section>
  );
}

export function KpiGrid({ d }: { d: Dashboard }) {
  const cur = d.reporting_currency;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Taxes collected" chip={<Chip tone="lemon-soft">Remitted by platform</Chip>}><Amount minor={d.taxes_collected} currency={cur} size="md" /></Stat>
      <Stat label="Platform fees"><Amount minor={d.platform_fees} currency={cur} size="md" /></Stat>
      <Stat label="Refunds"><Amount minor={d.refunds} currency={cur} size="md" /></Stat>
      <Stat label="Chargebacks"><Amount minor={d.chargebacks} currency={cur} size="md" /></Stat>
      <Stat label="Transactions"><Count sub={`${d.successful_payments} successful · ${d.failed_payments} failed`}>{d.transactions.toLocaleString()}</Count></Stat>
      <Stat label="Conversion" chip={<Def d={d} k="conversion_rate" label="Conversion rate" />}><Count sub="checkout sessions completed">{pct(d.conversion_rate_pct)}</Count></Stat>
      <Stat label="Active subscriptions"><Count>{d.active_subscriptions.toLocaleString()}</Count></Stat>
      <Stat label="Churn" chip={<Def d={d} k="churn" label="Churn" />}><Count sub="in this period">{pct(d.churn_rate_pct)}</Count></Stat>
      <Stat label="Customers"><Count sub={`${d.new_customers.toLocaleString()} new in period`}>{d.customers.toLocaleString()}</Count></Stat>
      <Stat label="ARPU"><Amount minor={d.arpu} currency={cur} size="md" /></Stat>
      <Stat label="LTV estimate" chip={<Def d={d} k="ltv" label="LTV estimate" />}>
        {d.ltv_estimate === null ? <Count sub="needs churn in the period">—</Count> : <Amount minor={d.ltv_estimate} currency={cur} size="md" />}
      </Stat>
      <Stat label="Successful payments"><Count sub={d.transactions ? `of ${d.transactions}` : undefined}>{d.successful_payments.toLocaleString()}</Count></Stat>
    </div>
  );
}
