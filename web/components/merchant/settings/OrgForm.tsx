"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { Organization } from "@/lib/merchant/types";
import { Button, Card, CardHeader, ErrorNote, Field, Input, Select, cx } from "@/components/ui";
import { useToast } from "../context";
import { Help } from "../common";
import { Icon } from "../icons";

/** Fallback shown in the colour picker when no brand colour is set yet (the sage accent). */
const DEFAULT_BRAND = "#7dbb78";
const HEX = /^#[0-9a-f]{6}$/i;

type Form = {
  name: string; support_email: string; website: string; brand_color: string; logo_url: string; invoice_prefix: string;
  payout_schedule: string; retry_days: string[]; dunning_final_action: string; dunning_grace_days: string;
};

function fromOrg(o: Organization): Form {
  return {
    name: o.name, support_email: o.support_email ?? "", website: o.website ?? "", brand_color: o.brand_color ?? "", logo_url: o.logo_url ?? "",
    invoice_prefix: o.invoice_prefix, payout_schedule: o.payout_schedule, retry_days: o.dunning_retry_days_csv.split(",").filter(Boolean),
    dunning_final_action: o.dunning_final_action, dunning_grace_days: String(o.dunning_grace_days),
  };
}

export function OrgForm({ org, canEdit, onSaved }: { org: Organization; canEdit: boolean; onSaved: (o: Organization) => void }) {
  const toast = useToast();
  const [f, setF] = useState<Form>(() => fromOrg(org));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  const dayErr = f.retry_days.length < 1 || f.retry_days.some((d) => !/^\d+$/.test(d) || Number(d) < 1 || Number(d) > 30);
  const colorErr = f.brand_color !== "" && !HEX.test(f.brand_color);
  const graceErr = !/^\d+$/.test(f.dunning_grace_days) || Number(f.dunning_grace_days) > 30;
  const invalid = !f.name.trim() || dayErr || colorErr || graceErr || !f.invoice_prefix.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const o = await api<Organization>("/v1/organization", {
        method: "PATCH",
        body: {
          name: f.name.trim(), support_email: f.support_email.trim(), website: f.website.trim(), brand_color: f.brand_color, logo_url: f.logo_url.trim(),
          invoice_prefix: f.invoice_prefix.trim(), payout_schedule: f.payout_schedule, dunning_retry_days_csv: f.retry_days.map(Number).join(","),
          dunning_final_action: f.dunning_final_action, dunning_grace_days: Number(f.dunning_grace_days),
        },
      });
      setF(fromOrg(o));
      onSaved(o);
      toast("Settings saved");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="min-w-0 space-y-5">
      <fieldset disabled={!canEdit} className="min-w-0 space-y-5">
        <Card>
          <CardHeader title="Business profile" subtitle="Shown on checkout, invoices, receipts and the customer portal" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Business name"><Input value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} /></Field>
            <Field label="Support email" hint="Customers reply to this address."><Input type="email" value={f.support_email} onChange={(e) => set("support_email", e.target.value)} /></Field>
            <Field label="Website"><Input type="url" value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://example.com" /></Field>
            <Field label="Logo URL" hint="A square PNG or SVG works best."><Input type="url" value={f.logo_url} onChange={(e) => set("logo_url", e.target.value)} placeholder="https://example.com/logo.png" /></Field>
            <Field label="Brand colour" error={colorErr ? "Use a 6-digit hex colour like #3f7d4a." : null} hint="Accent for buttons on checkout and emails.">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Pick brand colour"
                  value={HEX.test(f.brand_color) ? f.brand_color : DEFAULT_BRAND}
                  onChange={(e) => set("brand_color", e.target.value)}
                  className="h-11 w-14 shrink-0 cursor-pointer rounded-field border border-line bg-surface p-1"
                />
                <Input value={f.brand_color} onChange={(e) => set("brand_color", e.target.value.trim())} placeholder="#3f7d4a" maxLength={7} className="font-mono" />
              </div>
            </Field>
            <Field label="Invoice number prefix" hint={`Invoices are numbered like ${f.invoice_prefix.toUpperCase() || "…"}-00001.`}>
              <Input value={f.invoice_prefix} onChange={(e) => set("invoice_prefix", e.target.value.toUpperCase())} maxLength={8} className="font-mono uppercase" />
            </Field>
          </div>
          {(f.logo_url || HEX.test(f.brand_color)) && (
            <div className="mt-4 flex items-center gap-3 rounded-inner bg-surface-2 p-3">
              {f.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- merchant-supplied external logo preview
                <img src={f.logo_url} alt="Logo preview" className="h-10 w-10 rounded-full border border-line bg-surface object-contain" />
              ) : null}
              <span className="text-[13px] text-text-2">Preview</span>
              {HEX.test(f.brand_color) && <span className="ml-auto rounded-full px-4 py-2 text-[12.5px] font-medium text-white" style={{ background: f.brand_color }}>Pay now</span>}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Payouts" subtitle="How often your available balance is sent to your bank" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Payout schedule" hint={f.payout_schedule === "manual" ? "Nothing is sent until you request a payout." : "Automatic payouts of your available balance."}>
              <Select value={f.payout_schedule} onChange={(e) => set("payout_schedule", e.target.value)}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="manual">Manual</option>
              </Select>
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Failed subscription payments" subtitle="Smart retries (dunning) for renewals that don't go through" />
          <div className="space-y-4">
            <div>
              <span className="mb-1.5 block text-[12.5px] font-medium text-text-2">Retry schedule</span>
              <ol className="flex flex-wrap items-center gap-2">
                {f.retry_days.map((d, i) => (
                  <li key={i} className="flex items-center gap-1 rounded-full bg-surface-2 py-1 pl-3 pr-1">
                    <span className="text-[12px] text-muted">Retry {i + 1} after</span>
                    <input
                      aria-label={`Retry ${i + 1}, days to wait`}
                      inputMode="numeric"
                      value={d}
                      onChange={(e) => set("retry_days", f.retry_days.map((x, j) => (j === i ? e.target.value.replace(/\D/g, "").slice(0, 2) : x)))}
                      className={cx("h-7 w-10 rounded-full border bg-surface text-center text-[13px] outline-none focus:ring-2 focus:ring-sage-100", /^\d+$/.test(d) && +d >= 1 && +d <= 30 ? "border-line" : "border-rose-ink")}
                    />
                    <span className="text-[12px] text-muted">days</span>
                    {f.retry_days.length > 1 && (
                      <button type="button" aria-label={`Remove retry ${i + 1}`} onClick={() => set("retry_days", f.retry_days.filter((_, j) => j !== i))} className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-text">
                        <Icon name="close" size={13} />
                      </button>
                    )}
                  </li>
                ))}
                {f.retry_days.length < 8 && (
                  <li>
                    <Button type="button" size="sm" variant="soft" icon={<Icon name="plus" size={14} />} onClick={() => set("retry_days", [...f.retry_days, "7"])}>Add retry</Button>
                  </li>
                )}
              </ol>
              <p className={cx("mt-1.5 text-[12px]", dayErr ? "text-rose-ink" : "text-muted")} role={dayErr ? "alert" : undefined}>
                Up to 8 retries. Each waits 1–30 days after the previous failed attempt.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="After the last retry fails">
                <Select value={f.dunning_final_action} onChange={(e) => set("dunning_final_action", e.target.value)}>
                  <option value="cancel">Cancel the subscription</option>
                  <option value="leave_past_due">Leave it past due</option>
                </Select>
              </Field>
              <Field label="Grace period (days)" error={graceErr ? "Enter 0–30 days." : null} hint="Extra days a past-due subscriber keeps access.">
                <Input inputMode="numeric" value={f.dunning_grace_days} onChange={(e) => set("dunning_grace_days", e.target.value.replace(/\D/g, "").slice(0, 2))} />
              </Field>
            </div>
          </div>
        </Card>
      </fieldset>

      <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
      {canEdit ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => { setF(fromOrg(org)); setError(null); }}>Discard changes</Button>
          <Button type="submit" loading={busy} disabled={invalid}>Save settings</Button>
        </div>
      ) : (
        <Help>Only owners and admins can change organization settings.</Help>
      )}
    </form>
  );
}
