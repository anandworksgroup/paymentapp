"use client";

import { useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import type { List } from "@/lib/api";
import { useApi, qs } from "@/lib/merchant/hooks";
import type { Customer, Meter } from "@/lib/merchant/types";
import { Card, CardHeader, Chip, Empty, PageHeader, PillChart, Segmented, Skeleton } from "@/components/ui";
import { useMerchant } from "@/components/merchant/context";
import { FilterBar, FilterSelect, Loaded, NoAccess } from "@/components/merchant/common";
import { CustomerPicker } from "@/components/merchant/pickers";
import { Icon } from "@/components/merchant/icons";
import { Count, LinkButton, MiniStat } from "@/components/merchant/billing/bits";
import type { CustomerDetail, UsageSummary } from "@/components/merchant/billing/types";

type Period = "7" | "30" | "90";

function startFor(days: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1))).toISOString();
}

function compact(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString("en-US");
}

export default function UsagePage() {
  const { can } = useMerchant();
  const params = useSearchParams();
  const preId = params.get("customer");
  const pre = useApi<CustomerDetail>(preId && can("customers.read") ? `/v1/customers/${preId}` : null);
  const [picked, setPicked] = useState<Customer | null | undefined>(undefined);
  const customer = picked !== undefined ? picked : pre.data?.customer ?? null;
  const customerFilter = picked !== undefined ? picked?.id : preId;
  const [meter, setMeter] = useState("");
  const [range, setRange] = useState<{ period: Period; from: string }>(() => ({ period: "30", from: startFor(30) }));
  const pickerId = useId();
  const meters = useApi<List<Meter>>(can("usage.read") ? "/v1/meters?limit=100" : null);
  const summary = useApi<UsageSummary>(can("usage.read") ? `/v1/usage/summary${qs({ customer: customerFilter, event_name: meter, from: range.from })}` : null);

  if (!can("usage.read")) return <NoAccess what="usage" />;
  const byEvent = new Map((meters.data?.data ?? []).map((m) => [m.event_name, m]));
  const days = Number(range.period);
  const selectedMeter = meter ? byEvent.get(meter) : undefined;

  return (
    <>
      <PageHeader
        title="Usage"
        subtitle="Metered events reported through the API, per meter and per day."
        actions={
          <Segmented<Period>
            value={range.period}
            onChange={(p) => setRange({ period: p, from: startFor(Number(p)) })}
            options={[{ value: "7", label: "7d" }, { value: "30", label: "30d" }, { value: "90", label: "90d" }]}
          />
        }
      />
      <FilterBar>
        <div className="w-full min-w-0 sm:w-80">
          <label htmlFor={pickerId} className="sr-only">Customer</label>
          {preId && pre.loading && picked === undefined ? <Skeleton className="h-11" /> : <CustomerPicker id={pickerId} value={customer} onChange={setPicked} />}
        </div>
        {preId && picked === undefined && !customer && !pre.loading && <Chip tone="lemon-soft">Customer {preId}</Chip>}
        <FilterSelect
          label="Meter"
          value={meter}
          onChange={setMeter}
          options={[{ value: "", label: "All meters" }, ...(meters.data?.data ?? []).map((m) => ({ value: m.event_name, label: m.display_name }))]}
        />
      </FilterBar>

      <Loaded
        data={summary.data}
        error={summary.error}
        onRetry={summary.reload}
        skeleton={<div className="space-y-4"><div className="grid grid-cols-1 gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-card" />)}</div><Skeleton className="h-72 rounded-card" /></div>}
      >
        {(s) =>
          s.by_event.length === 0 ? (
            <Card>
              <Empty
                title="No usage in this period"
                icon={<Icon name="gauge" />}
                action={meters.data && meters.data.data.length === 0 ? <LinkButton href="/meters">Set up a meter</LinkButton> : undefined}
              >
                Send events to <span className="font-mono">POST /v1/usage_events</span> with a meter&apos;s event name and they show up here.
              </Empty>
            </Card>
          ) : (
            <>
              <section aria-label="Usage per meter" className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {s.by_event.map((e) => {
                  const m = byEvent.get(e.event_name);
                  return (
                    <div key={e.event_name} className="rounded-card bg-surface p-6 shadow-card">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block text-[13px] text-text-2">{m?.display_name ?? e.event_name}</span>
                          <span className="block font-mono text-[11.5px] text-muted">{e.event_name}{m ? ` · ${m.aggregation}` : ""}</span>
                        </span>
                        <Chip tone="lemon">{e.events.toLocaleString("en-US")} events</Chip>
                      </div>
                      <div className="mt-6"><Count value={e.quantity} unit={m?.unit} size="lg" /></div>
                      <div className="mt-3">
                        <MiniStat label="Not yet invoiced"><Count value={e.unbilled} unit={m?.unit} size="sm" /></MiniStat>
                      </div>
                    </div>
                  );
                })}
              </section>
              <Card>
                <CardHeader
                  title="Daily usage"
                  subtitle={`${selectedMeter ? selectedMeter.display_name : "All meters"} · last ${days} days${customer ? ` · ${customer.name ?? customer.email ?? customer.id}` : ""}`}
                />
                <DailyChart byDay={s.by_day} from={range.from} days={days} unit={selectedMeter?.unit ?? (s.by_event.length === 1 ? byEvent.get(s.by_event[0].event_name)?.unit : undefined)} />
              </Card>
            </>
          )
        }
      </Loaded>
    </>
  );
}

function DailyChart({ byDay, from, days, unit }: { byDay: UsageSummary["by_day"]; from: string; days: number; unit?: string | null }) {
  const map = new Map(byDay.map((d) => [d.date, d.quantity]));
  const start = new Date(from);
  const points = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i));
    const key = d.toISOString().slice(0, 10);
    return { key, day: d.getUTCDate(), value: map.get(key) ?? 0 };
  });
  const step = days <= 14 ? 1 : days <= 31 ? 3 : 10;
  return (
    <>
      <PillChart data={points.map((p, i) => ({ label: i % step === 0 || i === points.length - 1 ? String(p.day) : "", value: p.value }))} format={compact} height={days > 31 ? 200 : 230} />
      <table className="sr-only">
        <caption>Daily usage{unit ? ` in ${unit}` : ""}</caption>
        <tbody>
          {points.map((p) => <tr key={p.key}><th scope="row">{p.key}</th><td>{p.value}</td></tr>)}
        </tbody>
      </table>
    </>
  );
}
