"use client";

import { useState } from "react";
import { Button, Card, Chip, cx, Empty, Field, Input, Select } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { adminApi, useAdminQuery } from "@/components/admin/data";
import { ConfirmDialog, humanize, Loadable, Mono, Notice, SkeletonRows } from "@/components/admin/kit";
import { useAdmin } from "@/components/admin/session";
import type { ListResponse, MonitoringRule } from "@/components/admin/types";
import { AuditedNote, ChangeLine, onOff, paramHint, Switch, VersionChip } from "./_shared";

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const ACTIONS = [
  { value: "alert", label: "Raise an alert only", short: "Alert only" },
  { value: "hold", label: "Hold the transaction for review", short: "Hold for review" },
];

type RulePatch = { enabled?: boolean; severity?: string; action?: string; params?: Record<string, number> };

export function RulesTab({ canManage }: { canManage: boolean }) {
  const q = useAdminQuery<ListResponse<MonitoringRule>>("/config/monitoring_rules");
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader
        title="Transaction monitoring rules"
        subtitle="Rules raise alerts for review; “hold” also pauses the transaction until someone reviews it. An alert is a signal, not a finding."
      />
      {notice && (
        <div className="mb-4">
          <Notice>{notice}</Notice>
        </div>
      )}
      <Loadable q={q} skeleton={<SkeletonRows rows={4} />}>
        {(d) =>
          d.data.length === 0 ? (
            <Empty title="No monitoring rules">No rules are configured on this platform.</Empty>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {d.data.map((r) => (
                // Remount on a new version so the form starts from the saved values.
                <RuleCard
                  key={`${r.key}:${r.version}`}
                  rule={r}
                  canManage={canManage}
                  onSaved={(saved) => {
                    setNotice(`${saved.name} saved as version ${saved.version}. New alerts from this rule record version ${saved.version}.`);
                    q.reload();
                  }}
                />
              ))}
            </div>
          )
        }
      </Loadable>
    </Card>
  );
}

function RuleCard({ rule, canManage, onSaved }: { rule: MonitoringRule; canManage: boolean; onSaved: (r: MonitoringRule) => void }) {
  const { guard } = useAdmin();
  const params = rule.params ?? {};
  const [enabled, setEnabled] = useState(rule.enabled);
  const [severity, setSeverity] = useState(rule.severity);
  const [action, setAction] = useState(rule.action);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));
  const [confirm, setConfirm] = useState(false);

  // Parameters are stored as whole numbers (the API reads them as 64-bit integers).
  const parsed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, /^\d+$/.test(v.trim()) ? Number(v.trim()) : null])) as Record<string, number | null>;
  const invalid = Object.entries(parsed).filter(([, v]) => v === null).map(([k]) => k);
  const changedParams = Object.fromEntries(Object.entries(parsed).filter(([k, v]) => v !== null && v !== params[k])) as Record<string, number>;

  const patch: RulePatch = {};
  if (enabled !== rule.enabled) patch.enabled = enabled;
  if (severity !== rule.severity) patch.severity = severity;
  if (action !== rule.action) patch.action = action;
  if (Object.keys(changedParams).length) patch.params = changedParams;
  const dirty = Object.keys(patch).length > 0;

  const reset = () => {
    setEnabled(rule.enabled);
    setSeverity(rule.severity);
    setAction(rule.action);
    setValues(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));
  };

  return (
    <div className={cx("rounded-inner bg-surface-2 p-5", !rule.enabled && "opacity-90")}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-medium text-text">{rule.name}</h3>
            <VersionChip version={rule.version} />
            {!rule.enabled && <Chip tone="neutral">Disabled</Chip>}
          </div>
          <Mono className="text-muted">{rule.key}</Mono>
          <p className="mt-1 text-[13px] text-text-2">{rule.description}</p>
        </div>
        <Switch checked={enabled} onChange={setEnabled} disabled={!canManage} label={`${rule.name} enabled`} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Severity">
          <Select value={severity} onChange={(e) => setSeverity(e.target.value)} disabled={!canManage}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
            {!SEVERITIES.includes(rule.severity as (typeof SEVERITIES)[number]) && <option value={rule.severity}>{rule.severity}</option>}
          </Select>
        </Field>
        <Field label="When it matches">
          <Select value={action} onChange={(e) => setAction(e.target.value)} disabled={!canManage}>
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {Object.keys(params).length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Object.keys(params).map((k) => (
            <Field key={k} label={humanize(k)} error={invalid.includes(k) ? "Whole numbers only." : null} hint={paramHint(k, parsed[k]) ?? undefined}>
              <Input inputMode="numeric" value={values[k] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} disabled={!canManage} />
            </Field>
          ))}
        </div>
      )}

      {canManage && (
        <div className="mt-4 flex items-center justify-end gap-2">
          {dirty && <span className="mr-auto text-[12px] text-muted">Unsaved changes</span>}
          <Button size="sm" variant="ghost" onClick={reset} disabled={!dirty}>
            Reset
          </Button>
          <Button size="sm" onClick={() => setConfirm(true)} disabled={!dirty || invalid.length > 0}>
            Save as v{rule.version + 1}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Save ${rule.name}?`}
        confirmLabel={`Save version ${rule.version + 1}`}
        onConfirm={async () => {
          const saved = await guard(() => adminApi<MonitoringRule>(`/config/monitoring_rules/${encodeURIComponent(rule.key)}`, { method: "PATCH", body: patch }));
          onSaved(saved);
        }}
      >
        <ul className="space-y-1.5">
          {patch.enabled !== undefined && <ChangeLine label="Enabled" before={onOff(rule.enabled)} after={onOff(patch.enabled)} />}
          {patch.severity && <ChangeLine label="Severity" before={humanize(rule.severity)} after={humanize(patch.severity)} />}
          {patch.action && (
            <ChangeLine label="When it matches" before={ACTIONS.find((a) => a.value === rule.action)?.short ?? rule.action} after={ACTIONS.find((a) => a.value === patch.action)?.short ?? patch.action} />
          )}
          {Object.entries(patch.params ?? {}).map(([k, v]) => (
            <ChangeLine key={k} label={humanize(k)} before={params[k]} after={v} />
          ))}
        </ul>
        <p>
          Each change bumps the rule to version {rule.version + 1}. Alerts raised from now on record the version they were raised under, so existing alerts keep version {rule.version}.
          {patch.action === "hold" && " Matching transactions will be held until someone reviews them."}
          {patch.enabled === false && " While disabled, the rule raises no new alerts; existing alerts are unaffected."}
        </p>
        <AuditedNote mode="history" />
      </ConfirmDialog>
    </div>
  );
}
