"use client";

import { useState } from "react";
import { download } from "@/lib/api";
import { date, money } from "@/lib/format";
import { qs, useAction, useApi } from "@/lib/merchant/hooks";
import { Button, Card, CardHeader, Chip, Empty, ErrorNote, Table, cx } from "@/components/ui";
import { FilterBar, FilterSelect, Help, ListSkeleton, Loaded } from "../common";
import { Icon } from "../icons";
import { SourceLink } from "../finance/SourceLink";
import { monthLabel, monthRange, recentMonths } from "./shared";
import type { Journal, JournalLine } from "./types";

const PAGE = 200;

/**
 * The merchant's double-entry journal (§99): every balance transaction as balanced debit/credit lines
 * against "Receivable from platform (MoR)", ready to map into an accounting system.
 */
export function JournalReport() {
  const [months] = useState(() => recentMonths(12));
  const [period, setPeriod] = useState("last30");
  const [shown, setShown] = useState(PAGE);
  const range = period === "last30" ? {} : monthRange(period);
  const res = useApi<Journal>(`/v1/reports/journal${qs(range)}`);
  const csv = useAction();

  const exportCsv = () =>
    csv.run(() => download(`/v1/reports/journal.csv${qs(range)}`, `journal-${period === "last30" ? "last-30-days" : period}.csv`));

  return (
    <>
      <FilterBar>
        <FilterSelect
          label="Period"
          value={period}
          onChange={(v) => { setPeriod(v); setShown(PAGE); }}
          options={[{ value: "last30", label: "Last 30 days" }, ...months.map((m, i) => ({ value: m, label: monthLabel(m) + (i === 0 ? " (to date)" : "") }))]}
        />
        <div className="ml-auto">
          <Button variant="soft" size="sm" loading={csv.busy} onClick={exportCsv} icon={<Icon name="download" size={15} />}>Download CSV</Button>
        </div>
      </FilterBar>
      {csv.error ? <div className="mb-4"><ErrorNote error={csv.error} /></div> : null}
      <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<ListSkeleton rows={8} />}>
        {(j) => (
          <div className="space-y-5">
            <Card>
              <CardHeader
                title="Trial balance"
                subtitle={`${date(j.period_start)} – ${date(j.period_end)} · ${j.lines.length} lines`}
                action={
                  j.balanced ? (
                    <Chip tone="sage"><Icon name="check" size={13} /> Every journal balances</Chip>
                  ) : (
                    <Chip tone="rose"><Icon name="alert" size={13} /> Unbalanced journal found</Chip>
                  )
                }
              />
              {j.trial_balance.length ? (
                <Table
                  rows={j.trial_balance}
                  rowKey={(r) => `${r.account}:${r.currency}`}
                  columns={[
                    { key: "a", header: "Account", render: (r) => <span className="text-text">{r.account}</span> },
                    { key: "c", header: "Currency", render: (r) => <span className="text-text-2">{r.currency}</span> },
                    { key: "d", header: "Debit", align: "right", render: (r) => <span className="numeral">{r.debit ? money(r.debit, r.currency) : ""}</span> },
                    { key: "k", header: "Credit", align: "right", render: (r) => <span className="numeral">{r.credit ? money(r.credit, r.currency) : ""}</span> },
                  ]}
                />
              ) : (
                <Empty title="No movements in this period" icon={<Icon name="book" />}>Nothing was posted to your balance between these dates.</Empty>
              )}
              <div className="mt-4"><Help>{j.format_note} Amounts exclude tax, which the platform collects and remits as Merchant of Record.</Help></div>
            </Card>

            {j.lines.length > 0 && (
              <Card>
                <CardHeader title="Journal lines" subtitle="Oldest first. Lines sharing a journal id form one balanced entry." />
                <JournalTable lines={j.lines.slice(0, shown)} />
                {j.lines.length > shown && (
                  <div className="mt-4 flex items-center justify-between gap-3 text-[12.5px] text-muted">
                    <span>Showing {shown} of {j.lines.length} lines. The CSV always has all of them.</span>
                    <Button size="sm" variant="soft" onClick={() => setShown((s) => s + PAGE)}>Show more</Button>
                  </div>
                )}
              </Card>
            )}
          </div>
        )}
      </Loaded>
    </>
  );
}

function JournalTable({ lines }: { lines: JournalLine[] }) {
  // Date and source are shown once per journal so each balanced entry reads as one group.
  const rows = lines.map((l, i) => ({ ...l, i, first: i === 0 || lines[i - 1].journal_id !== l.journal_id }));
  return (
    <Table
      rows={rows}
      rowKey={(l) => `${l.journal_id}:${l.i}`}
      columns={[
        { key: "date", header: "Date", render: (l) => (l.first ? <span className="whitespace-nowrap text-muted">{date(l.date)}</span> : null) },
        {
          key: "acct", header: "Account",
          render: (l) => (
            <span className={cx("flex min-w-[200px] flex-col", l.credit > 0 && "pl-6")}>
              <span className="text-text">{l.account}</span>
              <span className="text-[12px] text-muted">{l.memo}</span>
            </span>
          ),
        },
        { key: "d", header: "Debit", align: "right", render: (l) => <span className="numeral whitespace-nowrap">{l.debit ? money(l.debit, l.currency) : ""}</span> },
        { key: "c", header: "Credit", align: "right", render: (l) => <span className="numeral whitespace-nowrap">{l.credit ? money(l.credit, l.currency) : ""}</span> },
        { key: "cur", header: "Currency", render: (l) => <span className="text-[12px] text-muted">{l.currency}</span> },
        { key: "src", header: "Source", render: (l) => (l.first ? <SourceLink type={l.source_type} id={l.source_id} /> : null) },
      ]}
    />
  );
}
