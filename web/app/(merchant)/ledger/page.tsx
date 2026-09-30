"use client";

import { useState } from "react";
import { date, money, titleCase } from "@/lib/format";
import { useApi, qs } from "@/lib/merchant/hooks";
import { Amount, Card, CardHeader, Chip, Empty, PageHeader, Skeleton, Table, cx } from "@/components/ui";
import { useMerchant } from "@/components/merchant/context";
import { FilterBar, FilterSelect, ListSkeleton, Loaded, NoAccess } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { SourceLink } from "@/components/merchant/finance/SourceLink";
import type { LedgerAccount, LedgerEntry } from "@/components/merchant/finance/types";

const ACCOUNT_HELP: Record<string, string> = {
  merchant_available: "Settled funds you can pay out.",
  merchant_pending: "Payments that are still settling.",
  merchant_reserve: "Rolling reserve held back from settled funds.",
};

export default function LedgerPage() {
  const { can } = useMerchant();
  const allowed = can("ledger.read");
  const [account, setAccount] = useState("");
  const [limit, setLimit] = useState("100");
  const accounts = useApi<{ data: LedgerAccount[] }>(allowed ? "/v1/ledger/accounts" : null);
  const entries = useApi<{ data: LedgerEntry[] }>(allowed ? `/v1/ledger/entries${qs({ account, limit })}` : null);

  if (!allowed) return <NoAccess what="the ledger" />;
  const selected = accounts.data?.data.find((a) => a.id === account);

  return (
    <>
      <PageHeader title="Ledger" subtitle="The double-entry record behind your balance. Every movement is a balanced set of debits and credits." />

      <section aria-label="Ledger accounts" className="mb-5">
        <Loaded
          data={accounts.data}
          error={accounts.error}
          onRetry={accounts.reload}
          skeleton={<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-card" />)}</div>}
        >
          {(a) =>
            a.data.length ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {a.data.map((acc) => {
                  const active = acc.id === account;
                  return (
                    <button
                      key={acc.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setAccount(active ? "" : acc.id)}
                      className={cx("flex min-h-36 flex-col rounded-card p-5 text-left shadow-card transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sage-100", active ? "sage-gradient" : "bg-surface hover:bg-surface-2")}
                    >
                      <span className="flex w-full items-start justify-between gap-2">
                        <span className="text-[13px] text-text-2">{titleCase(acc.code)}</span>
                        <Chip tone={active ? "ink" : "neutral"}>{acc.kind}</Chip>
                      </span>
                      <span className="mt-auto pt-4"><Amount minor={acc.balance} currency={acc.currency} size="md" /></span>
                      <span className="mt-1 text-[12px] text-muted">{ACCOUNT_HELP[acc.code] ?? acc.code}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <Card><Empty title="No ledger accounts yet" icon={<Icon name="book" />}>Accounts are opened automatically with your first payment.</Empty></Card>
            )
          }
        </Loaded>
      </section>

      <Card>
        <CardHeader
          title={selected ? `Entries · ${titleCase(selected.code)} ${selected.currency}` : "All entries"}
          subtitle={selected ? "Click the account card again to show every account." : "Newest first. Click an account above to filter."}
        />
        <FilterBar>
          {selected && (
            <button onClick={() => setAccount("")} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-lemon-soft px-3.5 text-[12.5px] text-lemon-ink">
              {titleCase(selected.code)} {selected.currency} <Icon name="close" size={13} /><span className="sr-only">Clear account filter</span>
            </button>
          )}
          <FilterSelect label="Number of entries" value={limit} onChange={setLimit} options={["50", "100", "250", "500"].map((n) => ({ value: n, label: `Latest ${n}` }))} />
        </FilterBar>
        <Loaded data={entries.data} error={entries.error} onRetry={entries.reload} skeleton={<ListSkeleton />}>
          {(e) => (
            <Table
              rows={e.data}
              rowKey={(x) => x.id}
              empty={<Empty title="No entries">Nothing has been posted{selected ? " to this account" : ""} yet.</Empty>}
              columns={[
                { key: "date", header: "Date", render: (x) => <span className="whitespace-nowrap text-muted">{date(x.created_at, true)}</span> },
                {
                  key: "desc", header: "Description", render: (x) => (
                    <span className="flex min-w-[180px] flex-col">
                      <span className="text-text">{titleCase(x.type)}</span>
                      <span className="text-[12px] text-muted">{x.description}</span>
                    </span>
                  ),
                },
                { key: "account", header: "Account", render: (x) => <span className="whitespace-nowrap font-mono text-[12px] text-text-2">{x.account}</span> },
                { key: "debit", header: "Debit", align: "right", render: (x) => <span className="numeral whitespace-nowrap">{x.direction === "D" ? money(x.amount, x.currency) : ""}</span> },
                { key: "credit", header: "Credit", align: "right", render: (x) => <span className="numeral whitespace-nowrap">{x.direction === "C" ? money(x.amount, x.currency) : ""}</span> },
                { key: "source", header: "Source", render: (x) => <SourceLink type={x.source_type} id={x.source_id} /> },
              ]}
            />
          )}
        </Loaded>
        <p className="mt-4 text-[12px] text-muted">
          Your accounts are liabilities of the platform to you: a credit increases what you are owed, a debit decreases it.
        </p>
      </Card>
    </>
  );
}
