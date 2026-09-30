"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Amount, Button, Card, Empty, PageHeader, StatusChip, Table } from "@/components/ui";
import { qs, usePagedList } from "@/components/admin/data";
import { Country, EntityLink, FilterBar, FilterInput, FilterSelect, IdTag, Loadable, Pager, Tabs, When, humanize } from "@/components/admin/kit";
import { maskEmail } from "@/components/admin/mask";
import { Guard } from "@/components/admin/shell";
import { TransferTable } from "@/components/admin/transfer-table";
import type { Payment, Transfer } from "@/components/admin/types";

const T_STATUS = ["", "HELD", "SCREENING", "PROCESSING", "COMPLETED", "RETURNED", "CANCELLED", "FAILED", "CREATED"];
const T_TYPE = ["", "internal", "funding", "withdrawal", "merchant_proceeds"];
const P_STATUS = ["", "SUCCEEDED", "PROCESSING", "REQUIRES_ACTION", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED", "DISPUTED", "CANCELED"];
const opt = (list: string[], all: string) => list.map((s) => ({ value: s, label: s ? humanize(s) : all }));

export default function TransactionsPage() {
  return (
    <Guard perm="admin.transactions.read">
      <Transactions />
    </Guard>
  );
}

function Transactions() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get("tab") === "payments" ? "payments" : "transfers";
  return (
    <>
      <PageHeader
        eyebrow="Money movement"
        title="Transactions"
        subtitle="Wallet transfers (funding, sends, withdrawals) and merchant card/UPI payments across every tenant."
      />
      <Tabs
        value={tab}
        onChange={(t) => router.replace(t === "payments" ? "/admin/transactions?tab=payments" : "/admin/transactions", { scroll: false })}
        tabs={[
          { value: "transfers", label: "Wallet transfers" },
          { value: "payments", label: "Merchant payments" },
        ]}
      />
      {tab === "transfers" ? <Transfers initialStatus={params.get("status") ?? ""} initialWallet={params.get("wallet") ?? ""} initialFrom={params.get("from_country") ?? ""} initialTo={params.get("to_country") ?? ""} /> : <Payments />}
    </>
  );
}

function Transfers({ initialStatus, initialWallet, initialFrom, initialTo }: { initialStatus: string; initialWallet: string; initialFrom: string; initialTo: string }) {
  const [status, setStatus] = useState(initialStatus);
  const [type, setType] = useState("");
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [wallet, setWallet] = useState(initialWallet);
  const [bank, setBank] = useState("");
  const list = usePagedList<Transfer>(
    `/transfers${qs({ status, type, from_country: from.length === 2 ? from.toUpperCase() : "", to_country: to.length === 2 ? to.toUpperCase() : "", wallet: wallet.trim(), bank_account: bank.trim() })}`,
    50,
  );
  const filtered = status || type || from || to || wallet || bank;
  return (
    <Card>
      <FilterBar>
        <FilterSelect label="Status" value={status} onChange={setStatus} options={opt(T_STATUS, "All statuses")} />
        <FilterSelect label="Type" value={type} onChange={setType} options={opt(T_TYPE, "All types")} />
        <FilterInput label="From country" value={from} onChange={setFrom} placeholder="US" width="w-24" />
        <FilterInput label="To country" value={to} onChange={setTo} placeholder="GB" width="w-24" />
        <FilterInput label="Wallet id" value={wallet} onChange={setWallet} placeholder="wal_…" width="w-48" />
        <FilterInput label="Bank account id" value={bank} onChange={setBank} placeholder="ba_…" width="w-48" />
        {filtered && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setStatus("");
              setType("");
              setFrom("");
              setTo("");
              setWallet("");
              setBank("");
            }}
          >
            Clear
          </Button>
        )}
      </FilterBar>
      <Loadable q={list}>
        {() => (
          <>
            <TransferTable rows={list.rows} empty="No transfers match these filters" />
            <Pager page={list.page} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
          </>
        )}
      </Loadable>
    </Card>
  );
}

function Payments() {
  const [status, setStatus] = useState("");
  const [org, setOrg] = useState("");
  const list = usePagedList<Payment>(`/payments${qs({ status, org: org.trim() })}`, 50);
  return (
    <Card>
      <FilterBar>
        <FilterSelect label="Status" value={status} onChange={setStatus} options={opt(P_STATUS, "All statuses")} />
        <FilterInput label="Merchant (org id)" value={org} onChange={setOrg} placeholder="org_…" width="w-56" />
      </FilterBar>
      <Loadable q={list}>
        {() => (
          <>
            <Table
              rows={list.rows}
              rowKey={(r) => r.id}
              empty={<Empty title="No payments match" />}
              columns={[
                { key: "at", header: "Created", render: (r) => <When at={r.created_at} /> },
                { key: "m", header: "Merchant", render: (r) => <EntityLink type="org" id={r.org_id} /> },
                { key: "d", header: "Description", render: (r) => <span className="text-text-2">{r.description ?? "—"}</span> },
                { key: "c", header: "Customer", render: (r) => <span className="text-[12.5px] text-muted">{maskEmail(r.customer_email)}</span> },
                {
                  key: "pm",
                  header: "Method",
                  render: (r) => (
                    <span className="text-text-2">
                      {r.card_brand ? `${humanize(r.card_brand)} •••• ${r.last4}` : humanize(r.payment_method_type)} {r.country && <Country code={r.country} />}
                    </span>
                  ),
                },
                { key: "amt", header: "Amount", align: "right", render: (r) => <Amount minor={r.amount} currency={r.currency} size="sm" /> },
                { key: "s", header: "Status", render: (r) => <StatusChip status={r.status} /> },
                { key: "r", header: "Risk", render: (r) => <span className="text-[12.5px] text-text-2">{r.risk_score} · {humanize(r.risk_action)}</span> },
                { key: "mode", header: "Mode", render: (r) => <StatusChip status={r.livemode ? "live" : "test"} /> },
                { key: "id", header: "ID", render: (r) => <IdTag id={r.id} /> },
              ]}
            />
            <Pager page={list.page} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
          </>
        )}
      </Loadable>
    </Card>
  );
}
