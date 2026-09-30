"use client";

import { useState } from "react";
import { money } from "@/lib/format";
import { qs, useApi } from "@/lib/merchant/hooks";
import { Card, CardHeader, Empty, Skeleton } from "@/components/ui";
import { FilterBar, FilterSelect, Help, Loaded } from "../common";
import { Icon } from "../icons";
import { monthLabel, useOrgCurrencies } from "./shared";
import type { CohortReport as Report } from "./types";

/** One sage hue, light → dark with retention; text always stays in text colours. */
function cellStyle(pct: number) {
  const p = Math.max(0, Math.min(100, pct));
  return { background: `color-mix(in srgb, var(--sage-500) ${Math.round(8 + p * 0.62)}%, var(--surface-2))` };
}

/** Cohort retention grid (§259): customers grouped by month of first payment. */
export function CohortReport() {
  const currencies = useOrgCurrencies();
  const [currency, setCurrency] = useState(currencies[0]);
  const [months, setMonths] = useState("12");
  const [metric, setMetric] = useState<"pct" | "revenue">("pct");
  const res = useApi<Report>(`/v1/reports/cohorts${qs({ months, currency })}`);

  return (
    <>
      <FilterBar>
        <FilterSelect label="Cohorts" value={months} onChange={setMonths} options={[{ value: "6", label: "Last 6 cohorts" }, { value: "12", label: "Last 12 cohorts" }, { value: "24", label: "Last 24 cohorts" }]} />
        <FilterSelect label="Show" value={metric} onChange={(v) => setMetric(v as "pct" | "revenue")} options={[{ value: "pct", label: "Customer retention" }, { value: "revenue", label: "Revenue (excl. tax)" }]} />
        <FilterSelect label="Currency" value={currency} onChange={setCurrency} options={currencies.map((c) => ({ value: c, label: c }))} />
      </FilterBar>
      <Card className="min-w-0">
        <CardHeader title="Retention by cohort" subtitle="Each row is the month customers first paid; each column is months since then." />
        <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<Skeleton className="h-64" />}>
          {(r) => {
            if (!r.cohorts.length)
              return <Empty title="No cohorts yet" icon={<Icon name="users" />}>Cohorts appear once customers complete their first successful payment.</Empty>;
            const width = Math.max(...r.cohorts.map((c) => c.retention.length));
            return (
              <>
                <div className="-mx-2 overflow-x-auto px-2">
                  <table className="w-full border-separate border-spacing-1 text-[12.5px]">
                    <thead>
                      <tr>
                        <th scope="col" className="px-2 pb-1 text-left font-normal text-muted">Cohort</th>
                        <th scope="col" className="px-2 pb-1 text-right font-normal text-muted">Customers</th>
                        {Array.from({ length: width }, (_, i) => (
                          <th key={i} scope="col" className="min-w-[64px] px-2 pb-1 text-center font-normal text-muted">{i === 0 ? "Month 0" : `+${i}`}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {r.cohorts.map((c) => (
                        <tr key={c.cohort}>
                          <th scope="row" className="whitespace-nowrap rounded-l-[12px] bg-surface-2 px-3 py-2.5 text-left font-normal text-text">{monthLabel(c.cohort)}</th>
                          <td className="bg-surface-2 px-3 py-2.5 text-right numeral text-text-2">{c.customers}</td>
                          {Array.from({ length: width }, (_, i) => {
                            const cell = c.retention.find((x) => x.month_offset === i);
                            if (!cell) return <td key={i} aria-label="Not yet reached" />;
                            const title = `${monthLabel(c.cohort)} · month ${i}: ${cell.active_customers} of ${c.customers} active (${cell.retention_pct}%), ${money(cell.revenue, r.currency, { code: true })}`;
                            return (
                              <td key={i} title={title} className="rounded-[12px] px-2 py-2.5 text-center text-text" style={cellStyle(cell.retention_pct)}>
                                <span className="numeral">{metric === "pct" ? `${cell.retention_pct}%` : money(cell.revenue, r.currency)}</span>
                                <span className="sr-only">, {cell.active_customers} customers active</span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-muted" aria-hidden>
                  <span>0%</span>
                  <span className="h-2.5 w-32 rounded-full" style={{ background: "linear-gradient(to right, color-mix(in srgb, var(--sage-500) 8%, var(--surface-2)), color-mix(in srgb, var(--sage-500) 70%, var(--surface-2)))" }} />
                  <span>100% retained</span>
                  <span className="ml-2">Shade always follows customer retention; hover a cell for detail.</span>
                </div>
                <div className="mt-3">
                  <Help>
                    Cohort basis: {r.cohort_basis}. A customer counts as active with {r.activity_definition}. Revenue excludes tax and is converted to {r.currency} at mid-market rates for other currencies.
                  </Help>
                </div>
              </>
            );
          }}
        </Loaded>
      </Card>
    </>
  );
}
