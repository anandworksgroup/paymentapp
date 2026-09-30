"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { titleCase } from "@/lib/format";
import { Button, Card, CardHeader, ErrorNote, Field, Select, Textarea } from "@/components/ui";
import { ConfirmModal } from "../common";
import { useToast } from "../context";
import { Icon } from "../icons";

export const EVIDENCE_TYPES = [
  "product_description", "customer_communication", "receipt", "service_documentation",
  "refund_policy", "terms_acceptance", "usage_logs", "other",
];

export type DraftItem = { id: string; type: string; text: string };

/**
 * Evidence response. Items can be saved as a draft (added to the dispute without submitting) or
 * submitted, which sends the whole response for review and can't be undone.
 */
export function EvidenceForm({ disputeId, items, setItems, hasSaved, onDone }: {
  disputeId: string; items: DraftItem[]; setItems: (fn: (prev: DraftItem[]) => DraftItem[]) => void; hasSaved: boolean; onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirm, setConfirm] = useState(false);
  const filled = items.filter((i) => i.text.trim());
  const blank = items.length > 0 && filled.length !== items.length;

  const update = (id: string, patch: Partial<DraftItem>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const add = () => setItems((prev) => [...prev, { id: crypto.randomUUID(), type: "product_description", text: "" }]);
  const remove = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));

  const send = async (submit: boolean) => {
    setBusy(submit ? "submit" : "draft");
    setError(null);
    try {
      await api(`/v1/disputes/${disputeId}/evidence`, { body: { evidence: filled.map((i) => ({ type: i.type, text: i.text.trim() })), submit } });
      toast(submit ? "Evidence submitted for review" : "Draft saved");
      setItems(() => []);
      setConfirm(false);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Your response"
        subtitle="Explain what was purchased and show it was delivered. Clear, factual evidence works best."
        action={<Button size="sm" variant="soft" icon={<Icon name="plus" size={14} />} onClick={add}>Add item</Button>}
      />
      {items.length === 0 ? (
        <p className="rounded-inner bg-surface-2 px-4 py-4 text-[13px] text-muted">
          No new evidence yet. Use &ldquo;Add to response&rdquo; on the evidence we already have, or add your own item.
        </p>
      ) : (
        <ol className="space-y-3">
          {items.map((it, n) => (
            <li key={it.id} className="rounded-inner bg-surface-2 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-[12.5px] text-muted">Item {n + 1}</span>
                <Button size="sm" variant="ghost" onClick={() => remove(it.id)} aria-label={`Remove item ${n + 1}`}>Remove</Button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                <Field label="Type">
                  <Select value={it.type} onChange={(e) => update(it.id, { type: e.target.value })}>
                    {EVIDENCE_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
                  </Select>
                </Field>
                <Field label="Details" error={!it.text.trim() ? "Add some text or remove this item." : null}>
                  <Textarea value={it.text} onChange={(e) => update(it.id, { text: e.target.value })} rows={4} />
                </Field>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div aria-live="assertive" className="mt-4">{error && !confirm ? <ErrorNote error={error} /> : null}</div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button variant="soft" loading={busy === "draft"} disabled={!filled.length || blank || busy !== null} onClick={() => send(false)}>Save draft</Button>
        <Button loading={busy === "submit"} disabled={(!filled.length && !hasSaved) || blank || busy !== null} onClick={() => { setError(null); setConfirm(true); }}>
          Submit evidence
        </Button>
      </div>
      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Submit your response?"
        confirmLabel="Submit evidence"
        busy={busy === "submit"}
        error={error}
        onConfirm={() => send(true)}
      >
        <p>
          {filled.length ? `${filled.length} new item${filled.length === 1 ? "" : "s"} and all saved evidence` : "All saved evidence"} will be sent for review.
          You won&apos;t be able to add more evidence afterwards.
        </p>
      </ConfirmModal>
    </Card>
  );
}
