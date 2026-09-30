"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { toMajorInput, toMinor } from "@/lib/merchant/money";
import type { BeneficialOwner, MerchantApplication } from "@/lib/merchant/types";
import { Button, Card, CardHeader, ErrorNote, Field, Input, Select, Textarea } from "@/components/ui";
import { useMerchant, useToast } from "../context";
import { ConfirmModal, Help, MoneyInput } from "../common";
import { useCountries } from "../useMeta";
import { OwnersEditor, pctToBps, toRow, type OwnerRow } from "./OwnersEditor";

type Text = "legal_name" | "trading_name" | "website" | "business_type" | "industry" | "country" | "registered_address" | "operating_address"
  | "registration_number" | "tax_number" | "contact_phone" | "product_description" | "customer_type" | "countries_served_csv" | "refund_policy_url" | "terms_url" | "privacy_url";
type Form = Record<Text, string> & { average_order: string; monthly_volume: string };

const TEXT_KEYS: Text[] = ["legal_name", "trading_name", "website", "business_type", "industry", "country", "registered_address", "operating_address",
  "registration_number", "tax_number", "contact_phone", "product_description", "customer_type", "countries_served_csv", "refund_policy_url", "terms_url", "privacy_url"];
const BUSINESS_TYPES = ["sole_proprietorship", "partnership", "llc", "corporation", "non_profit", "other"];
const INDUSTRIES = ["software", "saas", "digital_goods", "education", "media", "ecommerce", "consulting", "gaming", "health_wellness", "travel", "financial_services"];

function fromApp(a: MerchantApplication, currency: string): Form {
  const f = Object.fromEntries(TEXT_KEYS.map((k) => [k, (a[k] as string | null | undefined) ?? ""])) as Record<Text, string>;
  return { ...f, average_order: toMajorInput(a.average_order_minor, currency), monthly_volume: toMajorInput(a.expected_monthly_volume_minor, currency) };
}

export function ApplicationForm({ app, owners, locked, canWrite, onSaved }: {
  app: MerchantApplication; owners: BeneficialOwner[]; locked: boolean; canWrite: boolean; onSaved: () => void;
}) {
  const { org } = useMerchant();
  const cur = org.default_currency;
  const toast = useToast();
  const countries = useCountries();
  const [f, setF] = useState<Form>(() => fromApp(app, cur));
  const [rows, setRows] = useState<OwnerRow[]>(() => owners.map(toRow));
  const seq = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirm, setConfirm] = useState(false);
  const readOnly = locked || !canWrite;
  const set = (k: keyof Form, v: string) => setF((s) => ({ ...s, [k]: v }));

  const avg = f.average_order ? toMinor(f.average_order, cur) : null;
  const vol = f.monthly_volume ? toMinor(f.monthly_volume, cur) : null;
  const moneyBad = (f.average_order !== "" && avg === null) || (f.monthly_volume !== "" && vol === null);
  const ownersBad = rows.some((r) => !r.name.trim() || pctToBps(r.ownership || "0") === null);

  const payload = () => ({
    ...Object.fromEntries(TEXT_KEYS.map((k) => [k, f[k].trim()])),
    country: f.country.trim().toUpperCase(),
    countries_served_csv: f.countries_served_csv.split(/[,\s]+/).map((c) => c.trim().toUpperCase()).filter(Boolean).join(","),
    average_order_minor: avg ?? undefined,
    expected_monthly_volume_minor: vol ?? undefined,
    beneficial_owners: rows.map((r) => ({
      name: r.name.trim(), date_of_birth: r.date_of_birth || null, nationality: r.nationality || null, country: r.country || null,
      ownership_bps: pctToBps(r.ownership || "0") ?? 0, relationship: r.relationship,
    })),
  });

  const save = async () => {
    await api<MerchantApplication>("/v1/organization/application", { method: "PATCH", body: payload() });
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await save();
      toast("Application saved");
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await save();
      const res = await api<MerchantApplication>("/v1/organization/application/submit", { method: "POST" });
      setConfirm(false);
      toast(res.status === "ACTION_REQUIRED" ? "Submitted — a few details still need attention" : "Application submitted for review");
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const text = (k: Text, label: string, opts: { type?: string; placeholder?: string; hint?: string } = {}) => (
    <Field label={label} hint={opts.hint}>
      <Input type={opts.type ?? "text"} value={f[k]} onChange={(e) => set(k, e.target.value)} placeholder={opts.placeholder} />
    </Field>
  );

  return (
    <>
      <form onSubmit={onSave} className="min-w-0 space-y-5">
        <datalist id="kyb-countries">{countries.map((c) => <option key={c.country} value={c.country}>{c.name}</option>)}</datalist>
        <datalist id="kyb-industries">{INDUSTRIES.map((i) => <option key={i} value={i} />)}</datalist>
        <fieldset disabled={readOnly} className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Business details" subtitle="As registered with your company registry. Fields marked * are needed to submit." />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {text("legal_name", "Legal name *")}
              {text("trading_name", "Trading name", { hint: "The name customers see, if different." })}
              <Field label="Business type">
                <Select value={f.business_type} onChange={(e) => set("business_type", e.target.value)}>
                  <option value="">Choose…</option>
                  {[...new Set([...BUSINESS_TYPES, f.business_type].filter(Boolean))].map((b) => <option key={b} value={b}>{b.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</option>)}
                </Select>
              </Field>
              <Field label="Industry *" hint="What you sell, e.g. software or digital_goods.">
                <Input value={f.industry} onChange={(e) => set("industry", e.target.value)} list="kyb-industries" />
              </Field>
              <Field label="Country of registration *" hint="2-letter code">
                <Input value={f.country} onChange={(e) => set("country", e.target.value.toUpperCase().slice(0, 2))} list="kyb-countries" className="uppercase" />
              </Field>
              {text("registration_number", "Registration number *")}
              {text("tax_number", "Tax / VAT number")}
              {text("contact_phone", "Contact phone", { type: "tel" })}
              <div className="md:col-span-2">{text("registered_address", "Registered address *")}</div>
              <div className="md:col-span-2">{text("operating_address", "Operating address", { hint: "Leave empty if it's the same as the registered address." })}</div>
            </div>
          </Card>

          <Card>
            <CardHeader title="What you sell" subtitle="Helps us set the right limits for your account" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {text("website", "Website *", { type: "url", placeholder: "https://example.com" })}
              <Field label="Customers">
                <Select value={f.customer_type} onChange={(e) => set("customer_type", e.target.value)}>
                  <option value="">Choose…</option>
                  <option value="b2b">Businesses (B2B)</option>
                  <option value="b2c">Consumers (B2C)</option>
                  <option value="both">Both</option>
                  {f.customer_type && !["b2b", "b2c", "both"].includes(f.customer_type) && <option value={f.customer_type}>{f.customer_type.replace(/_/g, " ")}</option>}
                </Select>
              </Field>
              <div className="md:col-span-2">
                <Field label="Product description *" hint="In a sentence or two: what customers buy and how it's delivered.">
                  <Textarea value={f.product_description} onChange={(e) => set("product_description", e.target.value)} rows={3} />
                </Field>
              </div>
              <Field label="Average order value" error={f.average_order && avg === null ? "Enter an amount." : null}>
                <MoneyInput currency={cur} value={f.average_order} onChange={(v) => set("average_order", v)} />
              </Field>
              <Field label="Expected monthly volume" error={f.monthly_volume && vol === null ? "Enter an amount." : null}>
                <MoneyInput currency={cur} value={f.monthly_volume} onChange={(v) => set("monthly_volume", v)} />
              </Field>
              <div className="md:col-span-2">{text("countries_served_csv", "Countries you sell to", { placeholder: "US, GB, IN", hint: "2-letter codes, comma-separated." })}</div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Policies" subtitle="Public pages on your website that customers can read before buying" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {text("refund_policy_url", "Refund policy URL *", { type: "url" })}
              {text("terms_url", "Terms of service URL *", { type: "url" })}
              {text("privacy_url", "Privacy policy URL *", { type: "url" })}
            </div>
          </Card>

          <Card>
            <CardHeader title="Beneficial owners *" subtitle="People who own or control the business. Each person is screened when you submit." />
            <OwnersEditor rows={rows} onChange={setRows} locked={readOnly} newKey={() => `new-${++seq.current}`} />
          </Card>
        </fieldset>

        <div aria-live="assertive">{error && !confirm ? <ErrorNote error={error} /> : null}</div>
        {!readOnly ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Help>Saving keeps a draft. Owners are replaced with the list above.</Help>
            <Button type="submit" variant="soft" loading={busy && !confirm} disabled={moneyBad || ownersBad}>Save draft</Button>
            <Button type="button" disabled={moneyBad || ownersBad} onClick={() => { setError(null); setConfirm(true); }}>Submit for review</Button>
          </div>
        ) : !canWrite && !locked ? (
          <Help>Only owners and admins can edit the application.</Help>
        ) : null}
      </form>

      <ConfirmModal open={confirm} onClose={() => setConfirm(false)} title="Submit for review?" confirmLabel="Save and submit" busy={busy} error={error} onConfirm={onSubmit}>
        <p>We&apos;ll save your changes, run automated checks and screen each owner. If everything is in order the application moves to review and can no longer be edited.</p>
        <p>If anything is missing, the application comes back to you with a list of what&apos;s needed.</p>
      </ConfirmModal>
    </>
  );
}
