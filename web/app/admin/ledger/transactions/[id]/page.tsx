"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ReactNode } from "react";
import { Amount, Card, Chip, Empty, PageHeader, Table } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { useAdminQuery } from "@/components/admin/data";
import { EntityLink, humanize, IdTag, KV, Loadable, Mono, PageSkeleton, Person, When } from "@/components/admin/kit";
import { Guard } from "@/components/admin/shell";
import type { LedgerTransaction, LedgerTransactionDetail } from "@/components/admin/types";

type Entry = LedgerTransactionDetail["entries"][number];

/** The API stores directions as "D"/"C"; accept the long form too. */
function isDebit(e: Entry) {
  const d = e.direction.toUpperCase();
  return d === "D" || d === "DEBIT";
}

export default function LedgerTransactionPage() {
  return (
    <Guard perm="admin.ledger.read">
      <LedgerTransactionBody />
    </Guard>
  );
}

function LedgerTransactionBody() {
  const { id } = useParams<{ id: string }>();
  const q = useAdminQuery<LedgerTransactionDetail>(`/ledger/transactions/${encodeURIComponent(id)}`);

  return (
    <>
      <div className="mb-3 text-[13px]">
        <Link href="/admin/ledger" className="text-muted hover:text-text">
          ← Ledger
        </Link>
      </div>
      <Loadable q={q} skeleton={<PageSkeleton />}>
        {(d) => <Detail d={d} />}
      </Loadable>
    </>
  );
}

function Detail({ d }: { d: LedgerTransactionDetail }) {
  const t = d.transaction;
  const totals = new Map<string, { debits: number; credits: number }>();
  for (const e of d.entries) {
    const cur = totals.get(e.currency) ?? { debits: 0, credits: 0 };
    if (isDebit(e)) cur.debits += e.amount;
    else cur.credits += e.amount;
    totals.set(e.currency, cur);
  }
  const balances = [...totals.entries()].map(([currency, v]) => ({ currency, ...v }));
  const allBalanced = balances.every((b) => b.debits === b.credits);

  return (
    <>
      <PageHeader
        eyebrow="Ledger transaction"
        title={humanize(t.type)}
        subtitle={t.description}
        actions={
          <>
            {t.livemode ? <Chip tone="ink">Live</Chip> : <Chip tone="lemon">Test</Chip>}
            {allBalanced ? <Chip tone="sage">Balanced</Chip> : <Chip tone="rose">Unbalanced</Chip>}
            {t.reverses_transaction_id && <Chip tone="peach">Reversal</Chip>}
          </>
        }
      />
      <div className="space-y-5">
        <Card>
          <CardHeader title="Details" subtitle="Ledger transactions are immutable. Corrections are posted as new, linked transactions." />
          <KV
            cols={3}
            items={[
              ["Transaction id", <IdTag key="id" id={t.id} full />],
              ["Type", <Mono key="type">{t.type}</Mono>],
              ["Merchant", t.org_id ? <EntityLink key="org" type="org" id={t.org_id} /> : <span key="org" className="text-muted">Platform / wallet</span>],
              ["Source", <Source key="src" type={t.source_type} id={t.source_id} />],
              ["Posting key", <Mono key="pk">{t.posting_key}</Mono>],
              ["Effective at", <When key="eff" at={t.effective_at} />],
              ["Recorded at", <When key="rec" at={t.created_at} />],
              ["Actor", <Person key="actor" id={t.actor_id} />],
              ["Request id", t.request_id ? <Mono key="req">{t.request_id}</Mono> : null],
              ["Parent transaction", t.parent_transaction_id ? <EntityLink key="parent" type="ledger_transaction" id={t.parent_transaction_id} /> : null],
              ["Reverses", t.reverses_transaction_id ? <EntityLink key="rev" type="ledger_transaction" id={t.reverses_transaction_id} /> : null],
            ]}
          />
        </Card>

        <Card>
          <CardHeader title="Entries" subtitle={`${d.entries.length} entr${d.entries.length === 1 ? "y" : "ies"}. Debits must equal credits in each currency.`} />
          <Table
            rows={d.entries}
            rowKey={(e) => e.id}
            empty={<Empty title="No entries">This transaction has no entries, which should not happen. Report it to engineering.</Empty>}
            columns={[
              {
                key: "account",
                header: "Account",
                render: (e) => (
                  <div>
                    <Mono className="text-text">{e.account.code}</Mono>
                    <div className="text-[11.5px] text-muted">
                      {humanize(e.account.kind)} · <IdTag id={e.account.id} />
                    </div>
                  </div>
                ),
              },
              { key: "owner", header: "Owner", render: (e) => <AccountOwner type={e.account.owner_type} id={e.account.owner_id} /> },
              { key: "debit", header: "Debit", align: "right", render: (e) => (isDebit(e) ? <Amount minor={e.amount} currency={e.currency} size="sm" /> : <span className="text-faint">—</span>) },
              { key: "credit", header: "Credit", align: "right", render: (e) => (!isDebit(e) ? <Amount minor={e.amount} currency={e.currency} size="sm" /> : <span className="text-faint">—</span>) },
            ]}
          />
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {balances.map((b) => (
              <div key={b.currency} className="flex items-center justify-between gap-3 rounded-inner bg-surface-2 px-4 py-3 text-[13px]">
                <div>
                  <div className="font-medium text-text">{b.currency}</div>
                  <div className="text-muted">
                    Dr <Amount minor={b.debits} currency={b.currency} size="sm" showCode={false} className="text-[13px]" /> · Cr{" "}
                    <Amount minor={b.credits} currency={b.currency} size="sm" showCode={false} className="text-[13px]" />
                  </div>
                </div>
                {b.debits === b.credits ? <Chip tone="sage">Balanced</Chip> : <Chip tone="rose">Off by {Math.abs(b.debits - b.credits).toLocaleString("en-US")}</Chip>}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Linked transactions" subtitle="Follow-on postings (settlement, returns) and reversals that point at this transaction." />
          <Table<LedgerTransaction>
            rows={d.children}
            rowKey={(c) => c.id}
            empty={<p className="text-[13px] text-muted">No follow-on or reversing transactions.</p>}
            columns={[
              { key: "id", header: "Transaction", render: (c) => <EntityLink type="ledger_transaction" id={c.id} /> },
              {
                key: "rel",
                header: "Relation",
                render: (c) => (c.reverses_transaction_id === t.id ? <Chip tone="peach">Reverses this</Chip> : <Chip tone="neutral">Child</Chip>),
              },
              { key: "type", header: "Type", render: (c) => <Mono>{c.type}</Mono> },
              { key: "desc", header: "Description", render: (c) => <span className="text-text-2">{c.description}</span> },
              { key: "at", header: "Effective", render: (c) => <When at={c.effective_at} /> },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

function Source({ type, id }: { type: string; id: string }): ReactNode {
  let body: ReactNode;
  if (type === "transfer") body = <EntityLink type="transfer" id={id} />;
  else if (type === "payout")
    body = (
      <Link href="/admin/payouts" onClick={(e) => e.stopPropagation()} className="text-text underline decoration-line-strong underline-offset-4 hover:decoration-ink">
        <span className="font-mono text-[12px] tracking-tight">{id}</span>
      </Link>
    );
  else body = <EntityLink id={id} />;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Chip tone="neutral">{humanize(type)}</Chip>
      {body}
    </span>
  );
}

function AccountOwner({ type, id }: { type: string; id: string | null }) {
  if (type === "platform") return <span className="text-text-2">Platform</span>;
  if (type === "org") return <EntityLink type="org" id={id} />;
  if (type === "wallet")
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-[11.5px] text-muted">Wallet</span>
        <IdTag id={id} />
      </span>
    );
  return <EntityLink id={id} />;
}
