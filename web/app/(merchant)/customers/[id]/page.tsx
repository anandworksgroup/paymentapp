"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useApi } from "@/lib/merchant/hooks";
import { Amount, Button, Card, CardHeader, Chip, PageHeader, StatusChip, Table } from "@/components/ui";
import { date, titleCase } from "@/lib/format";
import { useMerchant } from "@/components/merchant/context";
import { BackLink, DetailSkeleton, Loaded, Mono, NoAccess, SectionTitle } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { InvoiceTable, LinkButton, PillLink, SubscriptionTable } from "@/components/merchant/billing/bits";
import type { CustomerDetail } from "@/components/merchant/billing/types";
import { CustomerFormModal } from "@/components/merchant/customers/CustomerFormModal";
import { AnonymizeButton, PortalSessionButton } from "@/components/merchant/customers/CustomerActions";
import { CreditsCard, EntitlementsCard, PaymentMethodsCard, ProfileCard, UsageCard } from "@/components/merchant/customers/CustomerSections";
import { MergeButton, MergedBanner } from "@/components/merchant/growth/CustomerMerge";
import { BudgetsCard } from "@/components/merchant/growth/BudgetsCard";
import type { CustomerWithMerge } from "@/components/merchant/growth/types";

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useMerchant();
  const res = useApi<CustomerDetail>(can("customers.read") ? `/v1/customers/${id}` : null);
  if (!can("customers.read")) return <NoAccess what="customers" />;
  return (
    <>
      <BackLink href="/customers">Customers</BackLink>
      <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<DetailSkeleton />}>
        {(d) => <Detail d={d} reload={res.reload} />}
      </Loaded>
    </>
  );
}

function Detail({ d, reload }: { d: CustomerDetail; reload: () => void }) {
  const c = d.customer as CustomerWithMerge;
  const { can } = useMerchant();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const anonymized = !!c.anonymized_at;
  // A merged customer is a read-only tombstone that points at the survivor.
  const merged = !!c.merged_into_id;
  const editable = !anonymized && !merged;

  return (
    <>
      <PageHeader
        eyebrow={<Mono>{c.id}</Mono>}
        title={
          <span className="flex flex-wrap items-baseline gap-3">
            <span>{c.name ?? c.email ?? "Unnamed customer"}</span>
            <Chip tone={c.customer_type === "b2b" ? "lemon-soft" : "neutral"} className="text-[12px]">{c.customer_type === "b2b" ? "Business" : "Individual"}</Chip>
            {anonymized && <Chip tone="neutral" className="text-[12px]"><Icon name="lock" size={12} /> Anonymized</Chip>}
            {merged && <Chip tone="neutral" className="text-[12px]"><Icon name="merge" size={12} /> Merged</Chip>}
          </span>
        }
        subtitle={<>{c.email ?? "No email"} · customer since {date(c.created_at)}</>}
        actions={
          <>
            {can("customers.write") && editable && <Button variant="soft" onClick={() => setEditing(true)}>Edit</Button>}
            {can("customers.write") && editable && <PortalSessionButton customer={c} />}
            {can("customers.write") && editable && <MergeButton customer={c} />}
            {can("invoices.write") && !merged && <LinkButton href={`/invoices/new?customer=${c.id}`} variant="ink" icon={<Icon name="invoice" size={16} />}>Create invoice</LinkButton>}
            {can("customers.write") && editable && <AnonymizeButton customer={c} onDone={reload} />}
          </>
        }
      />

      {merged && c.merged_into_id && <MergedBanner intoId={c.merged_into_id} />}

      {anonymized && (
        <div role="status" className="mb-5 rounded-inner bg-surface-3 px-5 py-4 text-[13.5px] text-text-2">
          Personal data for this customer was removed on {date(c.anonymized_at, true)}. Financial records are kept for accounting and tax purposes.
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Subscriptions" action={can("subscriptions.read") && d.subscriptions.length > 0 && <PillLink href="/subscriptions">All subscriptions</PillLink>} />
            <SubscriptionTable rows={d.subscriptions} empty={<p className="text-[13px] text-muted">No subscriptions.</p>} />
          </Card>

          <Card>
            <CardHeader title="Invoices" subtitle="Latest 20" />
            <InvoiceTable rows={d.invoices} empty={<p className="text-[13px] text-muted">No invoices yet.</p>} />
          </Card>

          <Card>
            <CardHeader title="Payments" subtitle="Latest 20" />
            <Table
              rows={d.payments}
              rowKey={(p) => p.id}
              onRowClick={(p) => router.push(`/payments/${p.id}`)}
              empty={<p className="text-[13px] text-muted">No payments yet.</p>}
              columns={[
                { key: "a", header: "Amount", render: (p) => <Amount minor={p.amount} currency={p.currency} size="sm" /> },
                { key: "s", header: "Status", render: (p) => <StatusChip status={p.status} /> },
                { key: "m", header: "Method", render: (p) => <span className="whitespace-nowrap text-text-2">{p.payment_method_type === "upi" ? "UPI" : titleCase(p.card_brand ?? p.payment_method_type ?? "—")}{p.last4 ? ` •••• ${p.last4}` : ""}</span> },
                { key: "d", header: "Description", render: (p) => <span className="block max-w-[220px] truncate text-text-2">{p.description ?? "—"}</span> },
                { key: "t", header: "Date", align: "right", render: (p) => <span className="whitespace-nowrap text-muted">{date(p.created_at, true)}</span> },
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Orders" subtitle="Latest 20" />
            <Table
              rows={d.orders}
              rowKey={(o) => o.id}
              onRowClick={(o) => router.push(`/orders/${o.id}`)}
              empty={<p className="text-[13px] text-muted">No orders yet.</p>}
              columns={[
                { key: "t", header: "Total", render: (o) => <Amount minor={o.total} currency={o.currency} size="sm" /> },
                { key: "s", header: "Status", render: (o) => <StatusChip status={o.status} /> },
                { key: "i", header: "Items", render: (o) => <span className="block max-w-[260px] truncate text-text-2">{o.items.map((i) => i.description ?? i.price_id).join(", ")}</span> },
                { key: "d", header: "Date", align: "right", render: (o) => <span className="whitespace-nowrap text-muted">{date(o.created_at, true)}</span> },
              ]}
            />
          </Card>

          {(d.refunds.length > 0 || d.disputes.length > 0) && (
            <Card>
              {d.refunds.length > 0 && (
                <div className="mb-5 last:mb-0">
                  <SectionTitle>Refunds</SectionTitle>
                  <Table rows={d.refunds} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/payments/${r.payment_id}`)} columns={[
                    { key: "a", header: "Amount", render: (r) => <Amount minor={r.amount} currency={r.currency} size="sm" /> },
                    { key: "s", header: "Status", render: (r) => <StatusChip status={r.status} /> },
                    { key: "r", header: "Reason", render: (r) => <span className="text-text-2">{titleCase(r.reason ?? "—")}</span> },
                    { key: "d", header: "Created", align: "right", render: (r) => <span className="whitespace-nowrap text-muted">{date(r.created_at, true)}</span> },
                  ]} />
                </div>
              )}
              {d.disputes.length > 0 && (
                <div>
                  <SectionTitle>Disputes</SectionTitle>
                  <ul className="space-y-2">
                    {d.disputes.map((x) => (
                      <li key={x.id}>
                        <Link href={`/disputes/${x.id}`} className="flex flex-wrap items-center gap-3 rounded-inner bg-surface-2 px-4 py-3 hover:bg-surface-3">
                          <Amount minor={x.amount} currency={x.currency} size="sm" />
                          <StatusChip status={x.status} />
                          <span className="flex-1 text-[13px] text-text-2">{titleCase(x.reason)}</span>
                          <span className="text-[12px] text-muted">Evidence due {date(x.evidence_due_by)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          <ProfileCard c={c} />
          <CreditsCard customerId={c.id} credits={d.credits} />
          <PaymentMethodsCard methods={d.payment_methods} defaultId={c.default_payment_method_id} />
          <EntitlementsCard items={d.entitlements} />
          <UsageCard usage={d.usage} customerId={c.id} />
          <BudgetsCard customerId={c.id} readOnly={merged} />
        </div>
      </div>

      {editing && (
        <CustomerFormModal
          open
          customer={c}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
    </>
  );
}
