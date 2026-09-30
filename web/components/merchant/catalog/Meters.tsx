"use client";

import Link from "next/link";
import { useState } from "react";
import { api, API_URL } from "@/lib/api";
import type { Meter } from "@/lib/merchant/types";
import { Button, ErrorNote, Field, Input, Modal, Select } from "@/components/ui";
import { useToast } from "../context";
import { CopyButton } from "../common";

export const AGGREGATIONS = [
  { value: "sum", label: "Sum", help: "Adds up the quantity of every event (tokens, requests, GB)." },
  { value: "count", label: "Count", help: "Counts events, ignoring their quantity." },
  { value: "max", label: "Max", help: "Highest quantity in the period (peak seats)." },
  { value: "last", label: "Last", help: "Most recent quantity in the period (storage at period end)." },
];

export function usageCurl(eventName: string) {
  const key = "evt_" + eventName.replace(/[^a-z0-9]+/gi, "_").slice(0, 20) + "_0001";
  return [
    `curl -X POST ${API_URL}/v1/usage_events \\`,
    `  -H "Authorization: Bearer $SECRET_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Idempotency-Key: ${key}" \\`,
    `  -d '{"customer":"cus_123","event_name":"${eventName}","quantity":1,"idempotency_key":"${key}"}'`,
  ].join("\n");
}

/** Copy-paste example for reporting usage against a meter. */
export function UsageExample({ eventName }: { eventName: string }) {
  const code = usageCurl(eventName);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] text-muted">Send one event per unit of usage from your server</span>
        <CopyButton value={code} label="Copy" />
      </div>
      <pre className="overflow-x-auto rounded-inner bg-ink p-4 font-mono text-[12px] leading-relaxed text-white/90"><code>{code}</code></pre>
      <p className="text-[12px] leading-relaxed text-muted">
        Use a secret key from <Link href="/developers/api-keys" className="underline underline-offset-4">API keys</Link> and replace <span className="font-mono">cus_123</span> with the customer id.
        A repeated <span className="font-mono">idempotency_key</span> is recorded once, so retries never double-bill.
      </p>
    </div>
  );
}

export function MeterCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (m: Meter) => void }) {
  const toast = useToast();
  const [eventName, setEventName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [aggregation, setAggregation] = useState("sum");
  const [unit, setUnit] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<Meter | null>(null);

  const eventOk = /^[A-Za-z0-9_.:-]{1,100}$/.test(eventName.trim());
  const invalid = !eventOk || !displayName.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const m = await api<Meter>("/v1/meters", { body: { event_name: eventName.trim(), display_name: displayName.trim(), aggregation, unit: unit.trim() || undefined } });
      toast("Meter created");
      setCreated(m);
      onCreated(m);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (created)
    return (
      <Modal open onClose={onClose} title={`${created.display_name} is ready`} wide footer={<Button onClick={onClose}>Done</Button>}>
        <p className="mb-4 text-[13.5px] text-muted">
          Next, add a <span className="text-text">metered recurring price</span> that uses this meter on a product, then start reporting usage:
        </p>
        <UsageExample eventName={created.event_name} />
      </Modal>
    );

  const agg = AGGREGATIONS.find((a) => a.value === aggregation);
  return (
    <Modal open onClose={onClose} title="Create meter">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Event name" error={eventName && !eventOk ? "Letters, numbers, dots, dashes, colons or underscores — no spaces." : null} hint="The event_name your server sends, e.g. api_requests.">
          <Input value={eventName} onChange={(e) => setEventName(e.target.value)} required autoFocus className="font-mono" placeholder="api_requests" />
        </Field>
        <Field label="Display name" hint="Shown on invoices and in usage reports.">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required placeholder="API requests" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Aggregation" hint={agg?.help}>
            <Select value={aggregation} onChange={(e) => setAggregation(e.target.value)}>
              {AGGREGATIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </Select>
          </Field>
          <Field label="Unit (optional)" hint="e.g. requests, tokens, GB">
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
        </div>
        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={invalid}>Create meter</Button>
        </div>
      </form>
    </Modal>
  );
}
