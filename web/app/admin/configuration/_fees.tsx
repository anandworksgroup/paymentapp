"use client";

import { useState } from "react";
import { Amount, Button, Card, Chip, Empty, ErrorNote, Field, Input, Modal, Segmented, Table } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { adminApi, useAdminQuery } from "@/components/admin/data";
import { Country, EntityLink, humanize, Loadable, Mono, Notice, SkeletonRows, When } from "@/components/admin/kit";
import { useAdmin } from "@/components/admin/session";
import type { FeeSchedule, ListResponse } from "@/components/admin/types";
import { money } from "@/lib/format";
import { AuditedNote, majorInput, minorFromMajor, pctFromBps, pctInput, bpsFromPct, VersionChip } from "./_shared";

type Draft = {
  org_id: string;
  country: string;
  method: string;
  percent: string;
  fixed: string;
  fixed_currency: string;
  minimum: string;
  maximum: string;
  international: string;
};

type FeeBody = {
  org_id: string | null;
  country: string | null;
  method: string | null;
  percent_bps: number;
  fixed_minor: number;
  fixed_currency: string;
  minimum_minor: number | null;
  maximum_minor: number | null;
  international_bps: number;
};

const BLANK: Draft = { org_id: "", country: "", method: "", percent: "", fixed: "0.00", fixed_currency: "USD", minimum: "", maximum: "", international: "0" };

function fromSchedule(f: FeeSchedule): Draft {
  return {
    org_id: f.org_id ?? "",
    country: f.country ?? "",
    method: f.method ?? "",
    percent: pctInput(f.percent_bps),
    fixed: majorInput(f.fixed_minor, f.fixed_currency),
    fixed_currency: f.fixed_currency,
    minimum: majorInput(f.minimum_minor, f.fixed_currency),
    maximum: majorInput(f.maximum_minor, f.fixed_currency),
    international: pctInput(f.international_bps),
  };
}

function sameScope(a: { org_id: string | null; country: string | null; method: string | null }, b: { org_id: string | null; country: string | null; method: string | null }) {
  return (a.org_id ?? null) === (b.org_id ?? null) && (a.country ?? null) === (b.country ?? null) && (a.method ?? null) === (b.method ?? null);
}

export function Scope({ s }: { s: { org_id: string | null; country: string | null; method: string | null } }) {
  if (!s.org_id && !s.country && !s.method) return <Chip tone="lemon-soft">Platform default</Chip>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {s.org_id && <EntityLink type="org" id={s.org_id} />}
      {s.country && <Country code={s.country} />}
      {s.method && <Chip tone="neutral">{humanize(s.method)}</Chip>}
    </span>
  );
}

function validate(d: Draft): { body: FeeBody | null; errors: Partial<Record<keyof Draft, string>> } {
  const errors: Partial<Record<keyof Draft, string>> = {};
  const currency = d.fixed_currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.fixed_currency = "Use a three-letter currency code, e.g. USD.";
  const country = d.country.trim().toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) errors.country = "Use a two-letter country code, e.g. DE.";
  const org = d.org_id.trim();
  if (org && !org.startsWith("org_")) errors.org_id = "Organization ids start with org_.";
  const percent = bpsFromPct(d.percent);
  if (percent === null) errors.percent = "Enter a percentage such as 2.9 (up to two decimals).";
  const intl = d.international.trim() === "" ? 0 : bpsFromPct(d.international);
  if (intl === null) errors.international = "Enter a percentage such as 1.5, or 0.";
  const cur = errors.fixed_currency ? "USD" : currency;
  const fixed = minorFromMajor(d.fixed || "0", cur);
  if (fixed === null) errors.fixed = `Enter an amount in ${cur}, e.g. 0.30.`;
  const min = d.minimum.trim() ? minorFromMajor(d.minimum, cur) : null;
  if (d.minimum.trim() && min === null) errors.minimum = "Enter an amount or leave empty.";
  const max = d.maximum.trim() ? minorFromMajor(d.maximum, cur) : null;
  if (d.maximum.trim() && max === null) errors.maximum = "Enter an amount or leave empty.";
  if (min !== null && max !== null && max < min) errors.maximum = "The maximum must be at least the minimum.";
  if (Object.keys(errors).length) return { body: null, errors };
  return {
    body: {
      org_id: org || null,
      country: country || null,
      method: d.method.trim().toLowerCase() || null,
      percent_bps: percent!,
      fixed_minor: fixed!,
      fixed_currency: currency,
      minimum_minor: min,
      maximum_minor: max,
      international_bps: intl!,
    },
    errors,
  };
}

export function FeesTab({ canManage }: { canManage: boolean }) {
  const q = useAdminQuery<ListResponse<FeeSchedule>>("/config/fees");
  const [view, setView] = useState<"active" | "all">("active");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const all = q.data?.data ?? [];
  const rows = [...all]
    .filter((f) => view === "all" || f.active)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.priority - b.priority || b.version - a.version);

  return (
    <Card>
      <CardHeader
        title="Fee schedules"
        subtitle="The most specific active schedule applies: organization, then payment method, then country, then priority. Percentages are of the charge; the fixed fee converts to the charge currency."
        action={
          <div className="flex items-center gap-2">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "active", label: "Active" },
                { value: "all", label: "All versions" },
              ]}
            />
            {canManage && (
              <Button size="sm" onClick={() => setDraft(BLANK)}>
                New schedule
              </Button>
            )}
          </div>
        }
      />
      {notice && (
        <div className="mb-4">
          <Notice>{notice}</Notice>
        </div>
      )}
      <Loadable q={q} skeleton={<SkeletonRows rows={3} />}>
        {() => (
          <Table
            rows={rows}
            rowKey={(r) => r.id}
            empty={<Empty title="No fee schedules">Without an active platform default, payments can&apos;t be priced. Add one to start.</Empty>}
            columns={[
              { key: "scope", header: "Scope", render: (r) => <Scope s={r} /> },
              { key: "pct", header: "Percentage", render: (r) => <span className="numeral text-[16px] text-text">{pctFromBps(r.percent_bps)}</span> },
              { key: "fixed", header: "Fixed fee", render: (r) => <Amount minor={r.fixed_minor} currency={r.fixed_currency} size="sm" /> },
              {
                key: "minmax",
                header: "Min / max",
                render: (r) =>
                  r.minimum_minor === null && r.maximum_minor === null ? (
                    <span className="text-muted">No bounds</span>
                  ) : (
                    <span className="whitespace-nowrap text-text-2">
                      {r.minimum_minor !== null ? money(r.minimum_minor, r.fixed_currency) : "—"} / {r.maximum_minor !== null ? money(r.maximum_minor, r.fixed_currency) : "—"}
                    </span>
                  ),
              },
              { key: "intl", header: "International", render: (r) => (r.international_bps ? <Chip tone="peach">+{pctFromBps(r.international_bps)}</Chip> : <span className="text-muted">None</span>) },
              { key: "priority", header: "Priority", render: (r) => <Mono>{r.priority}</Mono> },
              { key: "version", header: "Version", render: (r) => <VersionChip version={r.version} /> },
              { key: "status", header: "Status", render: (r) => (r.active ? <Chip tone="sage">Active</Chip> : <Chip tone="neutral">Superseded</Chip>) },
              { key: "created", header: "Created", render: (r) => <When at={r.created_at} /> },
              ...(canManage
                ? [
                    {
                      key: "act",
                      header: "",
                      align: "right" as const,
                      render: (r: FeeSchedule) =>
                        r.active ? (
                          <Button size="sm" variant="soft" onClick={() => setDraft(fromSchedule(r))}>
                            New version
                          </Button>
                        ) : null,
                    },
                  ]
                : []),
            ]}
          />
        )}
      </Loadable>
      {draft && (
        <FeeVersionModal
          initial={draft}
          schedules={all}
          onClose={() => setDraft(null)}
          onDone={(f) => {
            setDraft(null);
            setNotice(`Version ${f.version} is now active for this scope. The previous version is kept as superseded.`);
            q.reload();
          }}
        />
      )}
    </Card>
  );
}

function FeeVersionModal({ initial, schedules, onClose, onDone }: { initial: Draft; schedules: FeeSchedule[]; onClose: () => void; onDone: (f: FeeSchedule) => void }) {
  const { guard } = useAdmin();
  const [d, setD] = useState<Draft>(initial);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { body, errors } = validate(d);
  const err = (k: keyof Draft) => (showErrors ? errors[k] ?? null : null);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setD((x) => ({ ...x, [k]: e.target.value }));

  const prior = body ? schedules.filter((s) => s.active && sameScope(s, body)) : [];
  const nextVersion = prior.reduce((m, s) => Math.max(m, s.version), 0) + 1;

  const submit = async () => {
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const f = await guard(() => adminApi<FeeSchedule>("/config/fees", { method: "POST", body }));
      onDone(f);
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
      title={step === "edit" ? "New fee schedule version" : "Review fee schedule"}
      footer={
        step === "edit" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setShowErrors(true);
                if (body) setStep("review");
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
        <div className="space-y-5">
          <div>
            <div className="mb-2 text-[13px] font-medium text-text">Scope</div>
            <p className="mb-3 text-[12.5px] text-muted">Leave all three empty for the platform default. A schedule applies to charges that match every field you fill in.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Organization id" error={err("org_id")} hint="Optional">
                <Input value={d.org_id} onChange={set("org_id")} placeholder="org_…" />
              </Field>
              <Field label="Customer country" error={err("country")} hint="Optional, e.g. DE">
                <Input value={d.country} onChange={set("country")} maxLength={2} placeholder="Any" className="uppercase" />
              </Field>
              <Field label="Payment method" hint="Optional, e.g. card, upi">
                <Input value={d.method} onChange={set("method")} placeholder="Any" />
              </Field>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Percentage fee (%)" error={err("percent")} hint="e.g. 2.9 for 2.9% — stored as basis points">
              <Input inputMode="decimal" value={d.percent} onChange={set("percent")} placeholder="2.9" />
            </Field>
            <Field label="International surcharge (%)" error={err("international")} hint="Added when the customer country differs from the merchant's">
              <Input inputMode="decimal" value={d.international} onChange={set("international")} placeholder="0" />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Fixed fee" error={err("fixed")}>
              <Input inputMode="decimal" value={d.fixed} onChange={set("fixed")} placeholder="0.30" />
            </Field>
            <Field label="Currency" error={err("fixed_currency")}>
              <Input value={d.fixed_currency} onChange={set("fixed_currency")} maxLength={3} className="uppercase" />
            </Field>
            <Field label="Minimum fee" error={err("minimum")} hint="Optional">
              <Input inputMode="decimal" value={d.minimum} onChange={set("minimum")} placeholder="None" />
            </Field>
            <Field label="Maximum fee" error={err("maximum")} hint="Optional">
              <Input inputMode="decimal" value={d.maximum} onChange={set("maximum")} placeholder="None" />
            </Field>
          </div>
          <p className="text-[12px] text-muted">Amounts are in major units of the fee currency and are stored as integer minor units.</p>
        </div>
      ) : (
        body && (
          <div className="space-y-4">
            <div className="rounded-inner bg-surface-2 p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Scope s={body} />
                <VersionChip version={nextVersion} />
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13.5px] sm:grid-cols-3">
                <div>
                  <dt className="text-[12px] text-muted">Percentage</dt>
                  <dd>
                    {pctFromBps(body.percent_bps)} <span className="text-muted">({body.percent_bps} bps)</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">Fixed fee</dt>
                  <dd>
                    <Amount minor={body.fixed_minor} currency={body.fixed_currency} size="sm" />
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">International</dt>
                  <dd>{body.international_bps ? `+${pctFromBps(body.international_bps)}` : "None"}</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">Minimum</dt>
                  <dd>{body.minimum_minor !== null ? money(body.minimum_minor, body.fixed_currency, { code: true }) : "None"}</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">Maximum</dt>
                  <dd>{body.maximum_minor !== null ? money(body.maximum_minor, body.fixed_currency, { code: true }) : "None"}</dd>
                </div>
              </dl>
            </div>
            {prior.length > 0 ? (
              <p className="text-[13.5px] leading-relaxed text-text-2">
                The active schedule for this scope ({prior.map((p) => `v${p.version}: ${pctFromBps(p.percent_bps)} + ${money(p.fixed_minor, p.fixed_currency, { code: true })}`).join(", ")}) will be
                deactivated and kept as a superseded version. Charges priced from now on use version {nextVersion}; past charges keep the fee they were priced with.
              </p>
            ) : (
              <p className="text-[13.5px] leading-relaxed text-text-2">There is no active schedule for this exact scope yet, so this becomes version 1. More general schedules stay active and keep applying to other charges.</p>
            )}
            {prior.some((p) => p.priority !== 100) && (
              <p className="text-[12.5px] text-muted">
                Priority is not part of this form: the new version is saved with the default priority 100 (the current version has {prior.map((p) => p.priority).join(", ")}). Priority only breaks ties between
                equally specific schedules.
              </p>
            )}
            <AuditedNote />
            <ErrorNote error={error} />
          </div>
        )
      )}
    </Modal>
  );
}
