"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { download } from "@/lib/api";
import { useCursorList, useDebounced, qs } from "@/lib/merchant/hooks";
import type { Payment } from "@/lib/merchant/types";
import { Amount, Button, Card, Chip, Empty, PageHeader, StatusChip, Table } from "@/components/ui";
import { date, flag, titleCase } from "@/lib/format";
import { useMerchant, useToast } from "@/components/merchant/context";
import { FilterBar, FilterSelect, Loaded, ListSkeleton, NoAccess, Pager, SearchBox } from "@/components/merchant/common";
import { useCountries } from "@/components/merchant/useMeta";
import { Icon } from "@/components/merchant/icons";

const STATUSES = ["SUCCEEDED", "PROCESSING", "REQUIRES_ACTION", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED", "DISPUTED", "CHARGEBACK", "CANCELLED"];

export default function PaymentsPage() {
  const { can } = useMerchant();
  const router = useRouter();
  const params = useSearchParams();
  const countries = useCountries();
  const toast = useToast();
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [country, setCountry] = useState(params.get("country") ?? "");
  const [method, setMethod] = useState(params.get("method") ?? "");
  const [review, setReview] = useState(params.get("review") ?? "");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const term = useDebounced(search.trim(), 350);
  const filters = { status, country, method, review, search: term.length > 2 ? term : "" };
  const list = useCursorList<Payment>(can("payments.read") ? `/v1/payments${qs(filters)}` : null);

  const update = (k: string, v: string, set: (v: string) => void) => {
    set(v);
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`/payments${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };

  if (!can("payments.read")) return <NoAccess what="payments" />;
  const filtered = !!(status || country || method || review || filters.search);

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Every charge attempt, with its status, risk and fees."
        actions={
          can("reports.read") && (
            <Button variant="soft" icon={<Icon name="download" size={16} />} onClick={() => download("/v1/reports/payments.csv", "payments.csv").catch(() => toast("Export failed", "error"))}>
              Export CSV
            </Button>
          )
        }
      />
      <Card>
        <FilterBar>
          <SearchBox value={search} onChange={setSearch} placeholder="Payment id, email, last 4, order id" label="Search payments" />
          <FilterSelect label="Status" value={status} onChange={(v) => update("status", v, setStatus)} options={[{ value: "", label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: titleCase(s) }))]} />
          <FilterSelect label="Country" value={country} onChange={(v) => update("country", v, setCountry)} options={[{ value: "", label: "All countries" }, ...countries.map((c) => ({ value: c.country, label: `${flag(c.country)} ${c.name}` }))]} />
          <FilterSelect label="Method" value={method} onChange={(v) => update("method", v, setMethod)} options={[{ value: "", label: "All methods" }, { value: "card", label: "Card" }, { value: "upi", label: "UPI" }]} />
          {review && (
            <button onClick={() => update("review", "", setReview)} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-lemon-soft px-3.5 text-[12.5px] text-lemon-ink">
              Held for review <Icon name="close" size={13} />
            </button>
          )}
        </FilterBar>
        <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton />}>
          {() => (
            <>
              <Table
                rows={list.rows}
                rowKey={(p) => p.id}
                onRowClick={(p) => router.push(`/payments/${p.id}`)}
                empty={
                  <Empty title={filtered ? "No payments match these filters" : "No payments yet"}>
                    {filtered ? "Try clearing a filter." : "Payments appear here as soon as a customer pays through checkout, a payment link or an invoice."}
                  </Empty>
                }
                columns={[
                  { key: "amount", header: "Amount", render: (p) => <Amount minor={p.amount} currency={p.currency} size="sm" /> },
                  { key: "status", header: "Status", render: (p) => (
                    <span className="flex flex-wrap items-center gap-1">
                      <StatusChip status={p.status} />
                      {p.review_status === "pending" && <Chip tone="peach">In review</Chip>}
                    </span>
                  ) },
                  { key: "customer", header: "Customer", render: (p) => <span className="block max-w-[220px] truncate text-text-2">{p.customer_email ?? "—"}</span> },
                  { key: "method", header: "Method", render: (p) => <span className="whitespace-nowrap text-text-2">{p.payment_method_type === "upi" ? "UPI" : titleCase(p.card_brand ?? p.payment_method_type ?? "—")}{p.last4 ? ` •••• ${p.last4}` : ""}</span> },
                  { key: "country", header: "Country", render: (p) => <span className="whitespace-nowrap">{flag(p.country)} {p.country ?? ""}</span> },
                  { key: "date", header: "Date", align: "right", render: (p) => <span className="whitespace-nowrap text-muted">{date(p.created_at, true)}</span> },
                ]}
              />
              <Pager page={list.page} hasPrev={list.hasPrev} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
            </>
          )}
        </Loaded>
      </Card>
    </>
  );
}
