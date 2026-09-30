"use client";

import { ReactNode, useState } from "react";
import { Button, Card, Chip, cx, Empty, PageHeader, ShareBars, Stat, StatusChip } from "@/components/ui";
import { adminApi, useAdminQuery } from "@/components/admin/data";
import { ConfirmDialog, filterClass, humanize, KV, Loadable, Mono, Num, PageSkeleton, ReadOnlyNote, When } from "@/components/admin/kit";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import type { ListResponse, Provider, ProviderRow } from "@/components/admin/types";

type Change = { provider: Provider; field: "enabled"; value: boolean } | { provider: Provider; field: "priority"; value: number } | { provider: Provider; field: "force_outage"; value: boolean };

export default function ProvidersPage() {
  return (
    <Guard perm="admin.overview">
      <Providers />
    </Guard>
  );
}

function Providers() {
  const { can, guard } = useAdmin();
  const manage = can("admin.providers.manage");
  const q = useAdminQuery<ListResponse<ProviderRow>>("/providers");
  const [change, setChange] = useState<Change | null>(null);

  return (
    <>
      <PageHeader
        eyebrow="Operations · payment routing"
        title="Payment providers"
        subtitle="Health, last 24 hours of attempts and routing order. Payments try healthy providers first, then by priority (lowest number first)."
        actions={
          <>
            {!manage && <ReadOnlyNote>Read-only: changing providers needs the providers manage permission.</ReadOnlyNote>}
            <Button variant="soft" size="sm" onClick={q.reload} loading={q.loading && !!q.data}>
              Refresh
            </Button>
          </>
        }
      />
      <Loadable q={q} skeleton={<PageSkeleton />}>
        {(list) => {
          const rows = [...list.data].sort((a, b) => a.provider.priority - b.provider.priority);
          if (rows.length === 0)
            return (
              <Card>
                <Empty title="No providers configured">Payment providers appear here once they are registered with the platform.</Empty>
              </Card>
            );
          return (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              {rows.map((r) => (
                <ProviderCard key={r.provider.id} row={r} manage={manage} onChange={setChange} />
              ))}
            </div>
          );
        }}
      </Loadable>

      {change && (
        <ConfirmDialog
          open
          onClose={() => setChange(null)}
          title={confirmTitle(change)}
          confirmLabel={change.field === "force_outage" && change.value ? "Start failover drill" : "Apply change"}
          tone={(change.field === "force_outage" && change.value) || (change.field === "enabled" && !change.value) ? "danger" : "ink"}
          onConfirm={async () => {
            await guard(() => adminApi<Provider>(`/providers/${encodeURIComponent(change.provider.id)}`, { method: "PATCH", body: { [change.field]: change.value } }));
            q.reload();
          }}
        >
          {confirmBody(change)}
          <p className="text-muted">The change applies immediately to new payments and is recorded in the audit log with the before and after values.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

function confirmTitle(c: Change) {
  const name = c.provider.name;
  if (c.field === "enabled") return c.value ? `Enable ${name}?` : `Disable ${name}?`;
  if (c.field === "priority") return `Change priority of ${name}?`;
  return c.value ? `Force an outage on ${name}?` : `End the failover drill on ${name}?`;
}

function confirmBody(c: Change): ReactNode {
  if (c.field === "enabled")
    return c.value ? (
      <p>The provider becomes eligible for routing again, in its priority order ({c.provider.priority}).</p>
    ) : (
      <p>New payments will no longer be routed to this provider. Traffic goes to the next eligible provider by priority. Payments already in flight are not affected.</p>
    );
  if (c.field === "priority")
    return (
      <p>
        Priority changes from <Mono>{c.provider.priority}</Mono> to <Mono>{c.value}</Mono>. Lower numbers are tried first among providers with the same health.
      </p>
    );
  return c.value ? (
    <p>
      Simulates an outage: every attempt on this provider fails as unavailable, so traffic fails over to the next provider by priority. Use it for failover
      drills and turn it off afterwards.
    </p>
  ) : (
    <p>The provider stops simulating an outage and resumes normal processing. Its health state recovers as successful attempts come in.</p>
  );
}

function healthTone(state: string) {
  const s = state.toUpperCase();
  return s === "HEALTHY" ? "sage" : s === "DEGRADED" ? "lemon" : "rose";
}

function ProviderCard({ row, manage, onChange }: { row: ProviderRow; manage: boolean; onChange: (c: Change) => void }) {
  const p = row.provider;
  const s = row.last_24h;
  const errors = Object.entries(s.errors).sort((a, b) => b[1] - a[1]);
  const csv = (v: string) => (v === "*" ? "All" : v.split(",").map((x) => x.trim()).filter(Boolean).join(", "));

  return (
    <Card className={cx(p.force_outage && "ring-2 ring-peach")}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-medium tracking-[-0.01em] text-text">{p.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
            <Mono>{p.id}</Mono>
            <span>· {humanize(p.kind)}</span>
            <span>· priority {p.priority}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {p.livemode ? <Chip tone="ink">Live</Chip> : <Chip tone="lemon">Test</Chip>}
          {!p.enabled && <StatusChip status="disabled" />}
          <Chip tone={healthTone(p.health_state)}>{humanize(p.health_state)}</Chip>
        </div>
      </div>

      {p.force_outage && (
        <div role="status" className="mb-4 rounded-inner bg-peach-soft px-4 py-3 text-[13px] text-peach-ink">
          <span className="font-medium">Failover drill active.</span> Outage is forced: every attempt fails so traffic moves to the next provider by priority.
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Success rate (24h)">
          {s.success_rate === null ? <span className="text-[13px] text-muted">No attempts</span> : <Num value={s.success_rate} suffix="%" className="text-[26px]" />}
        </Stat>
        <Stat label="Avg latency">
          {s.avg_latency_ms === null ? <span className="text-[13px] text-muted">—</span> : <Num value={Math.round(s.avg_latency_ms)} suffix="ms" className="text-[26px]" />}
        </Stat>
        <Stat label="Attempts (24h)">
          <Num value={s.attempts} className="text-[26px]" />
        </Stat>
      </div>

      <div className="mt-5">
        <div className="mb-2 text-[12.5px] text-muted">Errors (24h)</div>
        {errors.length === 0 ? (
          <Chip tone="sage">No errors</Chip>
        ) : (
          <ShareBars rows={errors.map(([type, count]) => ({ label: humanize(type), value: count }))} format={(v) => `${v}`} />
        )}
      </div>

      <div className="mt-5 rounded-inner bg-surface-2 p-4">
        <KV
          cols={3}
          items={[
            ["Methods", csv(p.methods_csv)],
            ["Countries", csv(p.countries_csv)],
            ["Currencies", csv(p.currencies_csv)],
            ["Provider fees", `${(p.fee_bps / 100).toFixed(2)}% + ${(p.fee_fixed_minor / 100).toFixed(2)} fixed`],
            ["Settlement", `T+${p.settlement_days} day${p.settlement_days === 1 ? "" : "s"}`],
            ["Health updated", p.health_updated_at ? <When key="h" at={p.health_updated_at} /> : "No change recorded"],
          ]}
        />
      </div>

      {manage && (
        <div className="mt-5 space-y-3 border-t border-line pt-5">
          <ControlRow label="Enabled" hint="Disabled providers receive no new payments.">
            <Toggle checked={p.enabled} label={`${p.enabled ? "Disable" : "Enable"} ${p.name}`} onClick={() => onChange({ provider: p, field: "enabled", value: !p.enabled })} />
          </ControlRow>
          <ControlRow label="Priority" hint="Lower numbers are tried first.">
            <PriorityEditor key={`${p.id}-${p.priority}`} provider={p} onSave={(value) => onChange({ provider: p, field: "priority", value })} />
          </ControlRow>
          <ControlRow label="Force outage" hint="Failover drill. Simulates an outage so traffic fails over to the next provider by priority." loud={p.force_outage}>
            <Toggle
              checked={p.force_outage}
              danger
              label={`${p.force_outage ? "End" : "Start"} failover drill on ${p.name}`}
              onClick={() => onChange({ provider: p, field: "force_outage", value: !p.force_outage })}
            />
          </ControlRow>
        </div>
      )}
    </Card>
  );
}

function ControlRow({ label, hint, children, loud }: { label: string; hint: string; children: ReactNode; loud?: boolean }) {
  return (
    <div className={cx("flex items-center justify-between gap-4 rounded-inner px-3 py-2", loud && "bg-peach-soft")}>
      <div>
        <div className={cx("text-[13.5px] font-medium", loud ? "text-peach-ink" : "text-text")}>{label}</div>
        <div className={cx("text-[12px]", loud ? "text-peach-ink" : "text-muted")}>{hint}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onClick, label, danger }: { checked: boolean; onClick: () => void; label: string; danger?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        "relative inline-flex h-7 w-12 items-center rounded-full transition",
        checked ? (danger ? "bg-rose-ink" : "bg-sage-500") : "bg-surface-3",
      )}
    >
      <span className={cx("inline-block h-5 w-5 rounded-full bg-surface shadow-card transition", checked ? "translate-x-6" : "translate-x-1")} />
    </button>
  );
}

function PriorityEditor({ provider, onSave }: { provider: Provider; onSave: (v: number) => void }) {
  const [value, setValue] = useState(String(provider.priority));
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 10000;
  const changed = valid && n !== provider.priority;
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (changed) onSave(n);
      }}
    >
      <input
        type="number"
        min={0}
        max={10000}
        step={1}
        aria-label={`Priority for ${provider.name}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={cx(filterClass, "w-20 text-right")}
      />
      <Button type="submit" size="sm" variant="soft" disabled={!changed}>
        Save
      </Button>
    </form>
  );
}
