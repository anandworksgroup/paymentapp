"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAction, useCursorList, qs } from "@/lib/merchant/hooks";
import type { WebhookDelivery, WebhookEndpoint } from "@/lib/merchant/types";
import { Button, Card, CardHeader, Chip, Empty, ErrorNote, Field, Select } from "@/components/ui";
import { date, relative } from "@/lib/format";
import { useMerchant, useToast } from "../context";
import { ConfirmModal, FilterBar, FilterSelect, KV, ListSkeleton, Loaded, Mono, Pager } from "../common";
import { Icon } from "../icons";
import { DeliveryModal, DeliveryTable } from "./Deliveries";
import { EndpointStatus, SecretOnceModal } from "./shared";
import { parseEvents } from "./EventFilterPicker";
import { WebhookFormModal } from "./WebhookFormModal";

export function EndpointDetail({ endpoint: ep, onChanged }: { endpoint: WebhookEndpoint; onChanged: () => void }) {
  const { can } = useMerchant();
  const canWrite = can("developers.write");
  const toast = useToast();
  const [status, setStatus] = useState("");
  const deliveries = useCursorList<WebhookDelivery>(`/v1/webhook_deliveries${qs({ endpoint: ep.id, status })}`, 15);
  const [editing, setEditing] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [grace, setGrace] = useState("24");
  const [rotated, setRotated] = useState<{ secret: string; hours: number } | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [testResult, setTestResult] = useState<WebhookDelivery | null>(null);
  const act = useAction();
  const test = useAction();
  const events = parseEvents(ep.enabled_events_csv);
  const disabled = ep.status === "disabled";

  const refresh = () => {
    onChanged();
    deliveries.reload();
  };

  const sendTest = async () => {
    const d = await test.run(() => api<WebhookDelivery>(`/v1/webhook_endpoints/${ep.id}/test`, { method: "POST" }));
    if (d) {
      setTestResult(d);
      refresh();
    }
  };

  return (
    <Card className="min-w-0">
      <CardHeader
        title={<span className="break-all">{ep.url}</span>}
        subtitle={ep.description ?? "No description"}
        action={<EndpointStatus status={ep.status} />}
      />
      {canWrite && !disabled && (
        <div className="mb-5 flex flex-wrap gap-2">
          <Button size="sm" icon={<Icon name="send" size={14} />} loading={test.busy} onClick={sendTest}>Send test event</Button>
          <Button size="sm" variant="soft" onClick={() => setEditing(true)}>Edit</Button>
          <Button size="sm" variant="soft" icon={<Icon name="key" size={14} />} onClick={() => { act.setError(null); setRotating(true); }}>Rotate secret</Button>
          <Button size="sm" variant="danger" onClick={() => { act.setError(null); setDisabling(true); }}>Disable</Button>
        </div>
      )}
      <div aria-live="assertive">{test.error ? <div className="mb-4"><ErrorNote error={test.error} /></div> : null}</div>
      {ep.status === "failing" && (
        <div className="mb-5 rounded-inner bg-peach-soft px-4 py-3 text-[13px] text-peach-ink" role="status">
          The last {ep.consecutive_failures} deliveries failed. We keep retrying with backoff; saving the endpoint or a successful delivery marks it healthy again.
        </div>
      )}
      {disabled && (
        <div className="mb-5 rounded-inner bg-surface-2 px-4 py-3 text-[13px] text-text-2" role="status">This endpoint is disabled and no longer receives events.</div>
      )}

      <KV className="mb-6" rows={[
        ["Endpoint id", <Mono key="id">{ep.id}</Mono>],
        ["Events", events.includes("*") ? <Chip tone="lemon-soft">All events</Chip> : (
          <span className="flex flex-wrap gap-1">{events.map((e) => <Chip key={e} tone="neutral" className="font-mono">{e}</Chip>)}</span>
        )],
        ["Consecutive failures", <span key="f" className={ep.consecutive_failures ? "text-peach-ink" : undefined}>{ep.consecutive_failures}</span>],
        ["Last success", ep.last_success_at ? `${relative(ep.last_success_at)} · ${date(ep.last_success_at, true)}` : "Never"],
        ["Last failure", ep.last_failure_at ? `${relative(ep.last_failure_at)} · ${date(ep.last_failure_at, true)}` : "Never"],
        ["Previous secret", ep.previous_secret_expires_at ? `Still accepted until ${date(ep.previous_secret_expires_at, true)}` : null],
        ["Created", date(ep.created_at, true)],
      ]} />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-medium text-text">Deliveries</h3>
        <FilterBar>
          <FilterSelect label="Delivery status" value={status} onChange={setStatus} options={[
            { value: "", label: "All statuses" }, { value: "succeeded", label: "Succeeded" }, { value: "retrying", label: "Retrying" },
            { value: "pending", label: "Pending" }, { value: "dead", label: "Gave up" },
          ]} />
          <Button size="sm" variant="soft" onClick={deliveries.reload} aria-label="Refresh deliveries">Refresh</Button>
        </FilterBar>
      </div>
      <Loaded data={deliveries.data} error={deliveries.error} onRetry={deliveries.reload} skeleton={<ListSkeleton rows={4} />}>
        {() => (
          <>
            <DeliveryTable rows={deliveries.rows} show="event" empty={<Empty title={status ? "No deliveries with this status" : "No deliveries yet"}>Deliveries appear here as events are sent to this endpoint. Send a test event to try it.</Empty>} />
            <Pager page={deliveries.page} hasPrev={deliveries.hasPrev} hasMore={deliveries.hasMore} onPrev={deliveries.prev} onNext={deliveries.next} loading={deliveries.loading} />
          </>
        )}
      </Loaded>

      {editing && <WebhookFormModal endpoint={ep} onClose={() => setEditing(false)} onSaved={refresh} />}

      <ConfirmModal
        open={rotating}
        onClose={() => setRotating(false)}
        title="Rotate signing secret?"
        confirmLabel="Rotate secret"
        busy={act.busy}
        error={act.error}
        onConfirm={async () => {
          const hours = Number(grace);
          const r = await act.run(() => api<{ secret: string; previous_secret_valid_hours: number }>(`/v1/webhook_endpoints/${ep.id}/rotate_secret`, { body: { grace_hours: hours } }));
          if (r) {
            setRotating(false);
            setRotated({ secret: r.secret, hours: r.previous_secret_valid_hours });
            onChanged();
          }
        }}
      >
        <p>A new secret is generated now. During the grace period deliveries are signed with both secrets, so you can deploy the new one without dropping events.</p>
        <Field label="Keep the previous secret valid for">
          <Select value={grace} onChange={(e) => setGrace(e.target.value)}>
            <option value="0">Expire it immediately</option>
            <option value="1">1 hour</option>
            <option value="24">24 hours</option>
            <option value="72">72 hours (maximum)</option>
          </Select>
        </Field>
      </ConfirmModal>

      {rotated && (
        <SecretOnceModal open title="New signing secret" secret={rotated.secret} onClose={() => setRotated(null)}>
          <p className="text-[12.5px] text-muted">
            {rotated.hours > 0 ? `The previous secret keeps working for ${Math.min(rotated.hours, 72)} hours.` : "The previous secret no longer works."}
          </p>
        </SecretOnceModal>
      )}

      <ConfirmModal
        open={disabling}
        onClose={() => setDisabling(false)}
        title="Disable this endpoint?"
        confirmLabel="Disable endpoint"
        danger
        busy={act.busy}
        error={act.error}
        onConfirm={async () => {
          const ok = await act.run(() => api(`/v1/webhook_endpoints/${ep.id}`, { method: "DELETE" }).then(() => true));
          if (ok) {
            toast("Endpoint disabled");
            setDisabling(false);
            onChanged();
          }
        }}
      >
        <p>No new events are sent to <span className="break-all text-text">{ep.url}</span>. Past deliveries stay visible. A disabled endpoint can’t be re-enabled — add it again if you need it later.</p>
      </ConfirmModal>

      {testResult && <DeliveryModal delivery={testResult} title="Test event sent" onClose={() => setTestResult(null)} />}
    </Card>
  );
}
