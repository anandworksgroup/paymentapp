"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { date } from "@/lib/format";
import { useAction } from "@/lib/merchant/hooks";
import { Button, ErrorNote, Field, Modal, Segmented, Select, Textarea } from "@/components/ui";
import { ConfirmModal } from "../common";
import { useToast } from "../context";
import type { SubscriptionFull } from "./types";

const REASONS = [
  { value: "requested_by_customer", label: "Requested by customer" },
  { value: "too_expensive", label: "Too expensive" },
  { value: "switched_service", label: "Switched to another service" },
  { value: "unused", label: "Not using it" },
  { value: "payment_failed", label: "Payment failed" },
  { value: "other", label: "Other" },
];

/** POST /v1/subscriptions/{id}/cancel {at_period_end, reason}. */
export function CancelSubscriptionModal({ sub, onClose, onDone }: { sub: SubscriptionFull; onClose: () => void; onDone: () => void }) {
  const incomplete = sub.status === "INCOMPLETE";
  const [when, setWhen] = useState<"period_end" | "now">(incomplete || sub.cancel_at_period_end ? "now" : "period_end");
  const [reason, setReason] = useState("requested_by_customer");
  const [note, setNote] = useState("");
  const act = useAction();
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fullReason = note.trim() ? `${reason}: ${note.trim()}` : reason;
    const r = await act.run(() => api(`/v1/subscriptions/${sub.id}/cancel`, { body: { at_period_end: when === "period_end", reason: fullReason } }));
    if (r) {
      toast(when === "period_end" ? "Subscription will cancel at period end" : "Subscription cancelled");
      onDone();
    }
  };

  return (
    <Modal open onClose={onClose} title="Cancel subscription">
      <form onSubmit={submit} className="space-y-4">
        {!incomplete && (
          <Segmented<"period_end" | "now">
            value={when}
            onChange={setWhen}
            options={[
              ...(sub.cancel_at_period_end ? [] : [{ value: "period_end" as const, label: "At period end" }]),
              { value: "now", label: "Immediately" },
            ]}
          />
        )}
        <p className="text-[13.5px] text-muted">
          {when === "period_end"
            ? `The customer keeps access until ${date(sub.current_period_end)} and is not billed again. You can still cancel immediately later.`
            : "Access ends now and entitlements are revoked. No automatic refund is made for the unused part of the period; refund the last payment separately if needed."}
        </p>
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
        </Field>
        <Field label="Note (optional)">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Field>
        <div aria-live="assertive">{act.error ? <ErrorNote error={act.error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Keep subscription</Button>
          <Button type="submit" variant="danger" loading={act.busy}>{when === "period_end" ? "Cancel at period end" : "Cancel now"}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Pause (ACTIVE → PAUSED) or resume (PAUSED → ACTIVE, starts and bills a fresh period). */
export function PauseResumeModal({ sub, mode, onClose, onDone }: { sub: SubscriptionFull; mode: "pause" | "resume"; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const toast = useToast();
  return (
    <ConfirmModal
      open
      onClose={onClose}
      title={mode === "pause" ? "Pause subscription?" : "Resume subscription?"}
      confirmLabel={mode === "pause" ? "Pause" : "Resume"}
      busy={act.busy}
      error={act.error}
      onConfirm={async () => {
        const r = await act.run(() => api(`/v1/subscriptions/${sub.id}/${mode}`, { method: "POST" }));
        if (r) {
          toast(mode === "pause" ? "Subscription paused" : "Subscription resumed");
          onDone();
        }
      }}
    >
      {mode === "pause"
        ? <p>Renewals stop while the subscription is paused, so the customer isn&apos;t billed. Entitlements are kept.</p>
        : <p>Resuming starts a new billing period today and invoices it immediately, charging the saved payment method when collection is automatic.</p>}
      {mode === "resume" && sub.cancel_at_period_end && (
        <p className="rounded-inner bg-peach-soft px-4 py-3 text-peach-ink">This subscription is set to cancel at the end of its period, so resuming it ends it right away instead of billing a new period.</p>
      )}
    </ConfirmModal>
  );
}
