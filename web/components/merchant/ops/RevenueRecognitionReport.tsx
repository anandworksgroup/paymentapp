"use client";

import { useState } from "react";
import { money } from "@/lib/format";
import { qs } from "@/lib/merchant/hooks";
import { Amount, Card, CardHeader, Empty, ShareBars, Skeleton, Table } from "@/components/ui";
import { FilterBar, FilterSelect, Help, InfoPopover, Loaded } from "../common";
import { Icon } from "../icons";
import { RecognitionChart } from "./RecognitionChart";
import { StatTile, monthLabel, recentMonths, useApiMany, useOrgCurrencies } from "./shared";
import type { RevenueRecognition } from "./types";

/**
 * Revenue recognition (§263) for the last N months: one server report per month, loaded in parallel.
 * Every figure is the server's; the page only arranges them.
 */
export function RevenueRecognitionReport() {
  const currencies = useOrgCurrencies();
  const [currency, setCurrency] = useState(currencies[0]);
  const [span, setSpan] = useState("6");
  const [months] = useState(() => recentMonths(12));
  const shown = months.slice(0, Number(span)).reverse(); // oldest → newest
  const [selected, setSelected] = useState(months[0]);
  const res = useApiMany<RevenueRecognition>(shown.map((m) => `/v1/reports/revenue_recognition${qs({ month: m, currency })}`));

  return (
    <>
      <FilterBar>
        <FilterSelect label="Currency" value={currency} onChange={setCurrency} options={currencies.map((c) => ({ value: c, label: c }))} />
        <FilterSelect label="Months shown" value={span} onChange={setSpan} options={[{ value: "3", label: "Last 3 months" }, { value: "6", label: "Last 6 months" }, { value: "12", label: "Last 12 months" }]} />
      </FilterBar>
      <Loaded
        data={res.data}
        error={res.error}
        onRetry={res.reload}
        skeleton={
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}</div>
            <Skeleton className="h-72 rounded-card" />
          </div>
        }
      >
        {(reports) => {
          const current = reports.find((r) => r.month === selected) ?? reports[reports.length - 1];
          const empty = reports.every((r) => r.billings === 0 && r.recognized_revenue === 0 && r.deferred_revenue_end_of_month === 0 && r.refunds === 0);
          if (empty)
            return (
              <Card>
                <Empty title="Nothing to recognise yet" icon={<Icon name="chart" />}>
                  No paid invoices or one-time sales in {currency} for these months. Try another currency or a longer range.
                </Empty>
              </Card>
            );
          return (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <StatTile label={`Billings · ${monthLabel(current.month)}`} hint="Invoiced and paid in the month, excl. tax">
                  <Amount minor={current.billings} currency={current.currency} size="md" />
                </StatTile>
                <StatTile label="Recognised revenue" hint={`Refunds ${money(current.refunds, current.currency)}`}>
                  <Amount minor={current.recognized_revenue} currency={current.currency} size="md" />
                </StatTile>
                <StatTile label="Net recognised" hint="Recognised minus refunds completed in the month">
                  <Amount minor={current.net_recognized_revenue} currency={current.currency} size="md" />
                </StatTile>
                <StatTile
                  label="Deferred at month end"
                  chip={<InfoPopover label="Deferred revenue">Billed but not yet earned: the part of subscription periods that runs past the end of this month.</InfoPopover>}
                  hint="Still to be recognised in later months"
                >
                  <Amount minor={current.deferred_revenue_end_of_month} currency={current.currency} size="md" />
                </StatTile>
              </div>

              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <Card className="min-w-0">
                  <CardHeader title="Recognised vs deferred" subtitle="Click a month to see its figures and products." />
                  <RecognitionChart
                    currency={currency}
                    selected={current.month}
                    onSelect={setSelected}
                    points={reports.map((r) => ({ key: r.month, label: monthLabel(r.month, true), recognized: r.recognized_revenue, deferred: r.deferred_revenue_end_of_month }))}
                  />
                </Card>
                <Card className="min-w-0">
                  <CardHeader title="By product" subtitle={`Recognised in ${monthLabel(current.month)}`} />
                  {current.by_product.length ? (
                    <ShareBars format={(v) => money(v, current.currency)} rows={current.by_product.map((p) => ({ label: p.name ?? p.product, value: p.recognized }))} />
                  ) : (
                    <p className="text-[13px] text-muted">No product revenue recognised this month.</p>
                  )}
                </Card>
              </div>

              <Card>
                <CardHeader title="Month by month" />
                <Table
                  rows={[...reports].reverse()}
                  rowKey={(r) => r.month}
                  onRowClick={(r) => setSelected(r.month)}
                  columns={[
                    { key: "m", header: "Month", render: (r) => <span className={r.month === current.month ? "font-medium text-text" : "text-text-2"}>{monthLabel(r.month)}</span> },
                    { key: "b", header: "Billings", align: "right", render: (r) => <span className="numeral">{money(r.billings, r.currency)}</span> },
                    { key: "r", header: "Recognised", align: "right", render: (r) => <span className="numeral">{money(r.recognized_revenue, r.currency)}</span> },
                    { key: "f", header: "Refunds", align: "right", render: (r) => <span className="numeral text-text-2">{r.refunds ? money(-r.refunds, r.currency) : "—"}</span> },
                    { key: "n", header: "Net recognised", align: "right", render: (r) => <span className="numeral">{money(r.net_recognized_revenue, r.currency)}</span> },
                    { key: "d", header: "Deferred at end", align: "right", render: (r) => <span className="numeral">{money(r.deferred_revenue_end_of_month, r.currency)}</span> },
                  ]}
                />
                <div className="mt-4"><Help>{current.methodology}</Help></div>
              </Card>
            </div>
          );
        }}
      </Loaded>
    </>
  );
}
