"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Card, Chip, PageHeader, Table } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { money } from "@/lib/format";
import { useAdminQuery } from "@/components/admin/data";
import { FlowGraph, RELATION_STYLE } from "@/components/admin/flow-graph";
import { EntityLink, FilterBar, FilterSelect, IdTag, Loadable, Notice, When, humanize } from "@/components/admin/kit";
import { Guard } from "@/components/admin/shell";
import type { FundTrace, GraphNode } from "@/components/admin/types";

export default function TracePage() {
  return (
    <Guard perm="admin.aml.read">
      <Trace />
    </Guard>
  );
}

function Trace() {
  const { id } = useParams<{ id: string }>();
  const [hops, setHops] = useState("3");
  const [windowDays, setWindowDays] = useState("7");
  const q = useAdminQuery<FundTrace>(`/transfers/${id}/trace?hops=${hops}&window_days=${windowDays}`);

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            Fund trace · <Link href={`/admin/transactions/${id}`} className="underline decoration-line-strong underline-offset-4">{id}</Link>
          </span>
        }
        title="Trace funds"
        subtitle="Follows money backwards to what funded the sender and forwards through later outflows of the recipients."
      />
      <div className="mb-5">
        <Notice tone="lemon">
          Only the selected transaction (solid, bold) is a recorded movement of <i>these</i> funds. Wallet balances are pooled, so earlier inflows and later outflows (dashed) are
          context for review — never proof that the same money moved along that path.
        </Notice>
      </div>
      <Card>
        <CardHeader title="Money-flow graph" subtitle="Click a wallet or merchant to open it; click an amount to open that transfer. Drag to pan." />
        <FilterBar>
          <FilterSelect label="Forward hops" value={hops} onChange={setHops} options={[1, 2, 3, 4, 5].map((h) => ({ value: String(h), label: `${h} hop${h > 1 ? "s" : ""}` }))} />
          <FilterSelect label="Time window" value={windowDays} onChange={setWindowDays} options={[1, 3, 7, 14, 30, 90].map((d) => ({ value: String(d), label: `${d} day${d > 1 ? "s" : ""}` }))} />
        </FilterBar>
        <Loadable q={q}>
          {(t) => {
            const nodes = new Map<string, GraphNode>(t.nodes.map((n) => [n.id, n]));
            const counts = t.edges.reduce<Record<string, number>>((m, e) => ({ ...m, [e.relation]: (m[e.relation] ?? 0) + 1 }), {});
            return (
              <>
                <div className="mb-4 flex flex-wrap gap-2">
                  {Object.entries(counts).map(([k, v]) => (
                    <Chip key={k} tone={k === "actual" ? "ink" : k === "inferred_source" ? "sage" : "peach"}>
                      {RELATION_STYLE[k]?.label ?? humanize(k)}: {v}
                    </Chip>
                  ))}
                  {t.ledger_transaction && (
                    <span className="text-[12.5px] text-muted">
                      Ledger: <EntityLink type="ledger_transaction" id={t.ledger_transaction} />
                    </span>
                  )}
                </div>
                <FlowGraph nodes={t.nodes} edges={t.edges} rootEdge={t.root} height={620} />
                <div className="mt-6">
                  <h3 className="mb-2 text-[14px] font-medium text-text">Movements in this trace</h3>
                  <Table
                    rows={[...t.edges].sort((a, b) => a.at.localeCompare(b.at))}
                    rowKey={(r) => r.id + r.relation}
                    columns={[
                      { key: "at", header: "When", render: (r) => <When at={r.at} /> },
                      {
                        key: "rel",
                        header: "Relation",
                        render: (r) => (
                          <span className="inline-flex items-center gap-2">
                            <svg width="28" height="8" aria-hidden>
                              <line x1="1" y1="4" x2="27" y2="4" stroke={RELATION_STYLE[r.relation]?.stroke} strokeWidth="2" strokeDasharray={RELATION_STYLE[r.relation]?.dash} />
                            </svg>
                            {RELATION_STYLE[r.relation]?.label ?? humanize(r.relation)}
                          </span>
                        ),
                      },
                      { key: "from", header: "From", render: (r) => <span className="text-text-2">{nodes.get(r.from)?.label ?? r.from}</span> },
                      { key: "to", header: "To", render: (r) => <span className="text-text-2">{nodes.get(r.to)?.label ?? r.to}</span> },
                      { key: "amt", header: "Amount", align: "right", render: (r) => <span className="numeral">{money(r.amount, r.currency, { code: true })}</span> },
                      { key: "st", header: "Status", render: (r) => <span className="text-[12.5px] text-text-2">{humanize(r.status)}</span> },
                      { key: "id", header: "Transfer", render: (r) => <EntityLink type="transfer" id={r.id}><IdTag id={r.id} /></EntityLink> },
                    ]}
                  />
                  <p className="mt-3 text-[12px] text-muted">
                    Window {t.window_days} days · up to {t.max_hops} forward hops · legend from the API: {Object.entries(t.legend).map(([k, v]) => `${humanize(k)} — ${v}`).join("; ")}.
                  </p>
                </div>
              </>
            );
          }}
        </Loadable>
      </Card>
    </>
  );
}
