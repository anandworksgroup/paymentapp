"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { useCursorList, qs } from "@/lib/merchant/hooks";
import type { Customer } from "@/lib/merchant/types";
import { Card, Empty, PageHeader } from "@/components/ui";
import { titleCase } from "@/lib/format";
import { useMerchant } from "@/components/merchant/context";
import { FilterBar, FilterSelect, Loaded, ListSkeleton, NoAccess, Pager } from "@/components/merchant/common";
import { CustomerPicker } from "@/components/merchant/pickers";
import { Icon } from "@/components/merchant/icons";
import { SubscriptionTable } from "@/components/merchant/billing/bits";
import { SUBSCRIPTION_STATUSES, type SubscriptionFull } from "@/components/merchant/billing/types";

export default function SubscriptionsPage() {
  const { can } = useMerchant();
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const pickerId = useId();
  const list = useCursorList<SubscriptionFull>(can("subscriptions.read") ? `/v1/subscriptions${qs({ status, customer: customer?.id })}` : null);

  const changeStatus = (v: string) => {
    setStatus(v);
    const next = new URLSearchParams(params.toString());
    if (v) next.set("status", v);
    else next.delete("status");
    router.replace(`/subscriptions${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };

  if (!can("subscriptions.read")) return <NoAccess what="subscriptions" />;
  const filtered = !!(status || customer);

  return (
    <>
      <PageHeader title="Subscriptions" subtitle="Recurring plans, their current period and collection state." />
      <Card>
        <FilterBar>
          <FilterSelect
            label="Status"
            value={status}
            onChange={changeStatus}
            options={[{ value: "", label: "All statuses" }, ...SUBSCRIPTION_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))]}
          />
          <div className="w-full min-w-0 sm:w-72">
            <label htmlFor={pickerId} className="sr-only">Filter by customer</label>
            <CustomerPicker id={pickerId} value={customer} onChange={setCustomer} />
          </div>
        </FilterBar>
        <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton />}>
          {() => (
            <>
              <SubscriptionTable
                rows={list.rows}
                customerLabel={(s) => (
                  <Link href={`/customers/${s.customer_id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[12px] text-text-2 underline-offset-4 hover:underline">
                    {s.customer_id}
                  </Link>
                )}
                empty={
                  <Empty title={filtered ? "No subscriptions match these filters" : "No subscriptions yet"} icon={<Icon name="repeat" />}>
                    {filtered ? "Try clearing a filter." : "Subscriptions start when a customer checks out with a recurring price."}
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
