"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Card, Chip, cx, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Table, Textarea, type Tone } from "@/components/ui";
import { adminApi, useAdminQuery } from "@/components/admin/data";
import { ConfirmDialog, FilterBar, FilterInput, Loadable, Mono, Notice, ReadOnlyNote, When } from "@/components/admin/kit";
import { splitCsv } from "@/components/admin/ops";
import type { FeatureFlag } from "@/components/admin/ops-types";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import type { ListResponse } from "@/components/admin/types";

const KEY_RE = /^[a-z][a-z0-9_]{1,63}$/;
const ENVIRONMENTS = [
  { value: "*", label: "All environments" },
  { value: "Development", label: "Development only" },
  { value: "Production", label: "Production only" },
];

type Draft = { key: string; description: string; enabled: boolean; rollout_percent: number; org_ids: string; countries: string; environment: string };

function toDraft(f: FeatureFlag): Draft {
  return {
    key: f.key,
    description: f.description,
    enabled: f.enabled,
    rollout_percent: f.rollout_percent,
    org_ids: splitCsv(f.org_ids_csv).join(", "),
    countries: splitCsv(f.countries_csv).join(", "),
    environment: f.environment,
  };
}

const CHANGE_LABELS: Record<string, string> = {
  enabled: "Enabled",
  rollout_percent: "Rollout",
  environment: "Environment",
  org_ids: "Merchant allow-list",
  countries: "Countries",
  description: "Description",
};

const BLANK: Draft = { key: "", description: "", enabled: false, rollout_percent: 0, org_ids: "", countries: "", environment: "*" };

function putFlag(key: string, body: Record<string, unknown>) {
  return adminApi<FeatureFlag>(`/feature_flags/${key}`, { method: "PUT", body });
}

/**
 * Plain-language audience, mirroring FlagService.Evaluate on the API:
 * off → nobody; wrong environment → nobody; allow-listed org → on; country list must match;
 * then 100% → everyone, 0% → nobody else, otherwise a stable hash bucket per merchant.
 */
function audience(d: Pick<Draft, "enabled" | "rollout_percent" | "org_ids" | "countries" | "environment">): { headline: string; tone: Tone; lines: string[] } {
  const orgs = splitCsv(d.org_ids);
  const countries = splitCsv(d.countries).map((c) => c.toUpperCase());
  const p = d.rollout_percent;
  const where = d.environment === "*" ? "" : ` · ${d.environment} only`;
  if (!d.enabled) return { headline: "Off for everyone", tone: "neutral", lines: ["The flag is turned off, so nobody gets the feature — not even allow-listed merchants."] };
  const lines: string[] = [];
  lines.push(d.environment === "*" ? "Applies in every environment." : `Applies only in the ${d.environment} environment; everywhere else the feature is off.`);
  if (orgs.length) lines.push(`Always on for ${orgs.length} allow-listed merchant${orgs.length === 1 ? "" : "s"}, regardless of country or rollout.`);
  const others = orgs.length ? "other merchants" : "merchants";
  if (countries.length) lines.push(`${orgs.length ? "Other merchants" : "Merchants"} must be based in ${countries.join(", ")}; users without a merchant account don't get it.`);
  let headline: string;
  let tone: Tone = "sage";
  if (p >= 100) {
    headline = countries.length ? `Merchants in ${countries.join(", ")}` : "On for everyone";
    lines.push(countries.length ? `All ${others} in those countries get it.` : "Everyone gets it, including signed-in users without a merchant account (for example wallet users).");
  } else if (p <= 0) {
    headline = orgs.length ? `${orgs.length} allow-listed merchant${orgs.length === 1 ? "" : "s"} only` : "Nobody";
    tone = orgs.length ? "lemon-soft" : "neutral";
    lines.push(orgs.length ? "Rollout is 0%, so nobody else gets it." : "Rollout is 0% and no merchants are allow-listed, so nobody gets it.");
  } else {
    headline = `${p}% of ${countries.length ? `merchants in ${countries.join(", ")}` : "merchants"}${orgs.length ? ` + ${orgs.length} allow-listed` : ""}`;
    tone = "lemon-soft";
    lines.push(
      `A stable ${p}% of ${others}${countries.length ? " in those countries" : ""} get it. Each merchant is bucketed by its id, so the same merchants keep it as you raise the percentage.${countries.length ? "" : " Users without a merchant account don't get it."}`,
    );
  }
  return { headline: headline + where, tone, lines };
}

export default function FeatureFlagsPage() {
  return (
    <Guard perm="admin.overview">
      <Flags />
    </Guard>
  );
}

function Flags() {
  const { can, guard } = useAdmin();
  const canManage = can("admin.config.manage");
  const canAudit = can("admin.audit.read");
  const q = useAdminQuery<ListResponse<FeatureFlag>>("/feature_flags");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ flag: FeatureFlag | null } | null>(null);
  const [toggling, setToggling] = useState<FeatureFlag | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        eyebrow="Platform configuration"
        title="Feature flags"
        subtitle="Turn features on by environment, merchant allow-list, country and percentage rollout. Changes apply immediately and every change is recorded in the audit log."
        actions={
          canManage ? (
            <Button onClick={() => setEditing({ flag: null })}>New flag</Button>
          ) : (
            <ReadOnlyNote>
              Read-only · changing flags needs <Mono>admin.config.manage</Mono>
            </ReadOnlyNote>
          )
        }
      />
      {notice && (
        <div className="mb-5">
          <Notice>{notice}</Notice>
        </div>
      )}
      <Card>
        <FilterBar>
          <FilterInput label="Filter" value={text} onChange={setText} placeholder="Key or description" width="w-64" />
        </FilterBar>
        <Loadable q={q}>
          {(d) => {
            const needle = text.trim().toLowerCase();
            const rows = d.data.filter((f) => !needle || f.key.includes(needle) || f.description.toLowerCase().includes(needle));
            return (
              <Table
                rows={rows}
                rowKey={(r) => r.id}
                onRowClick={canManage ? (r) => setEditing({ flag: r }) : undefined}
                empty={<Empty title={d.data.length ? "No flags match" : "No feature flags yet"}>{d.data.length ? "Try another filter." : "Create a flag to gate a feature."}</Empty>}
                columns={[
                  {
                    key: "key",
                    header: "Flag",
                    render: (r) => (
                      <div className="min-w-0 max-w-[300px]">
                        <Mono className="text-[12.5px] text-text">{r.key}</Mono>
                        <div className="mt-0.5 text-[12.5px] text-muted">{r.description || <span className="text-faint">No description</span>}</div>
                      </div>
                    ),
                  },
                  {
                    key: "enabled",
                    header: "State",
                    render: (r) =>
                      canManage ? (
                        <Switch
                          on={r.enabled}
                          label={`${r.enabled ? "Turn off" : "Turn on"} ${r.key}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setToggling(r);
                          }}
                        />
                      ) : (
                        <Chip tone={r.enabled ? "sage" : "neutral"}>{r.enabled ? "On" : "Off"}</Chip>
                      ),
                  },
                  {
                    key: "who",
                    header: "Who gets it",
                    render: (r) => {
                      const a = audience(toDraft(r));
                      return <Chip tone={a.tone}>{a.headline}</Chip>;
                    },
                  },
                  { key: "rollout", header: "Rollout", render: (r) => <Rollout p={r.rollout_percent} dim={!r.enabled} /> },
                  { key: "updated", header: "Updated", render: (r) => <When at={r.updated_at} rel /> },
                  {
                    key: "actions",
                    header: "",
                    align: "right",
                    render: (r) => (
                      <span className="inline-flex items-center gap-1.5">
                        {canAudit && (
                          <Link
                            href={`/admin/audit?object=${r.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex h-8 items-center rounded-full px-3 text-[12.5px] text-text-2 hover:bg-surface-3"
                          >
                            History
                          </Link>
                        )}
                        {canManage && (
                          <Button
                            size="sm"
                            variant="soft"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditing({ flag: r });
                            }}
                          >
                            Edit
                          </Button>
                        )}
                      </span>
                    ),
                  },
                ]}
              />
            );
          }}
        </Loadable>
      </Card>

      {editing && (
        <FlagEditor
          flag={editing.flag}
          existing={q.data?.data.map((f) => f.key) ?? []}
          canAudit={canAudit}
          onClose={() => setEditing(null)}
          onSaved={(f, created) => {
            setNotice(`${created ? "Created" : "Saved"} ${f.key}: ${audience(toDraft(f)).headline}. Recorded in the audit log as config.feature_flag.`);
            q.reload();
          }}
        />
      )}
      <ConfirmDialog
        open={toggling !== null}
        onClose={() => setToggling(null)}
        title={toggling ? `${toggling.enabled ? "Turn off" : "Turn on"} ${toggling.key}?` : ""}
        confirmLabel={toggling?.enabled ? "Turn off" : "Turn on"}
        tone={toggling?.enabled ? "danger" : "ink"}
        onConfirm={async () => {
          const f = toggling!;
          const saved = await guard(() => putFlag(f.key, { enabled: !f.enabled }));
          setNotice(`${saved.key} is now ${saved.enabled ? "on" : "off"}: ${audience(toDraft(saved)).headline}. Recorded in the audit log.`);
          q.reload();
        }}
      >
        {toggling && (
          <>
            <p>The change applies immediately to every request.</p>
            <div className="rounded-inner bg-surface-2 p-4">
              <div className="text-[12px] text-muted">After this change</div>
              <div className="mt-1 text-[13.5px] font-medium text-text">{audience({ ...toDraft(toggling), enabled: !toggling.enabled }).headline}</div>
            </div>
          </>
        )}
      </ConfirmDialog>
    </>
  );
}

function Switch({ on, label, onClick, disabled }: { on: boolean; label: string; onClick: (e: React.MouseEvent) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx("relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50", on ? "bg-sage-500" : "bg-surface-3")}
    >
      <span className={cx("absolute top-1 h-5 w-5 rounded-full bg-white shadow-card transition-all", on ? "left-6" : "left-1")} />
    </button>
  );
}

function Rollout({ p, dim }: { p: number; dim?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-2", dim && "opacity-50")}>
      <span className="h-2 w-20 rounded-full bg-surface-3">
        <span className="block h-2 rounded-full bg-sage-300" style={{ width: `${Math.max(0, Math.min(100, p))}%` }} />
      </span>
      <span className="numeral w-10 text-[13px] text-text">{p}%</span>
    </span>
  );
}

function FlagEditor({
  flag,
  existing,
  canAudit,
  onClose,
  onSaved,
}: {
  flag: FeatureFlag | null;
  existing: string[];
  canAudit: boolean;
  onClose: () => void;
  onSaved: (f: FeatureFlag, created: boolean) => void;
}) {
  const { guard } = useAdmin();
  const creating = flag === null;
  const original = flag ? toDraft(flag) : BLANK;
  const [d, setD] = useState<Draft>(original);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const key = d.key.trim();
  const keyError = creating && key ? (!KEY_RE.test(key) ? "Lowercase snake_case: a letter first, then letters, digits or _ (2–64 characters)." : existing.includes(key) ? "A flag with this key already exists — edit it instead." : null) : null;
  const countries = splitCsv(d.countries).map((c) => c.toUpperCase());
  const badCountries = countries.filter((c) => !/^[A-Z]{2}$/.test(c));
  const orgs = splitCsv(d.org_ids);
  const badOrgs = orgs.filter((o) => !/^org_[A-Za-z0-9]+$/.test(o));
  const rolloutOk = Number.isInteger(d.rollout_percent) && d.rollout_percent >= 0 && d.rollout_percent <= 100;

  const changes: [string, string, string][] = [];
  const fmt = (k: keyof Draft, v: Draft[keyof Draft]) =>
    k === "enabled" ? (v ? "on" : "off") : k === "rollout_percent" ? `${v}%` : k === "environment" ? ENVIRONMENTS.find((e) => e.value === v)?.label ?? String(v) : String(v) || "none";
  (["enabled", "rollout_percent", "environment", "org_ids", "countries", "description"] as const).forEach((k) => {
    const a = k === "countries" ? splitCsv(original.countries).map((c) => c.toUpperCase()).join(", ") : k === "org_ids" ? splitCsv(original.org_ids).join(", ") : original[k];
    const b = k === "countries" ? countries.join(", ") : k === "org_ids" ? orgs.join(", ") : k === "description" ? d.description.trim() : d[k];
    if (a !== b) changes.push([CHANGE_LABELS[k], fmt(k, a), fmt(k, b)]);
  });

  const valid = (!creating || (key && !keyError)) && rolloutOk && badCountries.length === 0 && badOrgs.length === 0 && d.description.trim().length > 0;
  const a = audience({ ...d, rollout_percent: rolloutOk ? d.rollout_percent : 0 });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await guard(() =>
        putFlag(creating ? key : flag!.key, {
          description: d.description.trim(),
          enabled: d.enabled,
          rollout_percent: d.rollout_percent,
          org_ids: orgs.join(","),
          countries: countries.join(","),
          environment: d.environment,
        }),
      );
      onSaved(saved, creating);
      onClose();
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
      title={creating ? "New feature flag" : <Mono className="text-[18px] text-text">{flag!.key}</Mono>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={!valid || (!creating && changes.length === 0)}>
            {creating ? "Create flag" : "Save changes"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {creating && (
            <Field label="Key" error={keyError} hint="Used in code, e.g. new_checkout. Can't be renamed later.">
              <Input autoFocus value={d.key} onChange={(e) => set("key", e.target.value.toLowerCase())} placeholder="snake_case_key" className="font-mono" />
            </Field>
          )}
          <Field label="Description" hint="What the flag gates, for the people reading this list later.">
            <Input autoFocus={!creating} value={d.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <div className="flex items-center justify-between gap-4 rounded-inner bg-surface-2 px-4 py-3">
            <span>
              <span className="block text-[13.5px] font-medium text-text">Enabled</span>
              <span className="block text-[12px] text-muted">Off overrides everything below.</span>
            </span>
            <Switch on={d.enabled} label="Enabled" onClick={() => set("enabled", !d.enabled)} />
          </div>
          <Field label={`Rollout · ${rolloutOk ? d.rollout_percent : "?"}%`} error={rolloutOk ? null : "Whole number from 0 to 100."}>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={rolloutOk ? d.rollout_percent : 0}
                onChange={(e) => set("rollout_percent", Number(e.target.value))}
                className="h-2 flex-1 accent-[var(--ink)]"
                aria-label="Rollout percent"
              />
              <Input
                type="number"
                min={0}
                max={100}
                value={Number.isNaN(d.rollout_percent) ? "" : d.rollout_percent}
                onChange={(e) => set("rollout_percent", e.target.value === "" ? NaN : Number(e.target.value))}
                className="!w-20 text-right"
              />
            </div>
          </Field>
          <Field label="Environment">
            <Select value={d.environment} onChange={(e) => set("environment", e.target.value)}>
              {ENVIRONMENTS.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
              {!ENVIRONMENTS.some((e) => e.value === d.environment) && <option value={d.environment}>{d.environment} (unrecognised — matches no environment)</option>}
            </Select>
          </Field>
          <Field
            label="Merchant allow-list"
            error={badOrgs.length ? `Not an org id: ${badOrgs.join(", ")}` : null}
            hint="Comma-separated org ids. Listed merchants always get the feature while it's enabled."
          >
            <Textarea value={d.org_ids} onChange={(e) => set("org_ids", e.target.value)} placeholder="org_…, org_…" className="min-h-16 font-mono text-[13px]" />
          </Field>
          <Field
            label="Countries"
            error={badCountries.length ? `Use 2-letter ISO codes: ${badCountries.join(", ")}` : null}
            hint="Comma-separated ISO codes (US, GB, IN). Empty means every country."
          >
            <Input value={d.countries} onChange={(e) => set("countries", e.target.value)} placeholder="US, GB" />
          </Field>
        </div>

        <div className="space-y-4">
          <div className="rounded-inner bg-surface-2 p-5">
            <div className="text-[12px] text-muted">Who gets this feature</div>
            <div className="mt-2">
              <Chip tone={a.tone} className="!text-[12.5px]">
                {a.headline}
              </Chip>
            </div>
            <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-text-2">
              {a.lines.map((l) => (
                <li key={l} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sage-500" />
                  {l}
                </li>
              ))}
            </ul>
          </div>
          {!creating && (
            <div className="rounded-inner border border-line p-5">
              <div className="text-[12px] text-muted">Changes</div>
              {changes.length === 0 ? (
                <p className="mt-1.5 text-[13px] text-faint">No changes yet.</p>
              ) : (
                <ul className="mt-2 space-y-1.5 text-[13px]">
                  {changes.map(([k, from, to]) => (
                    <li key={k} className="flex flex-wrap items-baseline gap-1.5">
                      <span className="text-text-2">{k}</span>
                      <span className="text-muted line-through decoration-faint">{from}</span>
                      <span className="text-muted">→</span>
                      <span className="text-text">{to}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[12px] text-muted">
                Saving applies immediately and is audited as <Mono>config.feature_flag</Mono>
                {canAudit && flag && (
                  <>
                    {" "}
                    ·{" "}
                    <Link href={`/admin/audit?object=${flag.id}`} className="text-text underline decoration-line-strong underline-offset-4">
                      view history
                    </Link>
                  </>
                )}
                .
              </p>
            </div>
          )}
          {creating && <Notice tone="lemon">New flags start off by default. Turn it on here or later from the list.</Notice>}
          <ErrorNote error={error} />
        </div>
      </div>
    </Modal>
  );
}
