"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { useCursorList, qs } from "@/lib/merchant/hooks";
import type { Customer, Invoice } from "@/lib/merchant/types";
import { Card, Empty, PageHeader } from "@/components/ui";
import { titleCase } from "@/lib/format";
import { useMerchant } from "@/components/merchant/context";
import { FilterBar, FilterSelect, Loaded, ListSkeleton, NoAccess, Pager } from "@/components/merchant/common";
import { CustomerPicker } from "@/components/merchant/pickers";
import { Icon } from "@/components/merchant/icons";
import { InvoiceTable, LinkButton } from "@/components/merchant/billing/bits";
import { INVOICE_STATUSES } from "@/components/merchant/billing/types";

export default function InvoicesPage() {
  const { can } = useMerchant();
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const pickerId = useId();
  const list = useCursorList<Invoice>(can("invoices.read") ? `/v1/invoices${qs({ status, customer: customer?.id })}` : null);

  const changeStatus = (v: string) => {
    setStatus(v);
    const next = new URLSearchParams(params.toString());
    if (v) next.set("status", v);
    else next.delete("status");
    router.replace(`/invoices${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };

  if (!can("invoices.read")) return <NoAccess what="invoices" />;
  const filtered = !!(status || customer);

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Subscription, proration and manual B2B invoices."
        actions={can("invoices.write") && <LinkButton href="/invoices/new" variant="ink" icon={<Icon name="plus" size={16} />}>New invoice</LinkButton>}
      />
      <Card>
        <FilterBar>
          <FilterSelect
            label="Status"
            value={status}
            onChange={changeStatus}
            options={[{ value: "", label: "All statuses" }, ...INVOICE_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))]}
          />
          <div className="w-full min-w-0 sm:w-72">
            <label htmlFor={pickerId} className="sr-only">Filter by customer</label>
            <CustomerPicker id={pickerId} value={customer} onChange={setCustomer} />
          </div>
        </FilterBar>
        <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton />}>
          {() => (
            <>
              <InvoiceTable
                rows={list.rows}
                showCustomer
                empty={
                  <Empty title={filtered ? "No invoices match these filters" : "No invoices yet"} icon={<Icon name="invoice" />}>
                    {filtered ? "Try clearing a filter." : "Invoices are created by subscriptions, or you can issue a manual invoice with net terms."}
                  </Empty>
                }
              />
              <Pager page={list.page} hasPrev={list.hasPrev} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
            </>
          )}
        </Loaded>
      </Card>
    </>
  );
}
