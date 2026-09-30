"use client";

import Link from "next/link";
import { useCursorList } from "@/lib/merchant/hooks";
import type { CheckoutSession } from "@/lib/merchant/types";
import { Amount, Button, Card, Chip, Empty, PageHeader, StatusChip, Table } from "@/components/ui";
import { date, titleCase } from "@/lib/format";
import { useMerchant } from "@/components/merchant/context";
import { ListSkeleton, Loaded, NoAccess, Pager } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { CheckoutCreateModal } from "@/components/merchant/sales/CheckoutCreateModal";
import { checkoutUrl, useNewParam } from "@/components/merchant/sales/links";

const pill = "inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full bg-surface-2 px-2.5 text-[11.5px] text-text-2 transition hover:bg-surface-3 hover:text-text";

export default function CheckoutSessionsPage() {
  const { can } = useMerchant();
  const create = useNewParam();
  const list = useCursorList<CheckoutSession>(can("payments.read") ? "/v1/checkout/sessions" : null);

  if (!can("payments.read")) return <NoAccess what="checkout sessions" />;
  const canWrite = can("checkout.write");

  return (
    <>
      <PageHeader
        title="Checkout sessions"
        subtitle="Hosted checkout pages created by payment links, the API or you. Sessions expire after 24 hours."
        actions={canWrite && <Button icon={<Icon name="plus" size={16} />} onClick={create.setOpen}>Create checkout session</Button>}
      />
      <Card>
        <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton />}>
          {() => (
            <>
              <Table
                rows={list.rows}
                rowKey={(s) => s.id}
                empty={
                  <Empty title="No checkout sessions yet" icon={<Icon name="cart" />} action={canWrite && <Button onClick={create.setOpen}>Create checkout session</Button>}>
                    A session is created each time someone opens a payment link, or when your server calls the Checkout API.
                  </Empty>
                }
                columns={[
                  {
                    key: "total",
                    header: "Total",
                    render: (s) => (
                      <div>
                        <Amount minor={s.total} currency={s.currency} size="sm" />
                        <div className="max-w-[200px] truncate text-[12px] text-muted">
                          {s.line_items[0]?.description ?? "—"}
                          {s.line_items.length > 1 ? ` +${s.line_items.length - 1}` : ""}
                        </div>
                      </div>
                    ),
                  },
                  { key: "status", header: "Status", render: (s) => <StatusChip status={s.status} /> },
                  {
                    key: "mode",
                    header: "Mode",
                    render: (s) => (
                      <span className="flex flex-wrap gap-1">
                        <Chip tone={s.mode === "subscription" ? "sky" : "neutral"}>{titleCase(s.mode)}</Chip>
                        {s.payment_link_id && <Chip tone="lemon-soft">Link</Chip>}
                      </span>
                    ),
                  },
                  { key: "email", header: "Customer", render: (s) => <span className="block max-w-[200px] truncate text-text-2">{s.customer_email ?? "—"}</span> },
                  {
                    key: "exp",
                    header: "Expires / completed",
                    render: (s) => <span className="whitespace-nowrap text-muted">{s.completed_at ? `Completed ${date(s.completed_at, true)}` : date(s.expires_at, true)}</span>,
                  },
                  {
                    key: "links",
                    header: <span className="sr-only">Links</span>,
                    align: "right",
                    render: (s) => (
                      <span className="flex flex-wrap justify-end gap-1.5">
                        {s.status === "open" && (
                          <a href={checkoutUrl(s.id)} target="_blank" rel="noreferrer" className={pill} aria-label={`Open hosted checkout ${s.id}`}>
                            Open <Icon name="external" size={12} />
                          </a>
                        )}
                        {s.payment_id && <Link href={`/payments/${s.payment_id}`} className={pill}>Payment</Link>}
                        {s.order_id && <Link href={`/orders/${s.order_id}`} className={pill}>Order</Link>}
                        {s.subscription_id && <Link href={`/subscriptions/${s.subscription_id}`} className={pill}>Subscription</Link>}
                        {s.customer_id && <Link href={`/customers/${s.customer_id}`} className={pill}>Customer</Link>}
                      </span>
                    ),
                  },
                ]}
              />
              <Pager page={list.page} hasPrev={list.hasPrev} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
            </>
          )}
        </Loaded>
      </Card>

      {create.open && canWrite && <CheckoutCreateModal onClose={create.close} onCreated={list.reload} />}
    </>
  );
}
