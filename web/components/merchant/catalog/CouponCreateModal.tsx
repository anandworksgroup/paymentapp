"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { toMinor, CURRENCIES } from "@/lib/merchant/money";
import type { Coupon } from "@/lib/merchant/types";
import { Button, ErrorNote, Field, Input, Modal, Segmented, Select } from "@/components/ui";
import { useMerchant, useToast } from "../context";
import { MoneyInput } from "../common";
import { localToIso, parseCount } from "../sales/links";
import { CheckField } from "./fields";

type Kind = "percent" | "amount";
type Duration = "once" | "repeating" | "forever";

/** "15" → 1500, "12.5" → 1250 basis points; null when not a percentage with ≤ 2 decimals in (0, 100]. */
function percentToBps(s: string): number | null {
  const v = s.trim().replace(/%$/, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(v)) return null;
  const [w, f = ""] = v.split(".");
  const bps = Number(w) * 100 + Number(f.padEnd(2, "0"));
  return bps >= 1 && bps <= 10_000 ? bps : null;
}

export function CouponCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Coupon) => void }) {
  const { org } = useMerchant();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("percent");
  const [percent, setPercent] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(org.default_currency);
  const [duration, setDuration] = useState<Duration>("once");
  const [months, setMonths] = useState("3");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [expires, setExpires] = useState("");
  const [countries, setCountries] = useState("");
  const [firstTime, setFirstTime] = useState(false);
  const [autoApply, setAutoApply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const bps = kind === "percent" ? percentToBps(percent) : null;
  const amountMinor = kind === "amount" ? toMinor(amount, currency) : null;
  const monthsN = duration === "repeating" ? parseCount(months) : null;
  const maxN = maxRedemptions.trim() ? parseCount(maxRedemptions) : null;
  const countryList = countries.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
  const badCountry = countryList.find((c) => !/^[A-Z]{2}$/.test(c));
  const codeOk = /^[A-Za-z0-9_-]{3,40}$/.test(code.trim());

  const errors = {
    code: code && !codeOk ? "3–40 letters, numbers, dashes or underscores." : null,
    percent: percent && bps === null ? "A percentage between 0.01 and 100, e.g. 15." : null,
    amount: amount && (amountMinor === null || amountMinor <= 0) ? "Enter a positive amount like 10.00." : null,
    months: duration === "repeating" && months && monthsN === null ? "Whole number of months." : null,
    max: maxRedemptions.trim() && maxN === null ? "Whole number, 1 or more." : null,
    countries: badCountry ? `“${badCountry}” isn't a 2-letter country code.` : null,
  };
  const invalid =
    !codeOk || (kind === "percent" ? bps === null : !amountMinor || amountMinor <= 0) || (duration === "repeating" && monthsN === null) || (!!maxRedemptions.trim() && maxN === null) || !!badCountry;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const c = await api<Coupon>("/v1/coupons", {
        body: {
          code: code.trim().toUpperCase(),
          name: name.trim() || undefined,
          percent_off_bps: kind === "percent" ? bps : undefined,
          amount_off: kind === "amount" ? amountMinor : undefined,
          currency: kind === "amount" ? currency : undefined,
          duration,
          duration_in_months: duration === "repeating" ? monthsN : undefined,
          max_redemptions: maxN ?? undefined,
          expires_at: localToIso(expires),
          countries: countryList.length ? countryList.join(",") : undefined,
          first_time_only: firstTime,
          auto_apply: autoApply,
        },
      });
      toast(`Coupon ${c.code} created`);
      onCreated(c);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Create coupon" wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Code" error={errors.code} hint="What customers type at checkout. Saved in capitals.">
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required autoFocus placeholder="SPRING15" className="font-mono" />
          </Field>
          <Field label="Name (optional)" hint="Shown on receipts and invoices.">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring sale" />
          </Field>
        </div>

        <Segmented<Kind> value={kind} onChange={setKind} options={[{ value: "percent", label: "Percentage off" }, { value: "amount", label: "Fixed amount off" }]} />
        {kind === "percent" ? (
          <Field label="Percent off" error={errors.percent}>
            <div className="relative">
              <Input inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="15" className="pr-10" />
              <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] text-muted">%</span>
            </div>
          </Field>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
            <Field label="Amount off" error={errors.amount} hint="Applies only to purchases in this currency.">
              <MoneyInput currency={currency} value={amount} onChange={setAmount} placeholder="10.00" />
            </Field>
            <Field label="Currency">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {(CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Duration" hint="For subscriptions: how many invoices get the discount.">
            <Select value={duration} onChange={(e) => setDuration(e.target.value as Duration)}>
              <option value="once">Once</option>
              <option value="repeating">Several months</option>
              <option value="forever">Forever</option>
            </Select>
          </Field>
          {duration === "repeating" && (
            <Field label="Number of months" error={errors.months}>
              <Input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />
            </Field>
          )}
          <Field label="Max redemptions (optional)" error={errors.max} hint="Blank = unlimited.">
            <Input inputMode="numeric" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Expires (optional)">
            <Input type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </Field>
          <Field label="Countries (optional)" error={errors.countries} hint="Comma-separated ISO codes, e.g. IN,US. Blank = everywhere.">
            <Input value={countries} onChange={(e) => setCountries(e.target.value.toUpperCase())} placeholder="IN,US" />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <CheckField label="First purchase only" hint="Only customers without a previous order can use it." checked={firstTime} onChange={setFirstTime} />
          <CheckField label="Apply automatically" hint="Added at checkout without the customer typing the code, when eligible." checked={autoApply} onChange={setAutoApply} />
        </div>

        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={invalid}>Create coupon</Button>
        </div>
      </form>
    </Modal>
  );
}
