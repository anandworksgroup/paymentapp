"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { toMinor } from "@/lib/merchant/money";
import type { Payment } from "@/lib/merchant/types";
import { Button, ErrorNote, Field, Modal, Segmented, Select } from "@/components/ui";
import { MoneyInput } from "../common";
import { useStepUp, useToast } from "../context";

/**
 * Full or partial refund. The server decides what is refundable and whether this amount needs a
 * recent re-authentication (≥ $1,000 equivalent); step-up is handled transparently.
 */
export function RefundModal({ payment, open, onClose, onDone }: { payment: Payment; open: boolean; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"full" | "partial">("full");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("requested_by_customer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const withStepUp = useStepUp();
  const toast = useToast();

  const minor = mode === "full" ? null : toMinor(amount, payment.currency);
  const invalid = mode === "partial" && (minor === null || minor <= 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      await withStepUp(() => api("/v1/refunds", { body: { payment: payment.id, amount: mode === "full" ? undefined : minor, reason } }));
      toast("Refund created");
      onDone();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Refund payment">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-[13.5px] text-muted">
          Captured <span className="text-text">{money(payment.amount_captured, payment.currency, { code: true })}</span>
          {payment.amount_refunded > 0 && <> · already refunded <span className="text-text">{money(payment.amount_refunded, payment.currency)}</span></>}
          {payment.amount_disputed > 0 && <> · disputed <span className="text-text">{money(payment.amount_disputed, payment.currency)}</span></>}.
          A full refund returns whatever is still refundable; the tax portion is refunded proportionally. Refunds of $1,000 or more ask for your password.
        </p>
        <Segmented<"full" | "partial"> value={mode} onChange={setMode} options={[{ value: "full", label: "Full refund" }, { value: "partial", label: "Partial" }]} />
        {mode === "partial" && (
          <Field label="Amount to refund" error={amount && invalid ? "Enter a positive amount with at most the currency's decimals." : null}>
            <MoneyInput currency={payment.currency} value={amount} onChange={setAmount} required autoFocus />
          </Field>
        )}
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="requested_by_customer">Requested by customer</option>
            <option value="duplicate">Duplicate</option>
            <option value="fraudulent">Fraudulent</option>
          </Select>
        </Field>
        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" loading={busy} disabled={invalid}>
            {mode === "full" ? "Refund in full" : `Refund ${minor ? money(minor, payment.currency) : ""}`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
