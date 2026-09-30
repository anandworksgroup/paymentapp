"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { WebhookEndpoint } from "@/lib/merchant/types";
import { Button, ErrorNote, Field, Input, Modal } from "@/components/ui";
import { useMerchant, useToast } from "../context";
import { Help } from "../common";
import { EventFilterPicker } from "./EventFilterPicker";
import { SecretOnceModal } from "./shared";

type Created = { webhook_endpoint: WebhookEndpoint; secret: string };

/** Create (shows the signing secret once) or edit a webhook endpoint. */
export function WebhookFormModal({ endpoint, onClose, onSaved }: { endpoint?: WebhookEndpoint; onClose: () => void; onSaved: (id: string) => void }) {
  const { live } = useMerchant();
  const toast = useToast();
  const [url, setUrl] = useState(endpoint?.url ?? "");
  const [description, setDescription] = useState(endpoint?.description ?? "");
  const [events, setEvents] = useState(endpoint?.enabled_events_csv ?? "*");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const urlOk = /^https?:\/\/\S+$/i.test(url.trim());
  const invalid = !urlOk || !events.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    const body = { url: url.trim(), enabled_events: events, description: description.trim() || undefined };
    try {
      if (endpoint) {
        await api<WebhookEndpoint>(`/v1/webhook_endpoints/${endpoint.id}`, { method: "PATCH", body });
        toast("Endpoint updated");
        onSaved(endpoint.id);
        onClose();
      } else {
        const res = await api<Created>("/v1/webhook_endpoints", { body });
        toast("Endpoint added");
        onSaved(res.webhook_endpoint.id);
        setCreated(res);
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <SecretOnceModal open title="Signing secret" secret={created.secret} onClose={onClose}>
        <Help>
          Each delivery carries a <code className="font-mono">Webhook-Signature: t=…,v1=…</code> header. Verify it by computing the hex HMAC-SHA256 of{" "}
          <code className="font-mono">{"{t}.{raw body}"}</code> with this secret and comparing it to <code className="font-mono">v1</code>. You can rotate the secret later.
        </Help>
      </SecretOnceModal>
    );
  }

  return (
    <Modal open onClose={onClose} title={endpoint ? "Edit endpoint" : `Add ${live ? "live" : "test"} endpoint`} wide>
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Endpoint URL"
          error={url && !urlOk ? "Enter a full http(s) URL." : null}
          hint={live ? "Live endpoints must use HTTPS and a public address." : "Test endpoints may point at localhost while you develop."}
        >
          <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhooks" required autoFocus inputMode="url" />
        </Field>
        <Field label="Description (optional)">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Order fulfilment service" maxLength={200} />
        </Field>
        <div>
          <span className="mb-1.5 block text-[12.5px] font-medium text-text-2">Events to send</span>
          <EventFilterPicker value={events} onChange={setEvents} />
        </div>
        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={invalid}>{endpoint ? "Save changes" : "Add endpoint"}</Button>
        </div>
      </form>
    </Modal>
  );
}
