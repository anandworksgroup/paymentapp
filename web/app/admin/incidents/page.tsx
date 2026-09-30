"use client";

import { useState } from "react";
import { Button, Card, Chip, cx, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, StatusChip, Table, Textarea } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { adminApi, useAdminQuery, type Query } from "@/components/admin/data";
import { IdTag, Loadable, Mono, Notice, Person, ReadOnlyNote, SkeletonRows, When } from "@/components/admin/kit";
import { INCIDENT_STEPS, IncidentStatusChip, IncidentTrack, SEVERITIES, SeverityChip, splitCsv } from "@/components/admin/ops";
import type { Incident, IncidentWithUpdates, PublicStatus } from "@/components/admin/ops-types";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import type { ListResponse } from "@/components/admin/types";

export default function IncidentsPage() {
  return (
    <Guard perm="admin.overview">
      <Incidents />
    </Guard>
  );
}

function Incidents() {
  const { can } = useAdmin();
  const canWrite = can("admin.incidents");
  // Each row carries the incident and its update timeline.
  const list = useAdminQuery<ListResponse<IncidentWithUpdates>>("/incidents");
  const status = useAdminQuery<PublicStatus>("/v1/public/status");
  const [declaring, setDeclaring] = useState(false);
  const [updating, setUpdating] = useState<Incident | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = () => {
    list.reload();
    status.reload();
  };
  const updatesFor = (id: string) => list.data?.data.find((x) => x.incident.id === id)?.updates;

  return (
    <>
      <PageHeader
        eyebrow="Service status"
        title="Incidents"
        subtitle="Declare incidents and post updates. Open incidents appear on the public status page and in merchant dashboards."
        actions={
          canWrite ? (
            <Button onClick={() => setDeclaring(true)}>Declare incident</Button>
          ) : (
            <ReadOnlyNote>
              Declaring and updating incidents needs <Mono>admin.incidents</Mono>
            </ReadOnlyNote>
          )
        }
      />
      {notice && (
        <div className="mb-5">
          <Notice>{notice}</Notice>
        </div>
      )}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Loadable q={list}>
            {(d) => {
              const incidents = d.data.map((x) => x.incident);
              const active = incidents.filter((i) => i.status !== "resolved");
              const resolved = incidents.filter((i) => i.status === "resolved");
              return (
                <>
                  <Card>
                    <CardHeader title="Active incidents" subtitle="Newest first. Post an update whenever the situation changes." action={active.length > 0 && <Chip tone="peach">{active.length} active</Chip>} />
                    {active.length === 0 ? (
                      <Empty title="All systems operational">No active incidents. The public status page shows “operational”.</Empty>
                    ) : (
                      <ul className="space-y-4">
                        {active.map((i) => (
                          <ActiveIncident key={i.id} i={i} updates={updatesFor(i.id)} canWrite={canWrite} onUpdate={() => setUpdating(i)} />
                        ))}
                      </ul>
                    )}
                  </Card>
                  <Card>
                    <CardHeader title="Resolved" subtitle="The last 100 incidents are kept here for reference." />
                    <Table
                      rows={resolved}
                      rowKey={(r) => r.id}
                      empty={<Empty title="No resolved incidents yet" />}
                      columns={[
                        {
                          key: "t",
                          header: "Incident",
                          render: (r) => (
                            <div>
                              <div className="text-text">{r.title || <span className="text-muted">Untitled incident</span>}</div>
                              <IdTag id={r.id} />
                            </div>
                          ),
                        },
                        { key: "s", header: "Severity", render: (r) => <SeverityChip severity={r.severity} /> },
                        { key: "a", header: "Affected", render: (r) => <span className="text-text-2">{splitCsv(r.affected_services_csv).join(", ") || "—"}</span> },
                        { key: "st", header: "Started", render: (r) => <When at={r.started_at} /> },
                        { key: "d", header: "Duration", render: (r) => <span className="text-text-2">{duration(r.started_at, r.resolved_at)}</span> },
                      ]}
                    />
                  </Card>
                </>
              );
            }}
          </Loadable>
        </div>
        <div className="space-y-5">
          <StatusPreview q={status} />
        </div>
      </div>

      {declaring && (
        <DeclareDialog
          onClose={() => setDeclaring(false)}
          onDone={(t) => {
            setNotice(`Incident declared: “${t}”. It is now on the public status page.`);
            reload();
          }}
        />
      )}
      {updating && (
        <UpdateDialog
          i={updating}
          onClose={() => setUpdating(null)}
          onDone={(s) => {
            setNotice(s === "resolved" ? "Incident resolved. It no longer appears on the public status page." : `Update posted: ${s}.`);
            reload();
          }}
        />
      )}
    </>
  );
}

function duration(from: string, to: string | null) {
  if (!to) return "—";
  const m = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} days`;
}

function ActiveIncident({ i, updates, canWrite, onUpdate }: { i: Incident; updates?: { status: string; message: string; created_at: string }[]; canWrite: boolean; onUpdate: () => void }) {
  const affected = splitCsv(i.affected_services_csv);
  return (
    <li id={i.id} className={cx("scroll-mt-24 rounded-inner p-5", i.severity === "critical" ? "bg-rose-soft/60" : i.severity === "major" ? "bg-peach-soft/60" : "bg-surface-2")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityChip severity={i.severity} />
            <IncidentStatusChip status={i.status} />
            <IdTag id={i.id} />
          </div>
          <h3 className="mt-2 text-[17px] font-medium tracking-[-0.01em] text-text">{i.title || <span className="text-muted">Untitled incident</span>}</h3>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Started <When at={i.started_at} /> (<When at={i.started_at} rel />) · declared by <Person id={i.created_by} />
          </p>
        </div>
        {canWrite && (
          <Button size="sm" onClick={onUpdate}>
            Post update
          </Button>
        )}
      </div>
      <div className="mt-4">
        <IncidentTrack status={i.status} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[12px] text-muted">Affected services</div>
          <div className="flex flex-wrap gap-1.5">{affected.length ? affected.map((a) => <Chip key={a} tone="lemon-soft">{a}</Chip>) : <span className="text-[13px] text-faint">Not specified</span>}</div>
        </div>
        <div>
          <div className="mb-1.5 text-[12px] text-muted">Customer impact (public)</div>
          <p className="text-[13px] text-text-2">{i.customer_impact || <span className="text-faint">Not specified</span>}</p>
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-2 text-[12px] text-muted">Updates</div>
        {!updates ? (
          <SkeletonRows rows={1} />
        ) : (
          <ol className="relative space-y-3 border-l border-line pl-4">
            {[...updates].reverse().map((u, n) => (
              <li key={n} className="relative">
                <span className={cx("absolute -left-[21.5px] top-1.5 h-2.5 w-2.5 rounded-full", n === 0 ? "bg-ink" : "bg-faint")} />
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                  <IncidentStatusChip status={u.status} />
                  <When at={u.created_at} />
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-text">{u.message || <span className="text-faint">No message</span>}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </li>
  );
}

const OVERALL: Record<string, { label: string; cls: string; dot: string }> = {
  operational: { label: "All systems operational", cls: "bg-sage-100 text-sage-700", dot: "bg-sage-500" },
  degraded: { label: "Some systems are degraded", cls: "bg-lemon-soft text-lemon-ink", dot: "bg-lemon" },
  major_outage: { label: "Major outage", cls: "bg-rose-soft text-rose-ink", dot: "bg-rose-ink" },
};

function StatusPreview({ q }: { q: Query<PublicStatus> }) {
  return (
    <Card>
      <CardHeader
        title="Public status page"
        subtitle={
          <>
            Live preview of <Mono>GET /v1/public/status</Mono> — exactly what buyers and merchants see.
          </>
        }
        action={
          <Button size="sm" variant="soft" onClick={q.reload} loading={q.loading && !!q.data}>
            Refresh
          </Button>
        }
      />
      <Loadable q={q}>
        {(s) => {
          const o = OVERALL[s.overall] ?? { label: s.overall, cls: "bg-surface-2 text-text", dot: "bg-faint" };
          return (
            <div className="rounded-inner border border-line bg-bg p-4">
              <div className={cx("flex items-center gap-2.5 rounded-full px-4 py-2.5 text-[14px] font-medium", o.cls)}>
                <span className={cx("h-2.5 w-2.5 rounded-full", o.dot)} />
                {o.label}
              </div>
              {s.incidents.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {s.incidents.map((i) => (
                    <li key={i.id} className="rounded-[16px] bg-surface p-3.5 shadow-card">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[13.5px] font-medium text-text">{i.title || <span className="text-muted">Untitled incident</span>}</span>
                        <IncidentStatusChip status={i.status} />
                      </div>
                      {i.customer_impact && <p className="mt-1 text-[12.5px] text-text-2">{i.customer_impact}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                        {i.affected.map((a) => (
                          <Chip key={a} className="!py-0.5">
                            {a.trim()}
                          </Chip>
                        ))}
                        <span>
                          since <When at={i.started_at} />
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4">
                <div className="mb-1.5 px-1 text-[12px] text-muted">Payment providers</div>
                <ul className="space-y-1.5">
                  {s.payment_providers.map((p) => (
                    <li key={p.name} className="flex items-center justify-between gap-2 rounded-[14px] bg-surface px-3.5 py-2 text-[13px]">
                      <span className="text-text">{p.name}</span>
                      <StatusChip status={p.health_state} />
                    </li>
                  ))}
                  {s.payment_providers.length === 0 && <li className="px-1 text-[12.5px] text-faint">No providers listed.</li>}
                </ul>
              </div>
              <p className="mt-3 px-1 text-[11.5px] text-muted">Only the title, status, affected services and customer impact are public. Update messages stay in dashboards.</p>
            </div>
          );
        }}
      </Loadable>
    </Card>
  );
}

function DeclareDialog({ onClose, onDone }: { onClose: () => void; onDone: (title: string) => void }) {
  const { guard } = useAdmin();
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<"minor" | "major" | "critical">("minor");
  const [affected, setAffected] = useState("");
  const [impact, setImpact] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ok = title.trim().length >= 5 && splitCsv(affected).length > 0 && impact.trim().length >= 5 && message.trim().length >= 5;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await guard(() =>
        adminApi("/incidents", {
          body: { title: title.trim(), severity, affected_services: splitCsv(affected).join(","), customer_impact: impact.trim(), message: message.trim() },
        }),
      );
      onDone(title.trim());
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
      title="Declare an incident"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!ok} variant={severity === "critical" ? "danger" : "ink"}>
            Declare and publish
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Notice tone="lemon">Declaring publishes the incident to the public status page immediately, with the status “Investigating”.</Notice>
        <Field label="Title (public)" hint="Describe the symptom, not the cause. e.g. “Delayed payouts to UK bank accounts”.">
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
        </Field>
        <div>
          <span className="mb-1.5 block text-[12.5px] font-medium text-text-2">Severity</span>
          <div role="radiogroup" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {SEVERITIES.map((s) => (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={severity === s.value}
                onClick={() => setSeverity(s.value)}
                className={cx("rounded-inner p-3.5 text-left transition", severity === s.value ? "bg-ink text-white" : "bg-surface-2 hover:bg-surface-3")}
              >
                <span className="block text-[13.5px] font-medium">{s.label}</span>
                <span className={cx("mt-0.5 block text-[12px]", severity === s.value ? "text-white/70" : "text-muted")}>{s.help}</span>
              </button>
            ))}
          </div>
        </div>
        <Field label="Affected services (public)" hint="Comma-separated, e.g. card payments, checkout, payouts.">
          <Input value={affected} onChange={(e) => setAffected(e.target.value)} />
        </Field>
        {splitCsv(affected).length > 0 && (
          <div className="-mt-2 flex flex-wrap gap-1.5">
            {splitCsv(affected).map((a) => (
              <Chip key={a} tone="lemon-soft">
                {a}
              </Chip>
            ))}
          </div>
        )}
        <Field label="Customer impact (public)" hint="What merchants and buyers will notice, in plain language.">
          <Textarea value={impact} onChange={(e) => setImpact(e.target.value)} className="min-h-20" />
        </Field>
        <Field label="First update" hint="Posted to the incident timeline as “Investigating”.">
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} className="min-h-20" placeholder="We are investigating reports of …" />
        </Field>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}

function UpdateDialog({ i, onClose, onDone }: { i: Incident; onClose: () => void; onDone: (status: string) => void }) {
  const { guard } = useAdmin();
  const next = INCIDENT_STEPS[Math.min(INCIDENT_STEPS.length - 1, INCIDENT_STEPS.findIndex((s) => s.value === i.status) + 1)]?.value ?? "identified";
  const [status, setStatus] = useState(next);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const help = INCIDENT_STEPS.find((s) => s.value === status)?.help;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await guard(() => adminApi(`/incidents/${i.id}/updates`, { body: { status, message: message.trim() } }));
      onDone(status);
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
      onClose={onClose}
      title="Post an update"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={message.trim().length < 5}>
            {status === "resolved" ? "Resolve incident" : "Post update"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13.5px] text-text-2">
          <span className="font-medium text-text">{i.title || "Untitled incident"}</span> · currently <IncidentStatusChip status={i.status} />
        </p>
        <Field label="New status" hint={help}>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {INCIDENT_STEPS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Message" hint="Shown in merchant dashboards with this incident.">
          <Textarea autoFocus value={message} onChange={(e) => setMessage(e.target.value)} placeholder={status === "resolved" ? "Service has recovered. …" : "What changed since the last update."} />
        </Field>
        {status === "resolved" && <Notice tone="sage">Resolving removes the incident from the public status page and records the resolution time.</Notice>}
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
