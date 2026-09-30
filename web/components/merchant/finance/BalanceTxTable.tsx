"use client";

import Link from "next/link";
import type { BalanceTransaction } from "@/lib/merchant/types";
import { Amount, Chip, StatusChip, Table } from "@/components/ui";
import { date, money, titleCase } from "@/lib/format";
import { SourceLink } from "./SourceLink";

export const BALANCE_TX_TYPES = [
  "payment", "refund", "dispute", "dispute_reversal", "payout", "payout_failure", "adjustment",
  "reserve_hold", "reserve_release", "transfer_to_wallet", "fee",
];

/** Balance transactions: every movement of your balance, with fee, net and when it becomes available. */
export function BalanceTxTable({ rows, empty, showPayout = true }: { rows: BalanceTransaction[]; empty: React.ReactNode; showPayout?: boolean }) {
  return (
    <Table
      rows={rows}
      rowKey={(t) => t.id}
      empty={empty}
      columns={[
        {
          key: "type", header: "Type", render: (t) => (
            <span className="flex flex-col gap-0.5">
              <span className="whitespace-nowrap text-text">{titleCase(t.type)}</span>
              <span className="whitespace-nowrap text-[12px] text-muted">{date(t.created_at, true)}</span>
            </span>
          ),
        },
        { key: "amount", header: "Amount", align: "right", render: (t) => <Amount minor={t.amount} currency={t.currency} size="sm" /> },
        { key: "fee", header: "Fee", align: "right", render: (t) => <span className="numeral whitespace-nowrap text-text-2">{t.fee ? money(-t.fee, t.currency) : "—"}</span> },
        { key: "net", header: "Net", align: "right", render: (t) => <span className="numeral whitespace-nowrap text-text">{money(t.net, t.currency)}</span> },
        {
          key: "status", header: "Status", render: (t) => (
            <span className="flex flex-wrap items-center gap-1">
              <StatusChip status={t.status} />
              {t.held_for_review && <Chip tone="peach">Held for review</Chip>}
              {t.reserve_amount > 0 && <Chip tone="neutral">{money(t.reserve_amount, t.currency)} reserved</Chip>}
            </span>
          ),
        },
        { key: "avail", header: "Available on", render: (t) => <span className="whitespace-nowrap text-text-2">{date(t.available_on)}</span> },
        { key: "source", header: "Source", render: (t) => <SourceLink type={t.source_type} id={t.source_id} /> },
        ...(showPayout
          ? [{
              key: "payout", header: "Payout", render: (t: BalanceTransaction) =>
                t.payout_id && t.type !== "payout" ? (
                  <Link href={`/payouts/${t.payout_id}`} className="whitespace-nowrap font-mono text-[12px] underline-offset-4 hover:underline">{t.payout_id}</Link>
                ) : <span className="text-faint">—</span>,
            }]
          : []),
      ]}
    />
  );
}
