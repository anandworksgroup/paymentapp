"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Amount, Button, Card, Chip, Empty, PageHeader, Stat, Table } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { qs, useAdminQuery, type Query } from "@/components/admin/data";
import { EntityLink, FilterBar, FilterInput, FilterSelect, filterClass, humanize, IdTag, Loadable, Mono, Num, PageSkeleton, SkeletonRows } from "@/components/admin/kit";
import { Guard } from "@/components/admin/shell";
import type { LedgerAccount, LedgerIntegrity, ListResponse } from "@/components/admin/types";

/** `unbalanced_transactions` rows as returned by LedgerService.VerifyIntegrity. */
type Unbalanced = { transaction_id: string; currency: string; debits: number; credits: number };

const OWNER_TYPES = [
  { value: "", label: "All owners" },
  { value: "platform", label: "Platform" },
  { value: "org", label: "Merchant (org)" },
  { value: "wallet", label: "Wallet" },
];

export default function LedgerPage() {
  return (
    <Guard perm="admin.ledger.read">
      <Ledger />
    </Guard>
  );
}

function Ledger() {
  const integrity = useAdminQuery<LedgerIntegrity>("/ledger/integrity");
  return (
    <>
      <PageHeader
        eyebrow="Finance · double-entry ledger"
        title="Ledger"
        subtitle="Integrity checks, trial balance and account balances. Balances are derived from ledger entries, never stored."
        actions={<LookupTransaction />}
      />
      <div className="space-y-5">
        <IntegrityCard q={integrity} />
        <AccountsCard />
      </div>
    </>
  );
}

function LookupTransaction() {
  const router = useRouter();
  const [id, setId] = useState("");
  const clean = id.trim();
  const valid = /^ltx_[A-Za-z0-9]+$/.test(clean);
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) router.push(`/admin/ledger/transactions/${clean}`);
      }}
    >
      <input
        aria-label="Ledger transaction id"
        value={id}
        onChange={(e) => setId(e.target.value)}
        placeholder="Look up ltx_…"
        className={`${filterClass} w-56 font-mono placeholder:font-sans placeholder:text-faint`}
      />
      <Button type="submit" size="sm" disabled={!valid}>
        Open
      </Button>
    </form>
  );
}

// ───────────────────────── Integrity ─────────────────────────

function IntegrityCard({ q }: { q: Query<LedgerIntegrity> }) {
  return (
    <Card>
      <CardHeader
        title="Integrity"
        subtitle="Every ledger transaction must balance per currency, and the audit log must form an unbroken hash chain."
        action={
          <Button size="sm" variant="soft" className="shrink-0 whitespace-nowrap" onClick={q.reload} loading={q.loading && !!q.data}>
            Re-check
          </Button>
        }
      />
      <Loadable q={q} skeleton={<PageSkeleton />}>
        {(d) => {
          const unbalanced = (d.ledger.unbalanced_transactions ?? []) as Unbalanced[];
          return (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Stat
                  label="Ledger"
                  chip={d.ledger.balanced ? <Chip tone="sage">Ledger balanced</Chip> : <Chip tone="rose">Unbalanced</Chip>}
                >
                  <Num value={d.ledger.transactions_checked} suffix="transactions checked" />
                </Stat>
                <Stat
                  label="Audit log"
                  chip={
                    d.audit_chain.valid ? (
                      <Chip tone="sage">Audit hash chain valid</Chip>
                    ) : (
                      <Chip tone="rose">Broken at seq {d.audit_chain.broken_at_seq ?? "?"}</Chip>
                    )
                  }
                >
                  <Num value={d.audit_chain.rows_checked} suffix="rows checked" />
                </Stat>
              </div>

              {unbalanced.length > 0 && (
                <div className="rounded-inner bg-rose-soft p-4 text-[13px] text-rose-ink">
                  <div className="mb-2 font-medium">{unbalanced.length} transaction(s) do not balance. These need review by finance.</div>
                  <ul className="space-y-1">
                    {unbalanced.map((u) => (
                      <li key={`${u.transaction_id}-${u.currency}`} className="flex flex-wrap items-center gap-3">
                        <EntityLink type="ledger_transaction" id={u.transaction_id} />
                        <span>
                          {u.currency}: debits {u.debits.toLocaleString("en-US")} / credits {u.credits.toLocaleString("en-US")} (minor units)
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="mb-2 text-[13px] text-muted">Trial balance by currency</div>
                <Table
                  rows={d.ledger.trial_balance}
                  rowKey={(r) => r.currency}
                  empty={<Empty title="No ledger entries yet" />}
                  columns={[
                    { key: "currency", header: "Currency", render: (r) => <span className="font-medium text-text">{r.currency}</span> },
                    { key: "debits", header: "Debits", align: "right", render: (r) => <Amount minor={r.debits} currency={r.currency} size="sm" /> },
                    { key: "credits", header: "Credits", align: "right", render: (r) => <Amount minor={r.credits} currency={r.currency} size="sm" /> },
                    {
                      key: "diff",
                      header: "Difference",
                      align: "right",
                      render: (r) =>
                        r.debits === r.credits ? (
                          <Chip tone="sage">Balanced</Chip>
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            <Amount minor={r.debits - r.credits} currency={r.currency} size="sm" className="text-rose-ink" />
                            <Chip tone="rose">Off</Chip>
                          </span>
                        ),
                    },
                  ]}
                />
              </div>
            </div>
          );
        }}
      </Loadable>
    </Card>
  );
}

// ───────────────────────── Accounts ─────────────────────────

function AccountsCard() {
  const [ownerType, setOwnerType] = useState("");
  const [ownerInput, setOwnerInput] = useState("");
  const [owner, setOwner] = useState("");
  const q = useAdminQuery<ListResponse<LedgerAccount>>(`/ledger/accounts${qs({ owner_type: ownerType, owner })}`);

  return (
    <Card>
      <CardHeader title="Accounts" subtitle="Up to 500 accounts, ordered by owner type and code. Balances are computed from entries at request time." />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setOwner(ownerInput.trim());
        }}
      >
        <FilterBar>
          <FilterSelect label="Owner type" value={ownerType} onChange={setOwnerType} options={OWNER_TYPES} />
          <FilterInput label="Owner id" value={ownerInput} onChange={setOwnerInput} placeholder="org_… or wal_…" width="w-60" />
          <Button type="submit" size="sm" variant="soft">
            Apply
          </Button>
          {(owner || ownerType) && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setOwnerType("");
                setOwnerInput("");
                setOwner("");
              }}
            >
              Clear
            </Button>
          )}
        </FilterBar>
      </form>
      <Loadable q={q} skeleton={<SkeletonRows rows={8} />}>
        {(list) => (
          <>
            <div className="mb-2 text-[12.5px] text-muted">
              {list.data.length} account{list.data.length === 1 ? "" : "s"}
              {list.data.length >= 500 ? " (limit reached, narrow the filters to see more)" : ""}
            </div>
            <Table
              rows={list.data}
              rowKey={(r) => r.id}
              empty={<Empty title="No accounts match">Try another owner type or clear the owner id.</Empty>}
              columns={[
                { key: "owner", header: "Owner", render: (r) => <Owner type={r.owner_type} id={r.owner_id} /> },
                {
                  key: "code",
                  header: "Code",
                  render: (r) => (
                    <div>
                      <Mono className="text-text">{r.code}</Mono>
                      <div>
                        <IdTag id={r.id} />
                      </div>
                    </div>
                  ),
                },
                { key: "kind", header: "Kind", render: (r) => <span className="text-text-2">{humanize(r.kind)}</span> },
                { key: "currency", header: "Currency", render: (r) => r.currency },
                { key: "mode", header: "Mode", render: (r) => (r.livemode ? <Chip tone="ink">Live</Chip> : <Chip tone="lemon">Test</Chip>) },
                { key: "balance", header: "Balance", align: "right", render: (r) => <Amount minor={r.balance} currency={r.currency} size="sm" /> },
              ]}
            />
          </>
        )}
      </Loadable>
    </Card>
  );
}

function Owner({ type, id }: { type: string; id: string | null }) {
  if (type === "platform") return <span className="text-text">Platform</span>;
  if (type === "org")
    return (
      <div>
        <div className="text-[11.5px] text-muted">Merchant</div>
        <EntityLink type="org" id={id} />
      </div>
    );
  if (type === "wallet")
    return (
      <div>
        <div className="text-[11.5px] text-muted">Wallet</div>
        <IdTag id={id} />
      </div>
    );
  return (
    <div>
      <div className="text-[11.5px] text-muted">{humanize(type)}</div>
      {id?.startsWith("usr_") ? <EntityLink type="user" id={id} /> : <IdTag id={id} />}
    </div>
  );
}
