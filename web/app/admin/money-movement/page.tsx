"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Amount, Card, Chip, Empty, ErrorNote, PageHeader, PillChart, ShareBars, Table } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { compactMoney, exponent } from "@/lib/format";
import { adminApi, useAdminQuery } from "@/components/admin/data";
import { Country, FilterBar, FilterSelect, Num, SkeletonRows, msUntil } from "@/components/admin/kit";
import { Guard } from "@/components/admin/shell";
import type { FxRate, ListResponse, Transfer } from "@/components/admin/types";

const MAX_PAGES = 10;

export default function MoneyMovementPage() {
  return (
    <Guard perm="admin.transactions.read">
      <MoneyMovement />
    </Guard>
  );
}

/** Pages through /transfers (100 per page, up to 1,000) — the API has no aggregate endpoint for corridors. */
function useAllTransfers(status: string) {
  const [res, setRes] = useState<{ key: string; rows: Transfer[]; truncated: boolean; error?: unknown } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const rows: Transfer[] = [];
      let after: string | undefined;
      let more = false;
      try {
        for (let i = 0; i < MAX_PAGES; i++) {
          const page = await adminApi<ListResponse<Transfer>>(`/transfers?limit=100${status ? `&status=${status}` : ""}${after ? `&starting_after=${after}` : ""}`);
          rows.push(...page.data);
          more = !!page.has_more;
          if (!more || page.data.length === 0) break;
          after = page.data[page.data.length - 1].id;
        }
        if (alive) setRes({ key: status, rows, truncated: more });
      } catch (error) {
        if (alive) setRes({ key: status, rows, truncated: false, error });
      }
    })();
    return () => {
      alive = false;
    };
  }, [status]);
  return res && res.key === status ? res : null;
}

type Corridor = { key: string; from: string; to: string; count: number; usd: number; byCurrency: Record<string, number>; held: number };

function MoneyMovement() {
  const router = useRouter();
  const [status, setStatus] = useState("COMPLETED");
  const [days, setDays] = useState("30");
  const [scope, setScope] = useState("all");
  const data = useAllTransfers(status);
  const fx = useAdminQuery<ListResponse<FxRate>>("/config/fx_rates");

  const toUsd = useMemo(() => {
    const rates = new Map<string, number>();
    for (const r of fx.data?.data ?? []) if (r.base === "USD" && !rates.has(r.quote)) rates.set(r.quote, r.rate_e9 / 1e9);
    return (minor: number, cur: string) => {
      if (cur === "USD") return minor;
      const rate = rates.get(cur);
      if (!rate) return null;
      return Math.round((minor / 10 ** exponent(cur) / rate) * 100);
    };
  }, [fx.data]);

  const corridors = useMemo(() => {
    const m = new Map<string, Corridor>();
    let unpriced = 0;
    const horizon = Number(days) * 86400_000;
    for (const t of data?.rows ?? []) {
      if (days !== "all" && -msUntil(t.created_at) > horizon) continue;
      const from = t.sender_country ?? "??";
      const to = t.recipient_country ?? "??";
      if (scope === "cross" && from === to) continue;
      if (scope === "domestic" && from !== to) continue;
      const key = `${from}→${to}`;
      const c = m.get(key) ?? { key, from, to, count: 0, usd: 0, byCurrency: {}, held: 0 };
      c.count++;
      c.byCurrency[t.source_currency] = (c.byCurrency[t.source_currency] ?? 0) + t.source_amount;
      const usd = toUsd(t.source_amount, t.source_currency);
      if (usd === null) unpriced++;
      else c.usd += usd;
      if (t.status === "HELD") c.held++;
      m.set(key, c);
    }
    return { list: [...m.values()].sort((a, b) => b.usd - a.usd), unpriced };
  }, [data, days, scope, toUsd]);

  const total = corridors.list.reduce((s, c) => s + c.usd, 0);
  const count = corridors.list.reduce((s, c) => s + c.count, 0);
  const cross = corridors.list.filter((c) => c.from !== c.to);
  const crossUsd = cross.reduce((s, c) => s + c.usd, 0);
  const top = corridors.list.slice(0, 8);

  return (
    <>
      <PageHeader
        eyebrow="Money movement"
        title="Country flows"
        subtitle="Wallet transfers aggregated by sender → recipient country. Values are converted to USD at the platform's reference rates for comparison only."
      />
      <Card>
        <FilterBar>
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "COMPLETED", label: "Completed" },
              { value: "HELD", label: "Held for review" },
              { value: "", label: "All statuses" },
            ]}
          />
          <FilterSelect
            label="Period"
            value={days}
            onChange={setDays}
            options={[
              { value: "1", label: "Last 24 hours" },
              { value: "7", label: "Last 7 days" },
              { value: "30", label: "Last 30 days" },
              { value: "90", label: "Last 90 days" },
              { value: "all", label: "All loaded" },
            ]}
          />
          <FilterSelect
            label="Scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: "all", label: "All corridors" },
              { value: "cross", label: "Cross-border only" },
              { value: "domestic", label: "Domestic only" },
            ]}
          />
        </FilterBar>
        {!data ? (
          <SkeletonRows rows={6} />
        ) : (
          <>
            {data.error ? (
              <div className="mb-4">
                <ErrorNote error={data.error} />
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-inner bg-surface-2 p-5">
                <div className="text-[13px] text-muted">Value moved</div>
                <Amount minor={total} currency="USD" size="md" className="mt-3" />
              </div>
              <div className="rounded-inner bg-surface-2 p-5">
                <div className="text-[13px] text-muted">Transfers</div>
                <Num value={count} className="mt-3" />
              </div>
              <div className="rounded-inner bg-surface-2 p-5">
                <div className="text-[13px] text-muted">Cross-border share</div>
                <Num value={total ? Math.round((crossUsd / total) * 100) : 0} suffix="%" className="mt-3" />
              </div>
              <div className="rounded-inner bg-surface-2 p-5">
                <div className="text-[13px] text-muted">Corridors</div>
                <Num value={corridors.list.length} className="mt-3" />
              </div>
            </div>
            {(data.truncated || corridors.unpriced > 0) && (
              <p className="mt-3 text-[12px] text-muted">
                {data.truncated && `Only the latest ${MAX_PAGES * 100} transfers were loaded. `}
                {corridors.unpriced > 0 && `${corridors.unpriced} transfer(s) in currencies without a reference rate are counted but not valued.`}
              </p>
            )}
          </>
        )}
      </Card>

      {data && (
        <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader title="Corridors" subtitle="Click a corridor to see its transfers." />
            <Table
              rows={corridors.list}
              rowKey={(r) => r.key}
              onRowClick={(r) => router.push(`/admin/transactions?status=${status}&from_country=${r.from}&to_country=${r.to}`)}
              empty={<Empty title="No transfers in this period" />}
              columns={[
                {
                  key: "route",
                  header: "Corridor",
                  render: (r) => (
                    <span className="inline-flex items-center gap-2">
                      <Country code={r.from} /> <span className="text-faint">→</span> <Country code={r.to} />
                      {r.from !== r.to && <Chip tone="lemon-soft">cross-border</Chip>}
                    </span>
                  ),
                },
                { key: "n", header: "Count", align: "right", render: (r) => <span className="numeral">{r.count}</span> },
                { key: "usd", header: "Value (≈ USD)", align: "right", render: (r) => <Amount minor={r.usd} currency="USD" size="sm" /> },
                {
                  key: "cur",
                  header: "Original currencies",
                  render: (r) => (
                    <span className="text-[12px] text-muted">
                      {Object.entries(r.byCurrency)
                        .map(([c, v]) => compactMoney(v, c) + (compactMoney(v, c).match(/^[A-Z]/) ? "" : ` ${c}`))
                        .join(" · ")}
                    </span>
                  ),
                },
                { key: "held", header: "Held", align: "right", render: (r) => (r.held ? <Chip tone="peach">{r.held}</Chip> : <span className="text-faint">0</span>) },
              ]}
            />
          </Card>
          <div className="space-y-5">
            <Card>
              <CardHeader title="Top corridors by value" />
              {top.length ? (
                <PillChart
                  data={top.map((c) => ({ label: `${c.from}→${c.to}`, value: Math.round(c.usd / 100) }))}
                  highlight={0}
                  format={(v) => `$${v.toLocaleString("en-US")}`}
                />
              ) : (
                <Empty title="No data" />
              )}
            </Card>
            <Card>
              <CardHeader title="Share of transfers by count" />
              {top.length ? <ShareBars rows={[...top].sort((a, b) => b.count - a.count).map((c) => ({ label: `${c.from} → ${c.to}`, value: c.count }))} format={(v) => `${v}`} /> : <Empty title="No data" />}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
