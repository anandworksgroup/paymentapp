"use client";

import { useState } from "react";
import { date, money, titleCase } from "@/lib/format";
import { qs, useApi } from "@/lib/merchant/hooks";
import { Amount, Card, CardHeader, Chip, Empty, ShareBars, Skeleton } from "@/components/ui";
import { FilterBar, FilterSelect, Help, InfoPopover, Loaded } from "../common";
import { Icon } from "../icons";
import { Numeral, StatTile, useOrgCurrencies } from "./shared";
import type { ChurnReport as Report } from "./types";

const PRESETS = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "180", label: "Last 6 months" },
  { value: "365", label: "Last 12 months" },
];

/** Logo vs revenue churn and voluntary vs involuntary cancellations (§258). */
export function ChurnReport() {
  const currencies = useOrgCurrencies();
  const [currency, setCurrency] = useState(currencies[0]);
  const [days, setDays] = useState("90");
  const [today] = useState(() => new Date());
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));
  const from = new Date(to.getTime() - Number(days) * 86_400_000);
  const res = useApi<Report>(`/v1/reports/churn${qs({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), currency })}`);

  return (
    <>
      <FilterBar>
        <FilterSelect label="Period" value={days} onChange={setDays} options={PRESETS} />
        <FilterSelect label="Currency" value={currency} onChange={setCurrency} options={currencies.map((c) => ({ value: c, label: c }))} />
      </FilterBar>
      <Loaded
        data={res.data}
        error={res.error}
        onRetry={res.reload}
        skeleton={<div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}</div>}
      >
        {(c) => (
          <div className="space-y-5">
            <p className="text-[12.5px] text-muted">{date(c.period_start)} – {date(c.period_end)}</p>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <StatTile label="Logo churn" chip={<InfoPopover label="Logo churn">{c.definitions.logo_churn}</InfoPopover>} hint={`${c.cancelled} cancelled of ${c.subscriptions_at_start} active at start`}>
                <Numeral unit="%">{c.logo_churn_pct}</Numeral>
              </StatTile>
              <StatTile label="Revenue churn" chip={<InfoPopover label="Revenue churn">{c.definitions.revenue_churn}</InfoPopover>} hint={`${money(c.mrr_lost, c.currency)} of monthly recurring revenue lost`}>
                <Numeral unit="%">{c.revenue_churn_pct}</Numeral>
              </StatTile>
              <StatTile label="MRR at period start" hint="Before discounts, excluding usage">
                <Amount minor={c.mrr_at_start} currency={c.currency} size="md" />
              </StatTile>
              <StatTile label="MRR lost" chip={c.retention_saves ? <Chip tone="lemon">{c.retention_saves} saved</Chip> : undefined} hint="Monthly amount of the cancelled subscriptions">
                <Amount minor={c.mrr_lost} currency={c.currency} size="md" />
              </StatTile>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader title="Voluntary vs involuntary" subtitle="Who chose to leave, and who left because payment kept failing." />
                {c.cancelled ? (
                  <>
                    <ShareBars
                      format={(v) => `${v}`}
                      rows={[
                        { label: "Voluntary (customer cancelled)", value: c.voluntary },
                        { label: <span className="inline-flex items-center gap-1">Involuntary (payment failed) <InfoPopover label="Involuntary churn">{c.definitions.involuntary}</InfoPopover></span>, value: c.involuntary },
                      ]}
                    />
                    <p className="mt-4 text-[12.5px] text-muted">
                      Involuntary churn is often recoverable: smart retries, card updater and dunning emails run automatically on subscriptions.
                    </p>
                  </>
                ) : (
                  <Empty title="No cancellations" icon={<Icon name="repeat" />}>No subscription was cancelled in this period.</Empty>
                )}
              </Card>
              <Card>
                <CardHeader title="Cancellation reasons" />
                {c.reasons.length ? (
                  <ShareBars format={(v) => `${v}`} rows={[...c.reasons].sort((a, b) => b.count - a.count).map((r) => ({ label: titleCase(r.reason), value: r.count }))} />
                ) : (
                  <p className="text-[13px] text-muted">No cancellations to break down.</p>
                )}
              </Card>
            </div>
            <Help>Subscriptions counted: {c.subscriptions_at_start} active at the start of the period. Amounts are in {c.currency}; other currencies are converted at mid-market rates.</Help>
          </div>
        )}
      </Loaded>
    </>
  );
}
