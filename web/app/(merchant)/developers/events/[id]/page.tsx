"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api, type List } from "@/lib/api";
import { useAction, useApi } from "@/lib/merchant/hooks";
import type { ApiEvent, WebhookDelivery, WebhookEndpoint } from "@/lib/merchant/types";
import { Button, Card, CardHeader, Chip, Empty, Field, PageHeader, Select } from "@/components/ui";
import { date, titleCase } from "@/lib/format";
import { useMerchant, useToast } from "@/components/merchant/context";
import { BackLink, ConfirmModal, DetailSkeleton, JsonBlock, KV, Loaded, Mono, NoAccess } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { DeliveryTable } from "@/components/merchant/developers/Deliveries";
import { ModeChip, objectHref } from "@/components/merchant/developers/shared";

type EventDetail = { event: ApiEvent; deliveries: WebhookDelivery[] };

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useMerchant();
  const allowed = can("developers.read");
  const res = useApi<EventDetail>(allowed ? `/v1/events/${id}` : null);
  if (!allowed) return <NoAccess what="events" />;
  return (
    <>
      <BackLink href="/developers/events">Events</BackLink>
      <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<DetailSkeleton />}>
        {(d) => <Detail d={d} reload={res.reload} />}
      </Loaded>
    </>
  );
}

function Detail({ d, reload }: { d: EventDetail; reload: () => void }) {
  const e = d.event;
  const { can } = useMerchant();
  const toast = useToast();
  const canWrite = can("developers.write");
  const endpoints = useApi<List<WebhookEndpoint>>(canWrite ? "/v1/webhook_endpoints" : null);
  const [replaying, setReplaying] = useState(false);
  const [target, setTarget] = useState("");
  const act = useAction();
  const href = objectHref(e.object_type, e.object_id, e.data);
  const active = endpoints.data?.data.filter((w) => w.status !== "disabled") ?? [];

  return (
    <>
      <PageHeader
        eyebrow={<Mono>{e.id}</Mono>}
        title={<span className="font-mono text-[28px] tracking-[-0.02em]">{e.type}</span>}
        subtitle={<>{date(e.created_at, true)} · API version {e.api_version}</>}
        actions={canWrite && (
          <Button variant="soft" icon={<Icon name="repeat" size={16} />} onClick={() => { act.setError(null); setReplaying(true); }}>Replay</Button>
        )}
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Payload" subtitle="The object as it was when the event happened" />
            <JsonBlock value={e.data} />
          </Card>
          <Card>
            <CardHeader title="Delivery attempts" subtitle="Every attempt to send this event to your endpoints, including replays" />
            <DeliveryTable
              rows={d.deliveries}
              show="endpoint"
              empty={<Empty title="Not delivered anywhere">No endpoint was subscribed to this event type when it happened. Replay it to send it now.</Empty>}
            />
          </Card>
        </div>
        <Card>
          <CardHeader title="Details" />
          <KV rows={[
            ["Type", <span key="t" className="font-mono text-[12.5px]">{e.type}</span>],
            ["Object", <span key="o" className="flex flex-wrap items-center gap-2"><Chip tone="neutral">{titleCase(e.object_type)}</Chip>
              {href ? <Link href={href} className="font-mono text-[12.5px] underline-offset-4 hover:underline">{e.object_id}</Link> : <span className="font-mono text-[12.5px]">{e.object_id}</span>}</span>],
            ["Mode", <ModeChip key="m" livemode={e.livemode} />],
            ["Sequence", e.sequence],
            ["Request", e.request_id ? <Mono key="r">{e.request_id}</Mono> : "Created by a background job"],
            ["Created", date(e.created_at, true)],
          ]} />
        </Card>
      </div>

      <ConfirmModal
        open={replaying}
        onClose={() => setReplaying(false)}
        title="Replay this event?"
        confirmLabel="Replay now"
        busy={act.busy}
        error={act.error}
        onConfirm={async () => {
          const r = await act.run(() => api<List<WebhookDelivery>>(`/v1/events/${e.id}/replay${target ? `?endpoint=${encodeURIComponent(target)}` : ""}`, { method: "POST" }));
          if (r) {
            toast(r.data.length ? `Replayed to ${r.data.length} endpoint${r.data.length === 1 ? "" : "s"}` : "No enabled endpoint to replay to");
            setReplaying(false);
            reload();
          }
        }}
      >
        <p>The same event id is sent again with a fresh delivery id, so your handler can de-duplicate it.</p>
        <Field label="Send to">
          <Select value={target} onChange={(ev) => setTarget(ev.target.value)}>
            <option value="">All enabled endpoints ({active.length})</option>
            {active.map((w) => <option key={w.id} value={w.id}>{w.url}</option>)}
          </Select>
        </Field>
      </ConfirmModal>
    </>
  );
}
