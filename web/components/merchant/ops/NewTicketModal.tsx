"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Button, ErrorNote, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { useToast } from "../context";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, type SupportTicket } from "./types";

export function NewTicketModal({ onClose, onCreated, related }: { onClose: () => void; onCreated: (t: SupportTicket) => void; related?: string }) {
  const toast = useToast();
  const [f, setF] = useState({ subject: "", category: related?.startsWith("pay_") ? "payment_issue" : "bug", priority: "normal", related_object_id: related ?? "", body: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const invalid = !f.subject.trim() || !f.body.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const t = await api<SupportTicket>("/v1/support/tickets", {
        body: { subject: f.subject.trim(), category: f.category, priority: f.priority, related_object_id: f.related_object_id.trim() || undefined, body: f.body.trim() },
      });
      toast("Ticket sent to support");
      onCreated(t);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Contact support" wide>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Subject">
          <Input value={f.subject} onChange={(e) => set("subject", e.target.value)} maxLength={200} required autoFocus placeholder="A short summary of the problem" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Category">
            <Select value={f.category} onChange={(e) => set("category", e.target.value)}>
              {TICKET_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Priority" hint="Urgent is for live payments failing now.">
            <Select value={f.priority} onChange={(e) => set("priority", e.target.value)}>
              {TICKET_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </Field>
          <Field label="Related object (optional)" hint="A payment, invoice or subscription id.">
            <Input value={f.related_object_id} onChange={(e) => set("related_object_id", e.target.value)} placeholder="pay_…" spellCheck={false} className="font-mono" />
          </Field>
        </div>
        <Field label="Message" hint="What happened, what you expected, and when. Never include card numbers or passwords.">
          <Textarea value={f.body} onChange={(e) => set("body", e.target.value)} required rows={6} maxLength={10000} />
        </Field>
        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={invalid}>Send to support</Button>
        </div>
      </form>
    </Modal>
  );
}
