"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useApi } from "@/lib/merchant/hooks";
import type { Order, Payment } from "@/lib/merchant/types";
import { Amount, Card, CardHeader, Chip, PageHeader, StatusChip, Table } from "@/components/ui";
import { date, flag, titleCase } from "@/lib/format";
import { useMerchant } from "@/components/merchant/context";
import { BackLink, DetailSkeleton, InfoPopover, KV, Loaded, Mono, NoAccess } from "@/components/merchant/common";
import { LineItems, Totals } from "@/components/merchant/sales/LineItems";
import { customerLabel, useCustomerNames } from "@/components/merchant/sales/lookups";

type OrderDetail = { order: Order & { coupon_id?: string | null; updated_at?: string }; payments: Payment[] };

const link = "underline-offset-4 hover:underline";

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useMerchant();
  const res = useApi<OrderDetail>(can("payments.read") ? `/v1/orders/${id}` : null);
  if (!can("payments.read")) return <NoAccess what="orders" />;
  return (
    <>
      <BackLink href="/orders">Orders</BackLink>
      <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<DetailSkeleton />}>
        {(d) => <Detail d={d} />}
      </Loaded>
    </>
  );
}

function Detail({ d }: { d: OrderDetail }) {
  const o = d.order;
  const router = useRouter();
  const { can } = useMerchant();
  const customer = useCustomerNames([o.customer_id], can("customers.read"))(o.customer_id);

  return (
    <>
      <PageHeader
        eyebrow={<Mono>{o.id}</Mono>}
        title={
          <span className="flex flex-wrap items-baseline gap-3">
            <Amount minor={o.total} currency={o.currency} size="lg" />
            <StatusChip status={o.status} className="text-[12.5px]" />
          </span>
        }
        subtitle={<>{o.items.length} {o.items.length === 1 ? "item" : "items"} · {date(o.created_at, true)}</>}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Line items" subtitle="Prices, discounts and tax as calculated by the server at purchase" />
            <LineItems items={o.items} currency={o.currency} />
            <Totals
              currency={o.currency}
              subtotal={o.subtotal}
              discount={o.discount}
              tax={o.tax}
              total={o.total}
              extra={o.amount_refunded > 0 ? [["Refunded", -o.amount_refunded]] : undefined}
            />
          </Card>

          <Card>
            <CardHeader title="Payments" subtitle="Charges linked to this order" />
            <Table
              rows={d.payments}
              rowKey={(p) => p.id}
              onRowClick={(p) => router.push(`/payments/${p.id}`)}
              empty={<p className="text-[13px] text-muted">No payment is linked — for example a free trial or a fully discounted order.</p>}
              columns={[
                { key: "a", header: "Amount", render: (p) => <Amount minor={p.amount} currency={p.currency} size="sm" /> },
                { key: "s", header: "Status", render: (p) => <StatusChip status={p.status} /> },
                { key: "m", header: "Method", render: (p) => <span className="whitespace-nowrap text-text-2">{p.payment_method_type === "upi" ? "UPI" : titleCase(p.card_brand ?? p.payment_method_type ?? "—")}{p.last4 ? ` •••• ${p.last4}` : ""}</span> },
                { key: "d", header: "Date", align: "right", render: (p) => <span className="whitespace-nowrap text-muted">{date(p.created_at, true)}</span> },
              ]}
            />
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Details" />
            <KV
              rows={[
                ["Customer", o.customer_id ? <Link className={link} href={`/customers/${o.customer_id}`}>{customerLabel(customer, o.customer_id)}</Link> : "Guest"],
                ["Country", o.country ? <>{flag(o.country)} {o.country}</> : null],
                ["Currency", o.currency],
                ["Payment", o.payment_id ? <Link className={link} href={`/payments/${o.payment_id}`}>{o.payment_id}</Link> : null],
                ["Invoice", o.invoice_id ? <Link className={link} href={`/invoices/${o.invoice_id}`}>{o.invoice_id}</Link> : null],
                ["Checkout session", o.checkout_session_id ? <Link className={link} href="/checkout-sessions">{o.checkout_session_id}</Link> : null],
                ["Coupon", o.coupon_id ? <Link className={link} href="/coupons">{o.coupon_id}</Link> : null],
                ["Updated", o.updated_at ? date(o.updated_at, true) : null],
              ]}
            />
          </Card>

          <Card className="lemon-gradient">
            <CardHeader
              title="Legal"
              subtitle="Recorded at purchase and never changed afterwards"
              action={<InfoPopover label="Merchant of Record">The platform sells to your customer as the legal seller, so it collects and remits the tax on this order. You receive the proceeds minus fees.</InfoPopover>}
            />
            <KV
              rows={[
                ["Seller of record", o.seller_of_record],
                ["Accepted terms", o.accepted_terms_version ? <Chip tone="neutral">{o.accepted_terms_version}</Chip> : null],
              ]}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
