"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { api } from "@/lib/api";
import { flag } from "@/lib/format";
import { useApi } from "@/lib/merchant/hooks";
import { CURRENCIES } from "@/lib/merchant/money";
import type { Customer, Invoice } from "@/lib/merchant/types";
import { Button, Card, CardHeader, ErrorNote, Field, Input, PageHeader, Select, Skeleton, Textarea } from "@/components/ui";
import { useMerchant, useToast } from "@/components/merchant/context";
import { BackLink, Help, NoAccess } from "@/components/merchant/common";
import { CustomerPicker } from "@/components/merchant/pickers";
import { InvoiceLineEditor, lineError, newLine, toRequestLine, type DraftLine } from "@/components/merchant/billing/InvoiceLineEditor";
import type { CustomerDetail } from "@/components/merchant/billing/types";

const TERMS = [0, 7, 15, 30, 45, 60, 90];

export default function NewInvoicePage() {
  const { can } = useMerchant();
  if (!can("invoices.write")) return <><BackLink href="/invoices">Invoices</BackLink><NoAccess what="invoice creation" /></>;
  return <NewInvoice />;
}

function NewInvoice() {
  const { org } = useMerchant();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const preId = params.get("customer");
  const pre = useApi<CustomerDetail>(preId ? `/v1/customers/${preId}` : null);
  // `undefined` = not touched yet, so the ?customer= preselection shows once it loads.
  const [picked, setPicked] = useState<Customer | null | undefined>(undefined);
  const customer = picked !== undefined ? picked : pre.data?.customer ?? null;
  const [currency, setCurrency] = useState(org.default_currency);
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine()]);
  const [terms, setTerms] = useState<string | null>(null);
  const [po, setPo] = useState("");
  const [memo, setMemo] = useState("");
  const [finalize, setFinalize] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const customerId = useId();

  const days = terms ?? String(customer?.payment_terms_days || 30);
  const termOptions = TERMS.includes(Number(days)) ? TERMS : [...TERMS, Number(days)].sort((a, b) => a - b);
  const invalid = !customer || lines.some((l) => lineError(l, currency) !== null);
  const currencies = CURRENCIES.includes(org.default_currency) ? CURRENCIES : [org.default_currency, ...CURRENCIES];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (invalid || !customer) return;
    setBusy(true);
    setError(null);
    try {
      const inv = await api<Invoice>("/v1/invoices", {
        body: {
          customer: customer.id, currency, lines: lines.map((l) => toRequestLine(l, currency)), days_until_due: Number(days),
          purchase_order: po.trim() || undefined, memo: memo.trim() || undefined, auto_finalize: finalize,
        },
      });
      toast(`Invoice ${inv.number} created`);
      router.push(`/invoices/${inv.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <>
      <BackLink href="/invoices">Invoices</BackLink>
      <PageHeader title="New invoice" subtitle="A manual B2B invoice with net payment terms. Tax is worked out by the platform when you create it." />
      <form onSubmit={submit} className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Bill to" />
            <label htmlFor={customerId} className="mb-1.5 block text-[12.5px] font-medium text-text-2">Customer</label>
            {preId && pre.loading && picked === undefined ? <Skeleton className="h-11" /> : (
              <CustomerPicker id={customerId} value={customer} onChange={setPicked} required />
            )}
            {pre.error && picked === undefined ? <div className="mt-2"><ErrorNote error={pre.error} /></div> : null}
            {submitted && !customer && <p role="alert" className="mt-1 text-[12px] text-rose-ink">Choose who the invoice is for.</p>}
            {customer && (
              <p className="mt-2 text-[12.5px] text-muted">
                {customer.customer_type === "b2b" ? "Business" : "Individual"}
                {customer.country ? ` · ${flag(customer.country)} ${customer.country}` : " · no country set"}
                {customer.tax_id ? ` · tax ID ${customer.tax_id}` : " · no tax ID"}
                {customer.credit_limit != null ? " · has a credit limit" : ""}
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title="Lines" subtitle={`Amounts in ${currency}, before tax`} />
            <InvoiceLineEditor lines={lines} onChange={setLines} currency={currency} showErrors={submitted} />
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Terms" />
            <div className="space-y-4">
              <Field label="Currency" hint="Catalog prices must be in this currency.">
                <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label="Payment terms" hint={customer?.payment_terms_days ? `Customer default is Net ${customer.payment_terms_days}.` : undefined}>
                <Select value={days} onChange={(e) => setTerms(e.target.value)}>
                  {termOptions.map((t) => <option key={t} value={t}>{t === 0 ? "Due on receipt" : `Net ${t}`}</option>)}
                </Select>
              </Field>
              <Field label="Purchase order (optional)">
                <Input value={po} onChange={(e) => setPo(e.target.value)} maxLength={100} />
              </Field>
              <Field label="Memo (optional)" hint="Printed on the invoice.">
                <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} />
              </Field>
              <label className="flex cursor-pointer items-start gap-3 rounded-inner bg-surface-2 p-4 text-[13.5px]">
                <input type="checkbox" checked={finalize} onChange={(e) => setFinalize(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--ink)]" />
                <span>
                  <span className="block text-text">Finalize now</span>
                  <span className="block text-[12.5px] text-muted">Makes the invoice open and payable straight away. Leave off to save a draft you can review and finalize later; the due date still counts from today.</span>
                </span>
              </label>
              <Help>Totals, tax (including reverse charge for eligible businesses) and the credit-limit check are done by the server.</Help>
              <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => router.push("/invoices")}>Cancel</Button>
                <Button type="submit" loading={busy} disabled={submitted && invalid}>{finalize ? "Create invoice" : "Save draft"}</Button>
              </div>
            </div>
          </Card>
        </div>
      </form>
    </>
  );
}
