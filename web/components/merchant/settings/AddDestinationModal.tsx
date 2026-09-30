"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { CURRENCIES } from "@/lib/merchant/money";
import type { PayoutDestination } from "@/lib/merchant/types";
import { Button, ErrorNote, Field, Input, Modal, Select } from "@/components/ui";
import { flag } from "@/lib/format";
import { useMerchant, useStepUp, useToast } from "../context";
import { useCountries } from "../useMeta";

export function AddDestinationModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { org } = useMerchant();
  const countries = useCountries();
  const withStepUp = useStepUp();
  const toast = useToast();
  const [f, setF] = useState({ country: org.country, currency: org.default_currency, account_holder: "", bank_name: "", account_number: "", routing_number: "", swift: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const digits = f.account_number.replace(/[^a-z0-9]/gi, "");
  const numberBad = f.account_number !== "" && (digits.length < 6 || digits.length > 34);
  const invalid = !f.account_holder.trim() || !f.bank_name.trim() || digits.length < 6 || digits.length > 34;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        country: f.country, currency: f.currency, account_holder: f.account_holder.trim(), bank_name: f.bank_name.trim(), account_number: f.account_number.trim(),
        routing_number: f.routing_number.trim() || undefined, swift: f.swift.trim().toUpperCase() || undefined,
      };
      // Bank-account changes always need a fresh re-authentication.
      const d = await withStepUp(() => api<PayoutDestination>("/v1/payout_destinations", { body }));
      toast(`Bank account ••••${d.last4} added`);
      onDone();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const countryOptions = countries.length ? countries : [{ country: org.country, name: org.country }];

  return (
    <Modal open onClose={onClose} title="Add a bank account">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-[13px] text-muted">
          The new account becomes the default for its currency. You&apos;ll confirm your password, and the change is recorded in the audit log and as a security event (Settings → Security).
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Bank country">
            <Select value={f.country} onChange={(e) => set("country", e.target.value)}>
              {countryOptions.map((c) => <option key={c.country} value={c.country}>{flag(c.country)} {c.name}</option>)}
            </Select>
          </Field>
          <Field label="Currency">
            <Select value={f.currency} onChange={(e) => set("currency", e.target.value)}>
              {[...new Set([org.default_currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Account holder name" hint="Must match the legal name on the bank account.">
          <Input value={f.account_holder} onChange={(e) => set("account_holder", e.target.value)} required autoComplete="off" autoFocus />
        </Field>
        <Field label="Bank name">
          <Input value={f.bank_name} onChange={(e) => set("bank_name", e.target.value)} required autoComplete="off" />
        </Field>
        <Field label="Account number or IBAN" error={numberBad ? "Enter 6–34 letters or digits." : null}>
          <Input value={f.account_number} onChange={(e) => set("account_number", e.target.value)} required autoComplete="off" spellCheck={false} className="font-mono" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Routing / sort code (optional)">
            <Input value={f.routing_number} onChange={(e) => set("routing_number", e.target.value)} autoComplete="off" className="font-mono" />
          </Field>
          <Field label="SWIFT / BIC (optional)">
            <Input value={f.swift} onChange={(e) => set("swift", e.target.value)} autoComplete="off" maxLength={11} className="font-mono uppercase" />
          </Field>
        </div>
        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={invalid}>Add bank account</Button>
        </div>
      </form>
    </Modal>
  );
}
