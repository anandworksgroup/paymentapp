"use client";

import { useState } from "react";
import { compactMoney, date, flag, money, pct, titleCase } from "@/lib/format";
import { useApi, qs } from "@/lib/merchant/hooks";
import { CURRENCIES } from "@/lib/merchant/money";
import type { Dashboard } from "@/lib/merchant/types";
import { Card, CardHeader, Chip, Empty, ErrorNote, PageHeader, Segmented, ShareBars, Skeleton, Table } from "@/components/ui";
import { useMerchant } from "@/components/merchant/context";
import { RevenueChart } from "@/components/merchant/charts";
import { FilterBar, FilterSelect, Loaded, NoAccess } from "@/components/merchant/common";
import { useCountries } from "@/components/merchant/useMeta";
import { HeroKpis, KpiGrid } from "@/components/merchant/finance/AnalyticsKpis";

type Period = "7" | "30" | "90" | "365";
const PERIODS: { value: Period; label: string }[] = [
  { value: "7", label: "7d" },
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
  { value: "365", label: "12m" },
];

function startFor(days: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1))).toISOString();
}

type Rate = { count: number; success_rate: number };

export default function AnalyticsPage() {
  const { can, org } = useMerchant();
  const countries = useCountries();
  const allowed = can("analytics.read");
  const [range, setRange] = useState<{ period: Period; from: string }>(() => ({ period: "30", from: startFor(30) }));
  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState(org.default_currency);
  const days = Number(range.period);
  const res = useApi<Dashboard>(allowed ? `/v1/reports/dashboard${qs({ from: range.from, currency, country })}` : null);

  if (!allowed) return <NoAccess what="analytics" />;
  const d = res.data;
  const cur = d?.reporting_currency ?? currency;
  const currencyOptions = Array.from(new Set([org.default_currency, ...CURRENCIES]));

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle={d ? `${date(d.period_start)} – ${date(d.period_end)} · reported in ${cur} at reference FX, excluding tax` : "Revenue, subscriptions and payment performance."}
        actions={<Segmented<Period> value={range.period} onChange={(p) => setRange({ period: p, from: startFor(Number(p)) })} options={PERIODS} />}
      />
      <FilterBar>
        <FilterSelect label="Country" value={country} onChange={setCountry} options={[{ value: "", label: "All countries" }, ...countries.map((c) => ({ value: c.country, label: `${flag(c.country)} ${c.name}` }))]} />
        <FilterSelect label="Reporting currency" value={currency} onChange={setCurrency} options={currencyOptions.map((c) => ({ value: c, label: `Report in ${c}` }))} />
        {country && <Chip tone="lemon-soft">Filtered to {country}</Chip>}
      </FilterBar>

      {d ? (
        <HeroKpis d={d} />
      ) : res.error ? (
        <div aria-live="assertive" className="mb-5"><ErrorNote error={res.error} /></div>
      ) : (
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[176px] rounded-card" />)}</div>
      )}

      <Card className="mb-5">
        <CardHeader
          title="Daily revenue"
          subtitle={d ? `${compactMoney(d.gross_revenue, cur)} gross over ${days} days · previous period ${compactMoney(d.previous_period_gross_revenue, cur)}` : "Gross revenue per day"}
          action={d && <Chip tone="lemon-soft">{d.successful_payments} payments</Chip>}
        />
        <Loaded data={d} error={res.error} onRetry={res.reload} skeleton={<Skeleton className="h-64" />}>
          {(x) => (x.series.length ? <RevenueChart series={x.series} from={range.from} days={days} currency={cur} /> : <Empty title="No revenue in this period">Try a longer period or clear the country filter.</Empty>)}
        </Loaded>
      </Card>

      {d && (
        <>
          <Card className="mb-5">
            <CardHeader title="All metrics" subtitle="Tap (i) for how each metric is defined" />
            <KpiGrid d={d} />
          </Card>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader title="Revenue by country" subtitle="Gross, excluding tax" />
              {d.by_country.length ? (
                <>
                  <ShareBars rows={d.by_country.slice(0, 6).map((c) => ({ label: <span className="inline-flex items-center gap-2"><span aria-hidden>{flag(c.country)}</span>{c.country}</span>, value: c.gross, sub: `${c.count}` }))} format={(v) => compactMoney(v, cur)} />
                  <div className="mt-5">
                    <Table
                      rows={d.by_country}
                      rowKey={(c) => c.country}
                      columns={[
                        { key: "c", header: "Country", render: (c) => <span className="whitespace-nowrap">{flag(c.country)} {countries.find((x) => x.country === c.country)?.name ?? c.country}</span> },
                        { key: "n", header: "Payments", align: "right", render: (c) => <span className="text-text-2">{c.count}</span> },
                        { key: "g", header: "Gross", align: "right", render: (c) => <span className="numeral whitespace-nowrap">{money(c.gross, cur)}</span> },
                      ]}
                    />
                  </div>
                </>
              ) : <p className="text-[13px] text-muted">No sales in this period.</p>}
            </Card>
            <div className="min-w-0 space-y-5">
              <RateCard title="By payment method" rows={d.by_method.map((m) => ({ key: m.method, label: m.method === "upi" ? "UPI" : titleCase(m.method), ...m }))} />
              <RateCard title="By provider" rows={d.by_provider.map((p) => ({ key: p.provider, label: p.provider, mono: true, ...p }))} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

function RateCard({ title, rows }: { title: string; rows: (Rate & { key: string; label: string; mono?: boolean })[] }) {
  return (
    <Card>
      <CardHeader title={title} subtitle="Attempts and success rate" />
      {rows.length ? (
        <Table
          rows={rows}
          rowKey={(r) => r.key}
          columns={[
            { key: "l", header: "Name", render: (r) => <span className={r.mono ? "font-mono text-[12.5px]" : ""}>{r.label}</span> },
            { key: "n", header: "Payments", align: "right", render: (r) => <span className="text-text-2">{r.count}</span> },
            { key: "s", header: "Success", align: "right", render: (r) => <Chip tone={r.success_rate >= 90 ? "sage" : r.success_rate >= 70 ? "lemon-soft" : "peach"}>{pct(r.success_rate)}</Chip> },
          ]}
        />
      ) : <p className="text-[13px] text-muted">No payments in this period.</p>}
    </Card>
  );
}
