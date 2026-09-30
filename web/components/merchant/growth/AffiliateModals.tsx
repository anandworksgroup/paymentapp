"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { CURRENCIES, toMinor } from "@/lib/merchant/money";
import { Button, ErrorNote, Field, Input, Modal, Segmented, Select } from "@/components/ui";
import { useMerchant, useToast } from "../context";
import { Help, MoneyInput } from "../common";
import { APP_ORIGIN, parseCount } from "../sales/links";
import { bpsLabel, percentToBps } from "./helpers";
import type { Affiliate } from "./types";

type Kind = "percentage" | "fixed";
type Duration = "first_payment" | "recurring" | "months";

/** "10% of every payment for 12 months", "$5.00 USD on the first payment". */
export function commissionLabel(a: Pick<Affiliate, "commission_type" | "rate_bps" | "fixed_amount" | "fixed_currency" | "duration" | "duration_months">) {
  const fixed = a.commission_type === "fixed" && !!a.fixed_currency;
  const what = a.commission_type === "fixed" && a.fixed_currency ? money(a.fixed_amount, a.fixed_currency, { code: true }) : bpsLabel(a.rate_bps);
  const months = `${a.duration_months ?? 0} month${a.duration_months === 1 ? "" : "s"}`;
  const which = a.duration === "recurring" ? "every payment" : a.duration === "months" ? `every payment for ${months}` : "the first payment";
  return `${what} ${fixed ? "on" : "of"} ${which}`;
}

export function referralUrl(code: string) {
  return `${APP_ORIGIN}/pay/plink_…?ref=${code}`;
}

export function CreateAffiliateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (a: Affiliate) => void }) {
  const { org } = useMerchant();
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<Kind>("percentage");
  const [rate, setRate] = useState("20");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(org.default_currency);
  const [duration, setDuration] = useState<Duration>("first_payment");
  const [months, setMonths] = useState("12");
  const [hold, setHold] = useState("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const cleanCode = code.trim().toUpperCase();
  const codeOk = /^[A-Z0-9-]{3,30}$/.test(cleanCode);
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const bps = kind === "percentage" ? percentToBps(rate, 1, 9000) : null;
  const fixed = kind === "fixed" ? toMinor(amount, currency) : null;
  const monthsN = duration === "months" ? parseCount(months) : null;
  const holdN = parseCount(hold, 0);

  const errors = {
    code: code && !codeOk ? "3–30 letters, digits or dashes." : null,
    email: email && !emailOk ? "Enter a valid email address." : null,
    rate: kind === "percentage" && rate && bps === null ? "Between 0.01% and 90%." : null,
    amount: kind === "fixed" && amount && (!fixed || fixed <= 0) ? "Enter a positive amount like 5.00." : null,
    months: duration === "months" && months && monthsN === null ? "Whole number of months." : null,
    hold: hold && (holdN === null || holdN > 180) ? "0–180 days." : null,
  };
  const invalid =
    !name.trim() || !emailOk || !codeOk || (kind === "percentage" ? bps === null : !fixed || fixed <= 0) || (duration === "months" && monthsN === null) || holdN === null || holdN > 180;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const a = await api<Affiliate>("/v1/affiliates", {
        body: {
          name: name.trim(), email: email.trim(), code: cleanCode, commission_type: kind,
          rate_bps: kind === "percentage" ? bps : undefined,
          fixed_amount: kind === "fixed" ? fixed : undefined,
          fixed_currency: kind === "fixed" ? currency : undefined,
          duration, duration_months: duration === "months" ? monthsN : undefined, hold_days: holdN,
        },
      });
      toast(`Affiliate ${a.code} created`);
      onCreated(a);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="New affiliate" wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="Jane Doe" />
          </Field>
          <Field label="Email" error={errors.email}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="jane@example.com" />
          </Field>
        </div>
        <Field label="Referral code" error={errors.code} hint={codeOk ? <>Share links like <span className="font-mono">{referralUrl(cleanCode)}</span></> : "Letters, digits and dashes. Saved in capitals."}>
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required placeholder="JANE20" className="font-mono" />
        </Field>

        <Segmented<Kind> value={kind} onChange={setKind} options={[{ value: "percentage", label: "Percentage" }, { value: "fixed", label: "Fixed amount" }]} />
        {kind === "percentage" ? (
          <Field label="Commission rate" error={errors.rate} hint="Of the payment amount excluding tax.">
            <div className="relative">
              <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="pr-10" />
              <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] text-muted">%</span>
            </div>
          </Field>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
            <Field label="Commission per payment" error={errors.amount}>
              <MoneyInput currency={currency} value={amount} onChange={setAmount} placeholder="5.00" />
            </Field>
            <Field label="Currency">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {[...new Set([org.default_currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Pays commission on">
            <Select value={duration} onChange={(e) => setDuration(e.target.value as Duration)}>
              <option value="first_payment">First payment only</option>
              <option value="recurring">Every payment</option>
              <option value="months">Payments for N months</option>
            </Select>
          </Field>
          {duration === "months" && (
            <Field label="Months" error={errors.months}>
              <Input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />
            </Field>
          )}
          <Field label="Hold period" error={errors.hold} hint="Days before a commission is approved.">
            <div className="relative">
              <Input inputMode="numeric" value={hold} onChange={(e) => setHold(e.target.value)} className="pr-14" />
              <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] text-muted">days</span>
            </div>
          </Field>
        </div>
        <Help>
          Commissions start as pending. After the hold period they&apos;re approved and accrued in your ledger; refunds or chargebacks inside the hold
          period reverse them. You pay approved commissions from the affiliate&apos;s page.
        </Help>

        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={invalid}>Create affiliate</Button>
        </div>
      </form>
    </Modal>
  );
}
