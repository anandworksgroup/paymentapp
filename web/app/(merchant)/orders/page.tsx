"use client";

import { useRouter } from "next/navigation";
import { useCursorList } from "@/lib/merchant/hooks";
import type { Order } from "@/lib/merchant/types";
import { Amount, Card, Empty, PageHeader, StatusChip, Table } from "@/components/ui";
import { date, flag } from "@/lib/format";
import { useMerchant } from "@/components/merchant/context";
import { ListSkeleton, Loaded, NoAccess, Pager } from "@/components/merchant/common";
import { customerLabel, useCustomerNames } from "@/components/merchant/sales/lookups";
import { Icon } from "@/components/merchant/icons";

export default function OrdersPage() {
  const { can } = useMerchant();
  const router = useRouter();
  const list = useCursorList<Order>(can("payments.read") ? "/v1/orders" : null);
  const customer = useCustomerNames(list.rows.map((o) => o.customer_id), can("customers.read"));

  if (!can("payments.read")) return <NoAccess what="orders" />;

  return (
    <>
      <PageHeader title="Orders" subtitle="What each customer bought, with the tax and totals the platform charged as Merchant of Record." />
      <Card>
        <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton />}>
          {() => (
            <>
              <Table
                rows={list.rows}
                rowKey={(o) => o.id}
                onRowClick={(o) => router.push(`/orders/${o.id}`)}
                empty={
                  <Empty title="No orders yet" icon={<Icon name="bag" />}>
                    An order is created when a checkout completes — through a payment link, a hosted checkout or the API.
                  </Empty>
                }
                columns={[
                  { key: "total", header: "Total", render: (o) => <Amount minor={o.total} currency={o.currency} size="sm" /> },
                  { key: "status", header: "Status", render: (o) => <StatusChip status={o.status} /> },
                  {
                    key: "items",
                    header: "Items",
                    render: (o) => (
                      <span className="block max-w-[240px] truncate text-text-2">
                        {o.items[0]?.description ?? "—"}
                        {o.items.length > 1 && <span className="text-muted"> +{o.items.length - 1} more</span>}
                      </span>
                    ),
                  },
                  {
                    key: "customer",
                    header: "Customer",
                    render: (o) => <span className="block max-w-[220px] truncate text-text-2">{customerLabel(customer(o.customer_id), o.customer_id) ?? "Guest"}</span>,
                  },
                  { key: "country", header: "Country", render: (o) => <span className="whitespace-nowrap">{o.country ? <>{flag(o.country)} {o.country}</> : "—"}</span> },
                  { key: "date", header: "Date", align: "right", render: (o) => <span className="whitespace-nowrap text-muted">{date(o.created_at, true)}</span> },
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
