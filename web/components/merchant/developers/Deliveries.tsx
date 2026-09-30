"use client";

import Link from "next/link";
import { useState } from "react";
import type { WebhookDelivery } from "@/lib/merchant/types";
import { Chip, Modal, Table } from "@/components/ui";
import { date, relative } from "@/lib/format";
import { KV, Mono } from "../common";
import { DeliveryStatus, HttpStatus } from "./shared";

/** Webhook delivery attempts; a row opens the response the endpoint returned. */
export function DeliveryTable({ rows, show = "event", empty }: { rows: WebhookDelivery[]; show?: "event" | "endpoint"; empty?: React.ReactNode }) {
  const [open, setOpen] = useState<WebhookDelivery | null>(null);
  return (
    <>
      <Table
        rows={rows}
        rowKey={(d) => d.id}
        onRowClick={setOpen}
        empty={empty}
        columns={[
          show === "event"
            ? { key: "ev", header: "Event", render: (d) => <span className="font-mono text-[12px] text-text-2">{d.event_id}</span> }
            : { key: "ep", header: "Endpoint", render: (d) => <span className="font-mono text-[12px] text-text-2">{d.endpoint_id}</span> },
          { key: "st", header: "Status", render: (d) => (
            <span className="flex flex-wrap items-center gap-1">
              <DeliveryStatus status={d.status} />
              {d.is_replay && <Chip tone="sky">Replay</Chip>}
            </span>
          ) },
          { key: "code", header: "Response", render: (d) => <HttpStatus code={d.response_status} /> },
          { key: "att", header: "Attempt", render: (d) => <span className="text-text-2">{d.attempt}</span> },
          { key: "dur", header: "Duration", render: (d) => <span className="whitespace-nowrap text-muted">{d.duration_ms} ms</span> },
          { key: "next", header: "Next attempt", render: (d) => d.status === "retrying" || d.status === "pending" ? <span className="whitespace-nowrap text-text-2">{date(d.next_attempt_at, true)}</span> : <span className="text-faint">—</span> },
          { key: "at", header: "Created", align: "right", render: (d) => <span className="whitespace-nowrap text-muted">{relative(d.created_at)}</span> },
        ]}
      />
      {open && <DeliveryModal delivery={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function DeliveryModal({ delivery: d, onClose, title = "Delivery" }: { delivery: WebhookDelivery; onClose: () => void; title?: string }) {
  return (
    <Modal open onClose={onClose} title={title}>
      <div className="space-y-4">
        <KV rows={[
          ["Delivery", <Mono key="id">{d.id}</Mono>],
          ["Event", <Link key="ev" href={`/developers/events/${d.event_id}`} className="font-mono text-[12.5px] underline-offset-4 hover:underline">{d.event_id}</Link>],
          ["Endpoint", <span key="ep" className="font-mono text-[12.5px]">{d.endpoint_id}</span>],
          ["Status", <span key="s" className="flex flex-wrap gap-1"><DeliveryStatus status={d.status} />{d.is_replay && <Chip tone="sky">Replay</Chip>}</span>],
          ["Response status", <HttpStatus key="c" code={d.response_status} />],
          ["Attempt", d.attempt],
          ["Duration", `${d.duration_ms} ms`],
          ["Next attempt", d.status === "retrying" || d.status === "pending" ? date(d.next_attempt_at, true) : null],
          ["Completed", d.completed_at ? date(d.completed_at, true) : null],
        ]} />
        <div>
          <div className="mb-1.5 text-[12.5px] font-medium text-text-2">Response body</div>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-inner bg-surface-2 p-4 font-mono text-[12px] text-text-2">{d.response_body || "(empty)"}</pre>
        </div>
      </div>
    </Modal>
  );
}
