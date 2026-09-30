"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { flag } from "@/lib/format";
import { toMajorInput, toMinor } from "@/lib/merchant/money";
import type { Customer } from "@/lib/merchant/types";
import { Button, ErrorNote, Field, Input, Modal, Segmented, Select } from "@/components/ui";
import { MoneyInput } from "../common";
import { useMerchant, useToast } from "../context";
import { useCountries } from "../useMeta";

type Form = {
  email: string; name: string; phone: string; country: string; postal_code: string; address_line: string; tax_id: string;
  customer_type: "b2c" | "b2b"; payment_terms_days: string; credit_limit: string;
};

function initial(c: Customer | null | undefined, currency: string): Form {
  return {
    email: c?.email ?? "", name: c?.name ?? "", phone: c?.phone ?? "", country: c?.country ?? "", postal_code: c?.postal_code ?? "",
    address_line: c?.address_line ?? "", tax_id: c?.tax_id ?? "", customer_type: c?.customer_type === "b2b" ? "b2b" : "b2c",
    payment_terms_days: String(c?.payment_terms_days ?? 0), credit_limit: c?.credit_limit != null ? toMajorInput(c.credit_limit, currency) : "",
  };
}

/**
 * Create (POST /v1/customers) or edit (PATCH /v1/customers/{id}) a customer. The credit limit is
 * entered in the organization's default currency and sent as integer minor units.
 */
export function CustomerFormModal({ open, onClose, customer, onSaved }: { open: boolean; onClose: () => void; customer?: Customer | null; onSaved: (c: Customer) => void }) {
  const { org } = useMerchant();
  const currency = org.default_currency;
  const countries = useCountries();
  const toast = useToast();
  const [f, setF] = useState<Form>(() => initial(customer, currency));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  const creditLimit = f.credit_limit.trim() ? toMinor(f.credit_limit, currency) : null;
  const creditInvalid = f.credit_limit.trim() !== "" && creditLimit === null;
  const terms = Number(f.payment_terms_days);
  const termsInvalid = !Number.isInteger(terms) || terms < 0 || terms > 365;
  const editing = !!customer;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creditInvalid || termsInvalid) return;
    setBusy(true);
    setError(null);
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    const body = {
      email: opt(f.email), name: opt(f.name), phone: opt(f.phone), country: opt(f.country), postal_code: opt(f.postal_code),
      address_line: opt(f.address_line), tax_id: opt(f.tax_id), customer_type: f.customer_type, payment_terms_days: terms,
      credit_limit: creditLimit ?? undefined,
    };
    try {
      const c = editing
        ? await api<Customer>(`/v1/customers/${customer.id}`, { method: "PATCH", body })
        : await api<Customer>("/v1/customers", { body });
      toast(editing ? "Customer updated" : "Customer created");
      onSaved(c);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit customer" : "New customer"} wide>
      <form onSubmit={submit} className="space-y-4">
        <Segmented<"b2c" | "b2b">
          value={f.customer_type}
          onChange={(v) => set("customer_type", v)}
          options={[{ value: "b2c", label: "Individual (B2C)" }, { value: "b2b", label: "Business (B2B)" }]}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={f.customer_type === "b2b" ? "Company or contact name" : "Name"}>
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} autoComplete="off" autoFocus />
          </Field>
          <Field label="Email">
            <Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Phone">
            <Input type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Country" hint="Decides the tax that applies to this customer.">
            <Select value={f.country} onChange={(e) => set("country", e.target.value)}>
              <option value="">Not set</option>
              {countries.map((c) => <option key={c.country} value={c.country}>{flag(c.country)} {c.name}</option>)}
            </Select>
          </Field>
          <Field label="Address">
            <Input value={f.address_line} onChange={(e) => set("address_line", e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Postal code">
            <Input value={f.postal_code} onChange={(e) => set("postal_code", e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Tax ID" hint={f.customer_type === "b2b" ? "A valid business tax ID can make cross-border invoices reverse charge." : "Optional for individuals."}>
            <Input value={f.tax_id} onChange={(e) => set("tax_id", e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Payment terms (days)" hint="Net terms used for invoices, 0 for due on receipt." error={termsInvalid ? "Enter whole days between 0 and 365." : null}>
            <Input type="number" min={0} max={365} value={f.payment_terms_days} onChange={(e) => set("payment_terms_days", e.target.value)} />
          </Field>
          <Field label="Credit limit" hint="Invoices that would take open balances above this are refused. Leave empty for no limit." error={creditInvalid ? "Enter an amount with at most the currency's decimals." : null}>
            <MoneyInput currency={currency} value={f.credit_limit} onChange={(v) => set("credit_limit", v)} />
          </Field>
        </div>
        {editing && <p className="text-[12.5px] text-muted">Emptying a field keeps its current value; the API only changes fields you fill in.</p>}
        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={creditInvalid || termsInvalid}>{editing ? "Save changes" : "Create customer"}</Button>
        </div>
      </form>
    </Modal>
  );
}
