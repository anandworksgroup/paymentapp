"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { useApi, useDebounced } from "@/lib/merchant/hooks";
import type { Customer } from "@/lib/merchant/types";
import { Card, CardHeader, Chip, Empty, Input, PageHeader, Skeleton, Table, cx } from "@/components/ui";
import { date, titleCase } from "@/lib/format";
import { useMerchant } from "@/components/merchant/context";
import { Loaded, ListSkeleton, NoAccess } from "@/components/merchant/common";
import { CustomerPicker } from "@/components/merchant/pickers";
import { Icon } from "@/components/merchant/icons";
import { Count } from "@/components/merchant/billing/bits";
import { CreditOperationForm } from "@/components/merchant/billing/CreditOperationForm";
import type { CreditBalance, CustomerDetail } from "@/components/merchant/billing/types";

export default function CreditsPage() {
  const { can } = useMerchant();
  const params = useSearchParams();
  const preId = params.get("customer");
  const pre = useApi<CustomerDetail>(preId && can("customers.read") ? `/v1/customers/${preId}` : null);
  const [picked, setPicked] = useState<Customer | null | undefined>(undefined);
  const customer = picked !== undefined ? picked : pre.data?.customer ?? null;
  const customerId = picked !== undefined ? picked?.id ?? null : preId;
  const [typeInput, setTypeInput] = useState("credits");
  const creditType = useDebounced(typeInput.trim() || "credits", 400);
  const pickerId = useId();
  const typeId = useId();
  const bal = useApi<CreditBalance>(can("credits.read") && customerId ? `/v1/credits/${encodeURIComponent(customerId)}?credit_type=${encodeURIComponent(creditType)}` : null);

  if (!can("credits.read")) return <NoAccess what="credits" />;

  return (
    <>
      <PageHeader title="Credits" subtitle="Prepaid credit balances and every movement on the credit ledger." />

      <Card className="mb-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <label htmlFor={pickerId} className="mb-1.5 block text-[12.5px] font-medium text-text-2">Customer</label>
            {preId && pre.loading && picked === undefined ? <Skeleton className="h-11" /> : <CustomerPicker id={pickerId} value={customer} onChange={setPicked} />}
          </div>
          <div className="min-w-0">
            <label htmlFor={typeId} className="mb-1.5 block text-[12.5px] font-medium text-text-2">Credit type</label>
            <Input id={typeId} value={typeInput} onChange={(e) => setTypeInput(e.target.value)} placeholder="credits" />
          </div>
        </div>
        {customerId && (
          <p className="mt-3 text-[12.5px] text-muted">
            Viewing <Link href={`/customers/${customerId}`} className="text-text-2 underline-offset-4 hover:underline">{customer ? customer.name ?? customer.email ?? customer.id : customerId}</Link>
          </p>
        )}
      </Card>

      {!customerId ? (
        <Card>
          <Empty title="Choose a customer" icon={<Icon name="coins" />}>Pick a customer to see their credit balance and ledger, and to issue or consume credits.</Empty>
        </Card>
      ) : (
        <Loaded
          data={bal.data}
          error={bal.error}
          onRetry={bal.reload}
          skeleton={<div className="space-y-4"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-36 rounded-card" />)}</div><ListSkeleton /></div>}
        >
          {(b) => (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className="min-w-0 space-y-5">
                <section aria-label="Balance" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <BalanceCard label="Available" value={b.available} unit={b.credit_type} tone="sage" />
                  <BalanceCard label="Reserved" value={b.reserved} unit={b.credit_type} note="Held by open reservations" />
                </section>
                <Card>
                  <CardHeader title="Ledger" subtitle="Latest 50 entries, newest first" />
                  <Table
                    rows={b.entries}
                    rowKey={(e) => e.id}
                    empty={<Empty title="No credit movements yet">Credits are issued when a customer buys a credit pack, or you can issue them here.</Empty>}
                    columns={[
                      { key: "op", header: "Operation", render: (e) => <Chip tone={e.delta > 0 ? "sage" : e.delta < 0 ? "peach" : "neutral"}>{titleCase(e.operation)}</Chip> },
                      { key: "delta", header: "Change", align: "right", render: (e) => (
                        <span className="whitespace-nowrap">
                          <span className={cx("numeral", e.delta > 0 ? "text-sage-700" : "text-text")}>{e.delta > 0 ? "+" : e.delta < 0 ? "−" : ""}{Math.abs(e.delta).toLocaleString("en-US")}</span>
                          {e.reserved_delta !== 0 && <span className="block text-[11.5px] text-muted">reserved {e.reserved_delta > 0 ? "+" : "−"}{Math.abs(e.reserved_delta).toLocaleString("en-US")}</span>}
                        </span>
                      ) },
                      { key: "bal", header: "Balance after", align: "right", render: (e) => <span className="numeral">{e.balance_after.toLocaleString("en-US")}</span> },
                      { key: "desc", header: "Description", render: (e) => (
                        <span className="block max-w-[260px]">
                          <span className="block truncate text-text-2">{e.description ?? "—"}</span>
                          {e.source_type && <span className="block text-[11.5px] text-muted">{titleCase(e.source_type)}</span>}
                        </span>
                      ) },
                      { key: "date", header: "Date", align: "right", render: (e) => <span className="whitespace-nowrap text-muted">{date(e.created_at, true)}</span> },
                    ]}
                  />
                </Card>
              </div>
              <div className="min-w-0">
                {can("credits.write") ? (
                  <Card>
                    <CardHeader title="Apply an operation" subtitle={`On ${b.credit_type} for this customer`} />
                    <CreditOperationForm key={`${b.customer}:${b.credit_type}`} customerId={b.customer} creditType={b.credit_type} onDone={bal.reload} />
                  </Card>
                ) : (
                  <Card>
                    <CardHeader title="Apply an operation" />
                    <p className="text-[13px] text-muted">Your role can view credits but not change them.</p>
                  </Card>
                )}
              </div>
            </div>
          )}
        </Loaded>
      )}
    </>
  );
}

function BalanceCard({ label, value, unit, tone, note }: { label: string; value: number; unit: string; tone?: "sage"; note?: string }) {
  return (
    <div className={cx("flex min-h-[150px] flex-col rounded-card p-6 shadow-card", tone === "sage" ? "sage-gradient" : "bg-surface")}>
      <span className="text-[13px] text-text-2">{label}</span>
      <div className="mt-auto pt-5"><Count value={value} unit={unit} size="lg" /></div>
      {note && <span className="mt-2 text-[12px] text-muted">{note}</span>}
    </div>
  );
}
