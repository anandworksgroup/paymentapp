"use client";

import { useParams, useRouter } from "next/navigation";
import { Amount, Card, CardHeader, Chip, PageHeader, StatusChip, Table } from "@/components/ui";
import { date, flag, titleCase } from "@/lib/format";
import { useApi } from "@/lib/merchant/hooks";
import { useMerchant } from "@/components/merchant/context";
import { BackLink, DetailSkeleton, JsonBlock, KV, Loaded, Mono, NoAccess } from "@/components/merchant/common";
import { HeroCard } from "@/components/merchant/charts";
import { Icon } from "@/components/merchant/icons";
import { TextLink } from "@/components/merchant/billing/bits";
import { InvoiceActions } from "@/components/merchant/billing/InvoiceActions";
import { bps, type InvoiceDetail } from "@/components/merchant/billing/types";

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useMerchant();
  const res = useApi<InvoiceDetail>(can("invoices.read") ? `/v1/invoices/${id}` : null);
  if (!can("invoices.read")) return <NoAccess what="invoices" />;
  return (
    <>
      <BackLink href="/invoices">Invoices</BackLink>
      <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<DetailSkeleton />}>
        {(d) => <Detail d={d} reload={res.reload} />}
      </Loaded>
    </>
  );
}

function Detail({ d, reload }: { d: InvoiceDetail; reload: () => void }) {
  const i = d.invoice;
  const router = useRouter();
  const cur = i.currency;

  return (
    <>
      <PageHeader
        eyebrow={<Mono>{i.id}</Mono>}
        title={
          <span className="flex flex-wrap items-baseline gap-3">
            <span>{i.number}</span>
            <StatusChip status={i.status} className="text-[12.5px]" />
          </span>
        }
        subtitle={<>{titleCase(i.billing_reason)} invoice · created {date(i.created_at, true)}{i.due_date ? ` · due ${date(i.due_date)}` : ""}</>}
        actions={<InvoiceActions invoice={i} onDone={reload} />}
      />

      <section aria-label="Amounts" className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <HeroCard tone="sage" label="Total" minor={i.total} currency={cur} footer={`${d.lines.length} ${d.lines.length === 1 ? "line" : "lines"}`} />
        <HeroCard label="Amount due" minor={i.amount_due} currency={cur} footer={i.due_date ? `Due ${date(i.due_date)}` : "No due date"}
          chip={i.status === "PAST_DUE" ? <Chip tone="peach">Past due</Chip> : undefined} />
        <HeroCard label="Amount paid" minor={i.amount_paid} currency={cur} footer={i.paid_at ? `Paid ${date(i.paid_at, true)}` : `${i.attempt_count} collection ${i.attempt_count === 1 ? "attempt" : "attempts"}`} />
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Lines" />
            <Table
              rows={d.lines}
              rowKey={(l) => l.id}
              empty={<p className="text-[13px] text-muted">No lines.</p>}
              columns={[
                { key: "d", header: "Description", render: (l) => (
                  <span className="block min-w-[160px]">
                    <span className="text-text">{l.description}</span>
                    {l.proration && <Chip tone="lemon-soft" className="ml-2">Proration</Chip>}
                    {l.period_start && l.period_end && <span className="block text-[12px] text-muted">{date(l.period_start)} – {date(l.period_end)}</span>}
                  </span>
                ) },
                { key: "q", header: "Qty", align: "right", render: (l) => <span className="numeral">{l.quantity.toLocaleString("en-US")}</span> },
                { key: "u", header: "Unit", align: "right", render: (l) => <Amount minor={l.unit_amount} currency={cur} size="sm" showCode={false} /> },
                { key: "a", header: "Amount", align: "right", render: (l) => <Amount minor={l.amount} currency={cur} size="sm" showCode={false} /> },
                { key: "disc", header: "Discount", align: "right", render: (l) => l.discount ? <Amount minor={l.discount} currency={cur} size="sm" showCode={false} /> : <span className="text-faint">—</span> },
                { key: "t", header: "Tax", align: "right", render: (l) => (
                  <span className="whitespace-nowrap">
                    <Amount minor={l.tax} currency={cur} size="sm" showCode={false} />
                    <span className="block text-[11.5px] text-muted">{bps(l.tax_rate_bps)}{l.tax_type ? ` · ${l.tax_type === "reverse_charge" ? "Reverse charge" : l.tax_type}` : ""}</span>
                  </span>
                ) },
              ]}
            />
            <dl className="ml-auto mt-4 max-w-sm space-y-2 border-t border-line pt-4 text-[13.5px]">
              <TotalRow label="Subtotal" minor={i.subtotal} cur={cur} />
              <TotalRow label="Discount" minor={i.discount} cur={cur} />
              <TotalRow label="Tax" minor={i.tax} cur={cur} />
              <TotalRow label="Total" minor={i.total} cur={cur} strong />
              <TotalRow label="Credited" minor={i.amount_credited} cur={cur} />
              <TotalRow label="Paid" minor={i.amount_paid} cur={cur} />
              <TotalRow label="Amount due" minor={i.amount_due} cur={cur} strong />
            </dl>
            <p className="mt-2 text-right text-[12px] text-muted">Totals as calculated by the server.</p>
          </Card>

          <Card>
            <CardHeader title="Tax records" subtitle="What the platform records for tax reporting" />
            <Table
              rows={d.tax_records}
              rowKey={(t) => t.id}
              empty={<p className="text-[13px] text-muted">No tax records yet. They are written when the invoice is paid.</p>}
              columns={[
                { key: "c", header: "Country", render: (t) => <span className="whitespace-nowrap">{flag(t.country)} {t.country}</span> },
                { key: "ty", header: "Type", render: (t) => (
                  <span className="flex flex-wrap gap-1">
                    <span className="text-text-2">{t.tax_type}</span>
                    {t.reverse_charge && <Chip tone="lemon-soft">Reverse charge</Chip>}
                    {t.exempt && <Chip tone="neutral">Exempt</Chip>}
                  </span>
                ) },
                { key: "r", header: "Rate", align: "right", render: (t) => bps(t.rate_bps) },
                { key: "b", header: "Taxable", align: "right", render: (t) => <Amount minor={t.taxable_amount} currency={t.currency} size="sm" showCode={false} /> },
                { key: "a", header: "Tax", align: "right", render: (t) => <Amount minor={t.tax_amount} currency={t.currency} size="sm" showCode={false} /> },
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Payments" />
            <Table
              rows={d.payments}
              rowKey={(p) => p.id}
              onRowClick={(p) => router.push(`/payments/${p.id}`)}
              empty={<p className="text-[13px] text-muted">No payment attempts yet.</p>}
              columns={[
                { key: "a", header: "Amount", render: (p) => <Amount minor={p.amount} currency={p.currency} size="sm" /> },
                { key: "s", header: "Status", render: (p) => <StatusChip status={p.status} /> },
                { key: "m", header: "Method", render: (p) => <span className="whitespace-nowrap text-text-2">{p.payment_method_type === "upi" ? "UPI" : titleCase(p.card_brand ?? p.payment_method_type ?? "—")}{p.last4 ? ` •••• ${p.last4}` : ""}</span> },
                { key: "d", header: "Date", align: "right", render: (p) => <span className="whitespace-nowrap text-muted">{date(p.created_at, true)}</span> },
              ]}
            />
          </Card>

          {d.credit_notes.length > 0 && (
            <Card>
              <CardHeader title="Credit notes" />
              <Table rows={d.credit_notes} rowKey={(c) => c.id} columns={[
                { key: "n", header: "Number", render: (c) => <span className="font-mono text-[12.5px]">{c.number}</span> },
                { key: "a", header: "Amount", render: (c) => <Amount minor={c.amount} currency={c.currency} size="sm" /> },
                { key: "t", header: "Tax part", render: (c) => <Amount minor={c.tax} currency={c.currency} size="sm" showCode={false} /> },
                { key: "r", header: "Reason", render: (c) => <span className="text-text-2">{titleCase(c.reason)}</span> },
                { key: "d", header: "Date", align: "right", render: (c) => <span className="whitespace-nowrap text-muted">{date(c.created_at, true)}</span> },
              ]} />
            </Card>
          )}

          <Card>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[12px] text-[19px] font-medium tracking-[-0.01em] text-text focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sage-100">
                <span>
                  Calculation inputs
                  <span className="mt-1 block text-[13px] font-normal tracking-normal text-muted">Prices, quantities, usage and tax context the server used</span>
                </span>
                <Icon name="chevron" className="shrink-0 text-muted transition group-open:rotate-180" />
              </summary>
              <div className="mt-4">
                {d.calculation_inputs ? <JsonBlock value={d.calculation_inputs} /> : <p className="text-[13px] text-muted">No calculation inputs were stored for this invoice.</p>}
              </div>
            </details>
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Bill to" />
            <KV rows={[
              ["Name", i.customer_id ? <TextLink href={`/customers/${i.customer_id}`}>{i.customer_name ?? i.customer_id}</TextLink> : i.customer_name],
              ["Email", i.customer_email],
              ["Tax ID", i.customer_tax_id ? <span className="font-mono text-[12.5px]">{i.customer_tax_id}</span> : null],
              ["Country", i.customer_country ? <>{flag(i.customer_country)} {i.customer_country}</> : null],
            ]} />
          </Card>
          <Card>
            <CardHeader title="Details" />
            <KV rows={[
              ["Purchase order", i.purchase_order],
              ["Memo", i.memo],
              ["Seller of record", i.seller_of_record],
              ["Billing reason", titleCase(i.billing_reason)],
              ["Subscription", i.subscription_id ? <TextLink href={`/subscriptions/${i.subscription_id}`}>{i.subscription_id}</TextLink> : null],
              ["Period", i.period_start && i.period_end ? `${date(i.period_start)} – ${date(i.period_end)}` : null],
              ["Due", date(i.due_date)],
              ["Finalized", i.finalized_at ? date(i.finalized_at, true) : null],
              ["Paid", i.paid_at ? date(i.paid_at, true) : null],
              ["Collection attempts", String(i.attempt_count)],
            ]} />
          </Card>
        </div>
      </div>
    </>
  );
}

function TotalRow({ label, minor, cur, strong }: { label: string; minor: number; cur: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? "text-text" : "text-muted"}>{label}</dt>
      <dd><Amount minor={minor} currency={cur} size="sm" showCode={strong} /></dd>
    </div>
  );
}
