"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { CreditEntry } from "@/lib/merchant/types";
import { Button, ErrorNote, Field, Input, Select } from "@/components/ui";
import { useToast } from "../context";

/** Operations accepted by CreditService.Apply (backend Modules/Billing/Fulfillment.cs). */
export const CREDIT_OPERATIONS = [
  { value: "issue", label: "Issue (grant)", help: "Adds credits to the available balance." },
  { value: "consume", label: "Consume", help: "Uses available credits. Fails if the balance is too low." },
  { value: "reserve", label: "Reserve", help: "Moves available credits into a hold, e.g. while a job runs." },
  { value: "release", label: "Release reservation", help: "Returns held credits to the available balance." },
  { value: "consume_reserved", label: "Consume reserved", help: "Uses credits that were held by a reservation." },
  { value: "refund", label: "Refund", help: "Gives credits back after a failed or reversed use." },
  { value: "expire", label: "Expire", help: "Removes up to this many available credits." },
  { value: "adjust", label: "Adjust (signed)", help: "Manual correction. Use a negative number to remove credits." },
] as const;

export function CreditOperationForm({ customerId, creditType, onDone }: { customerId: string; creditType: string; onDone: () => void }) {
  const toast = useToast();
  const [operation, setOperation] = useState<string>("issue");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  // One ledger idempotency key per intended operation: the credit service only records it on success, so a
  // retry after a lost response returns the original entry instead of applying the operation twice.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const signed = operation === "adjust";
  const n = Number(amount);
  const invalid = amount.trim() === "" || !Number.isSafeInteger(n) || (signed ? n === 0 : n <= 0);
  const op = CREDIT_OPERATIONS.find((o) => o.value === operation);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const entry = await api<CreditEntry>("/v1/credits", {
        body: { customer: customerId, operation, amount: n, credit_type: creditType, idempotency_key: key, description: description.trim() || undefined },
      });
      toast(`${op?.label ?? "Operation"} applied · balance ${entry.balance_after.toLocaleString("en-US")}`);
      setAmount("");
      setDescription("");
      setKey(crypto.randomUUID());
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Operation" hint={op?.help}>
        <Select value={operation} onChange={(e) => { setOperation(e.target.value); setKey(crypto.randomUUID()); }}>
          {CREDIT_OPERATIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </Field>
      <Field label={`Amount (${creditType})`} error={amount && invalid ? (signed ? "Whole number, not zero." : "Whole number greater than zero.") : null}>
        <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.trim())} placeholder={signed ? "e.g. -50" : "e.g. 500"} required />
      </Field>
      <Field label="Description (optional)" hint="Shown in the ledger.">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
      </Field>
      <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
      <Button type="submit" loading={busy} disabled={invalid} className="w-full">Apply {op?.label.toLowerCase() ?? ""}</Button>
    </form>
  );
}
