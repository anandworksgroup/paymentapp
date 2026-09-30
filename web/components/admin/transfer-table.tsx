"use client";

import { useRouter } from "next/navigation";
import { Amount, Chip, Empty, StatusChip, Table } from "@/components/ui";
import { money } from "@/lib/format";
import { Country, IdTag, When, WalletRef, humanize } from "./kit";
import type { Transfer } from "./types";

/** Transfers table shared by the Transactions list and profile pages. `walletId` marks direction. */
export function TransferTable({ rows, walletId, empty }: { rows: Transfer[]; walletId?: string | null; empty?: string }) {
  const router = useRouter();
  return (
    <Table
      rows={rows}
      rowKey={(r) => r.id}
      onRowClick={(r) => router.push(`/admin/transactions/${r.id}`)}
      empty={<Empty title={empty ?? "No transfers"} />}
      columns={[
        { key: "at", header: "Created", render: (r) => <When at={r.created_at} /> },
        {
          key: "type",
          header: "Type",
          render: (r) => (
            <span className="inline-flex items-center gap-1.5">
              {humanize(r.type)}
              {walletId && <Chip tone={r.sender_wallet_id === walletId ? "peach" : "sage"}>{r.sender_wallet_id === walletId ? "out" : "in"}</Chip>}
            </span>
          ),
        },
        {
          key: "from",
          header: "From",
          render: (r) =>
            r.sender_wallet_id ? <WalletRef id={r.sender_wallet_id} /> : <span className="text-text-2">{r.funding_source ? humanize(r.funding_source) : r.source_org_id ? "Merchant" : "External"}</span>,
        },
        {
          key: "to",
          header: "To",
          render: (r) =>
            r.recipient_wallet_id ? <WalletRef id={r.recipient_wallet_id} /> : r.bank_account_id ? <span className="text-text-2">Bank account</span> : <span className="text-text-2">External</span>,
        },
        {
          key: "route",
          header: "Route",
          render: (r) => (
            <span className="inline-flex items-center gap-1 text-[12.5px]">
              <Country code={r.sender_country} /> <span className="text-faint">→</span> <Country code={r.recipient_country} />
            </span>
          ),
        },
        {
          key: "amt",
          header: "Amount",
          align: "right",
          render: (r) => (
            <div className="flex flex-col items-end">
              <Amount minor={r.source_amount} currency={r.source_currency} size="sm" />
              {r.destination_currency !== r.source_currency && <span className="text-[11.5px] text-muted">→ {money(r.destination_amount, r.destination_currency, { code: true })}</span>}
            </div>
          ),
        },
        { key: "status", header: "Status", render: (r) => <StatusChip status={r.status} /> },
        { key: "id", header: "ID", render: (r) => <IdTag id={r.id} /> },
      ]}
    />
  );
}
