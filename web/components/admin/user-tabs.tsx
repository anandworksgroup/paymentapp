"use client";

import { useMemo, useState } from "react";
import { Amount, Card, Chip, Empty, StatusChip, Table, type Tone } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { useAdminQuery, useDirectory } from "./data";
import { FlowGraph } from "./flow-graph";
import { useAdmin } from "./session";
import { EntityLink, entityHref, FilterBar, FilterInput, Loadable, Notice, Person, When, humanize } from "./kit";
import type { FundFlowGraph, Network, TimelineItem } from "./types";

const KIND_TONES: Record<string, Tone> = { account: "sky", security: "neutral", kyc: "sage", bank: "peach", money: "lemon-soft", alert: "peach", case: "rose", admin: "neutral" };

export function TimelineTab({ userId }: { userId: string }) {
  const q = useAdminQuery<{ data: TimelineItem[] }>(`/users/${userId}/timeline`);
  const [kind, setKind] = useState("");
  // The timeline endpoint only needs admin.users.read but includes alert and case events; roles
  // without AML access (e.g. support) don't see those.
  const aml = useAdmin().can("admin.aml.read");
  return (
    <Card>
      <CardHeader title="Timeline" subtitle="Everything that happened on this account, oldest first: sign-ins, verification, bank changes, money movement, alerts, cases and staff actions." />
      <Loadable q={q}>
        {(raw) => {
          const d = { data: raw.data.filter((i) => aml || (i.kind !== "alert" && i.kind !== "case")) };
          const kinds = [...new Set(d.data.map((i) => i.kind))];
          const items = d.data.filter((i) => !kind || i.kind === kind);
          return (
            <>
              <div className="mb-4 flex flex-wrap gap-1.5">
                <button onClick={() => setKind("")} className={`rounded-full px-3 py-1 text-[12px] ${kind === "" ? "bg-ink text-white" : "bg-surface-2 text-text-2"}`}>
                  All {d.data.length}
                </button>
                {kinds.map((k) => (
                  <button key={k} onClick={() => setKind(k)} className={`rounded-full px-3 py-1 text-[12px] ${kind === k ? "bg-ink text-white" : "bg-surface-2 text-text-2"}`}>
                    {humanize(k)} {d.data.filter((i) => i.kind === k).length}
                  </button>
                ))}
              </div>
              {items.length === 0 ? (
                <Empty title="No events" />
              ) : (
                <ol className="relative ml-2 border-l border-line pl-6">
                  {items.map((i, n) => {
                    const href = entityHref(null, i.ref);
                    return (
                      <li key={n} className="relative pb-5 last:pb-0">
                        <span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-surface bg-sage-500" />
                        <div className="flex flex-wrap items-center gap-2">
                          <Chip tone={KIND_TONES[i.kind] ?? "neutral"}>{humanize(i.kind)}</Chip>
                          <When at={i.at} />
                        </div>
                        <p className="mt-1 text-[13.5px] text-text">
                          {i.text}
                          {href && i.ref && (
                            <span className="ml-2">
                              <EntityLink id={i.ref} />
                            </span>
                          )}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              )}
            </>
          );
        }}
      </Loadable>
    </Card>
  );
}

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function FundFlowTab({ userId, defaultFrom, defaultTo }: { userId: string; defaultFrom: string; defaultTo: string }) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const toParam = to ? isoDay(new Date(new Date(to).getTime() + 86400_000)) : "";
  const q = useAdminQuery<FundFlowGraph>(`/users/${userId}/fund_flow?from=${from}${toParam ? `&to=${toParam}` : ""}`);
  return (
    <Card>
      <CardHeader
        title="Fund flow"
        subtitle="Money in and out of this user's wallet, plus devices used. Solid lines are recorded movements. Click a node to open it, or an amount to open the transfer."
      />
      <FilterBar>
        <FilterInput label="From" type="date" value={from} onChange={setFrom} width="w-44" />
        <FilterInput label="To" type="date" value={to} onChange={setTo} width="w-44" />
        <span className="pb-2 text-[12px] text-muted">Default window: the last 90 days</span>
      </FilterBar>
      <Loadable q={q}>
        {(g) => (
          <>
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-inner bg-surface-2 p-4">
                <div className="text-[12.5px] text-muted">Incoming (completed)</div>
                <div className="mt-2 flex flex-wrap gap-4">
                  {Object.keys(g.totals.incoming).length === 0 ? <span className="text-muted">—</span> : Object.entries(g.totals.incoming).map(([c, v]) => <Amount key={c} minor={v} currency={c} size="md" />)}
                </div>
              </div>
              <div className="rounded-inner bg-surface-2 p-4">
                <div className="text-[12.5px] text-muted">Outgoing (completed or processing)</div>
                <div className="mt-2 flex flex-wrap gap-4">
                  {Object.keys(g.totals.outgoing).length === 0 ? <span className="text-muted">—</span> : Object.entries(g.totals.outgoing).map(([c, v]) => <Amount key={c} minor={v} currency={c} size="md" />)}
                </div>
              </div>
            </div>
            <FlowGraph nodes={g.nodes} edges={g.edges} focusNode={g.nodes[0]?.id} subjectUserId={userId} />
          </>
        )}
      </Loadable>
    </Card>
  );
}

const STRENGTH_TONE: Record<string, Tone> = { strong: "peach", weak: "neutral", direct: "sky" };
const SIGNAL_LABEL: Record<string, string> = {
  shared_device: "Shared device",
  shared_bank_account: "Shared bank account",
  shared_ip: "Shared IP address",
  direct_counterparty: "Direct counterparty",
};

export function NetworkTab({ userId }: { userId: string }) {
  const q = useAdminQuery<Network>(`/users/${userId}/network`);
  const dir = useDirectory();
  const [hideStaff, setHideStaff] = useState(true);
  const grouped = useMemo(() => {
    const m = new Map<string, { user: string; signals: { signal: string; strength: string; detail: string }[] }>();
    for (const l of q.data?.links ?? []) {
      const g = m.get(l.user) ?? { user: l.user, signals: [] };
      if (!g.signals.some((s) => s.signal === l.signal && s.detail === l.detail)) g.signals.push({ signal: l.signal, strength: l.strength, detail: l.detail });
      m.set(l.user, g);
    }
    const rank = (s: string) => (s === "strong" ? 0 : s === "direct" ? 1 : 2);
    return [...m.values()].sort((a, b) => Math.min(...a.signals.map((s) => rank(s.strength))) - Math.min(...b.signals.map((s) => rank(s.strength))));
  }, [q.data]);
  const staff = grouped.filter((g) => dir.users.get(g.user)?.platform_role);
  const rows = hideStaff ? grouped.filter((g) => !dir.users.get(g.user)?.platform_role) : grouped;

  return (
    <Card>
      <CardHeader title="Network" subtitle="Accounts linked to this user by shared devices, bank accounts, IP addresses or direct transfers." />
      <Loadable q={q}>
        {(n) => (
          <>
            <div className="mb-4">
              <Notice tone="lemon">{n.caution} Strength describes how specific a signal is — a shared IP can simply mean a shared network, VPN or office.</Notice>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-[12.5px] text-muted">
              <span>
                {grouped.length} linked account{grouped.length === 1 ? "" : "s"} · {n.links.length} signals
              </span>
              {staff.length > 0 && (
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={hideStaff} onChange={(e) => setHideStaff(e.target.checked)} className="accent-[var(--ink)]" />
                  Hide {staff.length} platform staff account{staff.length === 1 ? "" : "s"}
                </label>
              )}
            </div>
            <Table
              rows={rows}
              rowKey={(r) => r.user}
              empty={<Empty title="No linked accounts">No shared signals were found.</Empty>}
              columns={[
                { key: "user", header: "Account", render: (r) => <Person id={r.user} /> },
                {
                  key: "signals",
                  header: "Signals",
                  render: (r) => (
                    <ul className="space-y-1.5">
                      {r.signals.map((s, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2">
                          <Chip tone={STRENGTH_TONE[s.strength] ?? "neutral"}>
                            {SIGNAL_LABEL[s.signal] ?? humanize(s.signal)} · {s.strength}
                          </Chip>
                          <span className="text-[12.5px] text-text-2">{s.detail}</span>
                        </li>
                      ))}
                    </ul>
                  ),
                },
                {
                  key: "status",
                  header: "Account status",
                  render: (r) => {
                    const u = dir.users.get(r.user);
                    return u ? <StatusChip status={u.status} /> : <span className="text-faint">—</span>;
                  },
                },
              ]}
            />
          </>
        )}
      </Loadable>
    </Card>
  );
}
