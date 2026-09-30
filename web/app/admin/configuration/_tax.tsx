"use client";

import { useState } from "react";
import { Button, Card, Chip, Empty, ErrorNote, Field, Input, Modal, Segmented, Select, Table } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { adminApi, useAdminQuery } from "@/components/admin/data";
import { Bool, Country, FilterBar, FilterSelect, Loadable, Mono, Notice, SkeletonRows } from "@/components/admin/kit";
import { useAdmin } from "@/components/admin/session";
import type { CountryCapability, ListResponse, TaxRule } from "@/components/admin/types";
import { date, flag } from "@/lib/format";
import { AuditedNote, bpsFromPct, pctFromBps, pctInput, VersionChip } from "./_shared";

type Draft = { country: string; tax_category: string; customer_type: string; tax_type: string; rate: string; reverse_charge: boolean; label: string; effective_from: string };

/** JSON body of POST /config/tax_rules. `ReverseChargeB2B` becomes `reverse_charge_b2_b` under the API's snake_case_lower policy. */
type TaxBody = {
  country: string;
  tax_category: string | null;
  customer_type: string | null;
  tax_type: string;
  rate_bps: number;
  reverse_charge_b2_b: boolean;
  label: string;
  effective_from: string | null;
};

const CUSTOMER_TYPES = [
  { value: "", label: "All customers" },
  { value: "b2c", label: "Consumers (B2C)" },
  { value: "b2b", label: "Businesses (B2B)" },
];

function allOr(v: string, all: string) {
  return !v || v === "*" ? <span className="text-muted">{all}</span> : <span>{v.replace(/_/g, " ")}</span>;
}

function customerLabel(v: string) {
  return v === "b2b" ? "Businesses (B2B)" : v === "b2c" ? "Consumers (B2C)" : v === "*" || !v ? "All customers" : v;
}

function RuleStatus({ r, now }: { r: TaxRule; now: number }) {
  const from = new Date(r.effective_from).getTime();
  if (from > now) return <Chip tone="sky">Starts {date(r.effective_from)}</Chip>;
  if (!r.effective_to) return <Chip tone="sage">Current</Chip>;
  const to = new Date(r.effective_to).getTime();
  if (to > now) return <Chip tone="lemon-soft">Until {date(r.effective_to)}</Chip>;
  return <Chip tone="neutral">Ended {date(r.effective_to)}</Chip>;
}

function validate(d: Draft): { body: TaxBody | null; errors: Partial<Record<keyof Draft, string>> } {
  const errors: Partial<Record<keyof Draft, string>> = {};
  const country = d.country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) errors.country = "Choose a country.";
  const taxType = d.tax_type.trim().toUpperCase();
  if (!/^[A-Z_]{2,20}$/.test(taxType)) errors.tax_type = "e.g. VAT, GST, SALES_TAX";
  const rate = bpsFromPct(d.rate);
  if (rate === null) errors.rate = "Enter a rate such as 19 or 7.5 (up to two decimals).";
  const label = d.label.trim();
  if (label.length < 2) errors.label = "Shown on invoices, e.g. \"VAT 19%\".";
  if (d.effective_from && !/^\d{4}-\d{2}-\d{2}$/.test(d.effective_from)) errors.effective_from = "Pick a date.";
  if (Object.keys(errors).length) return { body: null, errors };
  return {
    body: {
      country,
      tax_category: d.tax_category.trim().toLowerCase() || null,
      customer_type: d.customer_type || null,
      tax_type: taxType,
      rate_bps: rate!,
      reverse_charge_b2_b: d.reverse_charge,
      label,
      effective_from: d.effective_from ? `${d.effective_from}T00:00:00Z` : null,
    },
    errors,
  };
}

export function TaxTab({ canManage }: { canManage: boolean }) {
  const q = useAdminQuery<ListResponse<TaxRule>>("/config/tax_rules");
  const countries = useAdminQuery<ListResponse<CountryCapability>>("/config/countries");
  const [country, setCountry] = useState("");
  const [view, setView] = useState<"current" | "all">("current");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Captured once per mount: statuses compare against "now" without reading the clock during render.
  const [now] = useState(() => Date.now());
  const names = new Map((countries.data?.data ?? []).map((c) => [c.country, c.name]));

  const all = q.data?.data ?? [];
  const codes = [...new Set(all.map((r) => r.country))].sort();
  const visible = all.filter((r) => (!country || r.country === country) && (view === "all" || !r.effective_to || new Date(r.effective_to).getTime() > now));
  const groups = codes
    .map((c) => ({
      code: c,
      rules: visible
        .filter((r) => r.country === c)
        .sort((a, b) => a.tax_category.localeCompare(b.tax_category) || a.customer_type.localeCompare(b.customer_type) || b.version - a.version),
    }))
    .filter((g) => g.rules.length);

  const startDraft = (r?: TaxRule, code?: string) =>
    setDraft(
      r
        ? {
            country: r.country,
            tax_category: r.tax_category === "*" ? "" : r.tax_category,
            customer_type: r.customer_type === "*" ? "" : r.customer_type,
            tax_type: r.tax_type,
            rate: pctInput(r.rate_bps),
            reverse_charge: r.reverse_charge_b2_b,
            label: r.label,
            effective_from: "",
          }
        : { country: code ?? "", tax_category: "", customer_type: "", tax_type: "VAT", rate: "", reverse_charge: false, label: "", effective_from: "" },
    );

  return (
    <Card>
      <CardHeader
        title="Tax rules"
        subtitle="The most specific rule in effect on the invoice date applies (category, then customer type, then version). Rules are end-dated, never edited, so historical invoices keep their rule."
        action={
          canManage && (
            <Button size="sm" onClick={() => startDraft(undefined, country)}>
              Add new version
            </Button>
          )
        }
      />
      <FilterBar>
        <FilterSelect
          label="Country"
          value={country}
          onChange={setCountry}
          options={[{ value: "", label: "All countries" }, ...codes.map((c) => ({ value: c, label: `${flag(c)} ${names.get(c) ?? c}` }))]}
        />
        <div className="flex flex-col gap-1">
          <span className="pl-2 text-[11.5px] text-muted">Show</span>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "current", label: "In effect" },
              { value: "all", label: "All versions" },
            ]}
          />
        </div>
      </FilterBar>
      {notice && (
        <div className="mb-4">
          <Notice>{notice}</Notice>
        </div>
      )}
      <Loadable q={q} skeleton={<SkeletonRows rows={6} />}>
        {() =>
          groups.length === 0 ? (
            <Empty title="No tax rules match">{country ? "No rules for this country yet." : "No tax rules are configured."}</Empty>
          ) : (
            <div className="space-y-6">
              {groups.map((g) => (
                <section key={g.code}>
                  <h3 className="mb-1 flex items-center gap-2 px-1 text-[14px] font-medium text-text">
                    <span aria-hidden>{flag(g.code)}</span>
                    {names.get(g.code) ?? g.code}
                    <span className="text-[12px] font-normal text-muted">
                      {g.code} · {g.rules.length} rule{g.rules.length === 1 ? "" : "s"}
                    </span>
                  </h3>
                  <Table
                    rows={g.rules}
                    rowKey={(r) => r.id}
                    columns={[
                      { key: "type", header: "Tax type", render: (r) => <Mono>{r.tax_type}</Mono> },
                      { key: "label", header: "Label", render: (r) => <span className="text-text">{r.label}</span> },
                      { key: "rate", header: "Rate", render: (r) => <span className="numeral text-[16px] text-text">{pctFromBps(r.rate_bps)}</span> },
                      { key: "cat", header: "Category", render: (r) => allOr(r.tax_category, "All categories") },
                      { key: "cust", header: "Customer type", render: (r) => (r.customer_type === "*" ? <span className="text-muted">All customers</span> : customerLabel(r.customer_type)) },
                      { key: "rc", header: "B2B reverse charge", render: (r) => <Bool value={r.reverse_charge_b2_b} /> },
                      { key: "v", header: "Version", render: (r) => <VersionChip version={r.version} /> },
                      {
                        key: "eff",
                        header: "Effective",
                        render: (r) => (
                          <span className="whitespace-nowrap text-text-2">
                            {date(r.effective_from)} → {r.effective_to ? date(r.effective_to) : <span className="text-muted">open</span>}
                          </span>
                        ),
                      },
                      { key: "status", header: "Status", render: (r) => <RuleStatus r={r} now={now} /> },
                      ...(canManage
                        ? [
                            {
                              key: "act",
                              header: "",
                              align: "right" as const,
                              render: (r: TaxRule) =>
                                !r.effective_to ? (
                                  <Button size="sm" variant="soft" onClick={() => startDraft(r)}>
                                    New version
                                  </Button>
                                ) : null,
                            },
                          ]
                        : []),
                    ]}
                  />
                </section>
              ))}
            </div>
          )
        }
      </Loadable>
      {draft && (
        <TaxRuleModal
          initial={draft}
          rules={all}
          countries={countries.data?.data ?? []}
          onClose={() => setDraft(null)}
          onDone={(r) => {
            setDraft(null);
            setCountry(r.country);
            setNotice(`${r.label} (v${r.version}) takes effect ${date(r.effective_from)}. The rule it replaces is end-dated on that day and kept.`);
            q.reload();
          }}
        />
      )}
    </Card>
  );
}

function TaxRuleModal({ initial, rules, countries, onClose, onDone }: { initial: Draft; rules: TaxRule[]; countries: CountryCapability[]; onClose: () => void; onDone: (r: TaxRule) => void }) {
  const { guard } = useAdmin();
  const [d, setD] = useState<Draft>(initial);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { body, errors } = validate(d);
  const err = (k: keyof Draft) => (showErrors ? errors[k] ?? null : null);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD((x) => ({ ...x, [k]: e.target.value }));

  const cat = body?.tax_category ?? "*";
  const cust = body?.customer_type ?? "*";
  const prior = body ? rules.filter((r) => r.country === body.country && r.tax_category === cat && r.customer_type === cust && !r.effective_to) : [];
  const nextVersion = prior.reduce((m, r) => Math.max(m, r.version), 0) + 1;
  const effectiveLabel = body?.effective_from ? date(body.effective_from) : "immediately";
  const startsBeforePrior = !!body?.effective_from && prior.some((p) => new Date(p.effective_from) > new Date(body.effective_from!));
  const countryCodes = [...new Set([...countries.map((c) => c.country), ...rules.map((r) => r.country)])].sort();

  const submit = async () => {
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const r = await guard(() => adminApi<TaxRule>("/config/tax_rules", { method: "POST", body }));
      onDone(r);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={step === "edit" ? "New tax rule version" : "Review tax rule"}
      footer={
        step === "edit" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setShowErrors(true);
                if (body && !startsBeforePrior) setStep("review");
              }}
            >
              Review change
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep("edit")} disabled={busy}>
              Back
            </Button>
            <Button onClick={submit} loading={busy}>
              Save version {nextVersion}
            </Button>
          </>
        )
      }
    >
      {step === "edit" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Country" error={err("country")}>
              <Select value={d.country} onChange={set("country")}>
                <option value="">Choose…</option>
                {countryCodes.map((c) => (
                  <option key={c} value={c}>
                    {flag(c)} {countries.find((x) => x.country === c)?.name ?? c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tax category" hint="Empty = all categories, e.g. ebook">
              <Input value={d.tax_category} onChange={set("tax_category")} placeholder="All categories" />
            </Field>
            <Field label="Customer type">
              <Select value={d.customer_type} onChange={set("customer_type")}>
                {CUSTOMER_TYPES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Tax type" error={err("tax_type")}>
              <Input value={d.tax_type} onChange={set("tax_type")} placeholder="VAT" className="uppercase" />
            </Field>
            <Field label="Rate (%)" error={err("rate")} hint="Stored as basis points">
              <Input inputMode="decimal" value={d.rate} onChange={set("rate")} placeholder="19" />
            </Field>
            <Field label="Invoice label" error={err("label")}>
              <Input value={d.label} onChange={set("label")} placeholder="VAT 19%" />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Effective from"
              error={err("effective_from") ?? (startsBeforePrior ? "This is earlier than the start of the rule it replaces. Pick a later date." : null)}
              hint="Empty = immediately. Dates are midnight UTC."
            >
              <Input type="date" value={d.effective_from} onChange={set("effective_from")} />
            </Field>
            <label className="flex items-center gap-3 self-end rounded-[14px] bg-surface-2 px-4 py-3 text-[13.5px] text-text">
              <input type="checkbox" checked={d.reverse_charge} onChange={(e) => setD((x) => ({ ...x, reverse_charge: e.target.checked }))} className="h-4 w-4 accent-sage-700" />
              <span>
                Reverse charge for B2B
                <span className="block text-[12px] text-muted">Business customers with a valid tax id account for the tax themselves.</span>
              </span>
            </label>
          </div>
        </div>
      ) : (
        body && (
          <div className="space-y-4">
            <div className="rounded-inner bg-surface-2 p-5 text-[13.5px]">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Country code={body.country} />
                <Chip tone="neutral">{body.tax_category ?? "All categories"}</Chip>
                <Chip tone="neutral">{customerLabel(body.customer_type ?? "*")}</Chip>
                <VersionChip version={nextVersion} />
              </div>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <span className="numeral text-[26px] text-text">{pctFromBps(body.rate_bps)}</span>
                <span>
                  <Mono>{body.tax_type}</Mono> · “{body.label}”
                </span>
                <span className="text-text-2">B2B reverse charge: {body.reverse_charge_b2_b ? "yes" : "no"}</span>
                <span className="text-text-2">Effective {effectiveLabel}</span>
              </div>
            </div>
            {prior.length > 0 ? (
              <p className="text-[13.5px] leading-relaxed text-text-2">
                The current rule for the same country, category and customer type ({prior.map((p) => `v${p.version} ${p.label}, ${pctFromBps(p.rate_bps)}`).join("; ")}) is end-dated at the effective date,
                never edited, so historical invoices keep their rule.
              </p>
            ) : (
              <p className="text-[13.5px] leading-relaxed text-text-2">No current rule exists for this exact country, category and customer type, so this is version 1. Broader rules keep applying elsewhere.</p>
            )}
            <AuditedNote />
            <ErrorNote error={error} />
          </div>
        )
      )}
    </Modal>
  );
}
