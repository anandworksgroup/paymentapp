"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { flag, money } from "@/lib/format";
import { useAction } from "@/lib/merchant/hooks";
import { CURRENCIES } from "@/lib/merchant/money";
import { Amount, Button, Empty, ErrorNote, Field, Input, Modal, Select } from "@/components/ui";
import { useMerchant, useStepUp, useToast } from "../context";
import { Help } from "../common";
import { Icon } from "../icons";
import { useCountries } from "../useMeta";
import { bpsLabel, percentToBps } from "./helpers";
import type { Seller, SellerBalanceRow, SellerPayment, SellerPayout } from "./types";

/** The marketplace flag is off for this organization (POST /v1/sellers → 403 feature_unavailable). */
export function isFeatureUnavailable(e: unknown) {
  return e instanceof ApiError && e.code === "feature_unavailable";
}

export function MarketplaceUnavailable({ action }: { action?: React.ReactNode }) {
  return (
    <Empty title="Marketplace isn't switched on for your account yet" icon={<Icon name="store" />} action={action}>
      Selling on behalf of other sellers (split payouts and commissions) is rolled out account by account. Ask the platform
      team through Support to enable the marketplace for this organization — nothing else needs to change on your side.
    </Empty>
  );
}

export function OnboardSellerModal({ onClose, onCreated }: { onClose: () => void; onCreated: (s: Seller) => void }) {
  const { org } = useMerchant();
  const countries = useCountries();
  const toast = useToast();
  const [f, setF] = useState({ name: "", email: "", country: org.country, currency: org.default_currency, commission: "10" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const bps = percentToBps(f.commission, 0, 5000);
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim());
  const invalid = !f.name.trim() || !emailOk || bps === null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api<Seller>("/v1/sellers", {
        body: { name: f.name.trim(), email: f.email.trim(), country: f.country, currency: f.currency, commission_bps: bps },
      });
      toast(s.status === "active" ? `${s.name} is ready to sell` : `${s.name} was added and is waiting for review`);
      onCreated(s);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const countryOptions = countries.length ? countries.filter((c) => c.merchant_onboarding_enabled || c.country === f.country) : [{ country: org.country, name: org.country }];

  if (isFeatureUnavailable(error))
    return (
      <Modal open onClose={onClose} title="Onboard a seller">
        <MarketplaceUnavailable action={<Button variant="soft" onClick={onClose}>Close</Button>} />
      </Modal>
    );

  return (
    <Modal open onClose={onClose} title="Onboard a seller" wide>
      <form onSubmit={submit} className="space-y-4">
        <Help>
          Sellers are the businesses you sell for. Each sale is split at payment time and the seller&apos;s share is kept in its own balance, separate
          from yours. The seller is screened against sanctions lists; a clean result activates it straight away, a possible match waits for review.
        </Help>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Seller name">
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} required autoFocus placeholder="Maple Crafts Ltd" />
          </Field>
          <Field label="Contact email" error={f.email && !emailOk ? "Enter a valid email address." : null}>
            <Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} required placeholder="payouts@maple.example" />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Country">
            <Select value={f.country} onChange={(e) => set("country", e.target.value)}>
              {countryOptions.map((c) => <option key={c.country} value={c.country}>{flag(c.country)} {c.name}</option>)}
            </Select>
          </Field>
          <Field label="Default currency">
            <Select value={f.currency} onChange={(e) => set("currency", e.target.value)}>
              {[...new Set([org.default_currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Your commission" error={f.commission && bps === null ? "0–50%, up to 2 decimals." : null} hint="Kept by you on each sale.">
            <div className="relative">
              <Input inputMode="decimal" value={f.commission} onChange={(e) => set("commission", e.target.value)} className="pr-10" />
              <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] text-muted">%</span>
            </div>
          </Field>
        </div>
        <SplitFormula commissionBps={bps ?? 0} />
        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={invalid}>Onboard seller</Button>
        </div>
      </form>
    </Modal>
  );
}

/** The split rule in words, so the commission field is never ambiguous. */
export function SplitFormula({ commissionBps }: { commissionBps?: number }) {
  const steps: [string, string][] = [
    ["Sale", "what the buyer paid"],
    ["− Tax", "remitted by us as Merchant of Record"],
    ["− MoR fee", "the platform's processing fee"],
    [commissionBps === undefined ? "− Your commission" : `− Commission ${bpsLabel(commissionBps)}`, "of the sale excluding tax, kept by you"],
  ];
  return (
    <div className="rounded-inner bg-surface-2 p-4">
      <div className="mb-2 text-[12.5px] font-medium text-text-2">How each sale is split</div>
      <ol className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        {steps.map(([k, hint]) => (
          <li key={k} className="rounded-full bg-surface px-3 py-1 text-text" title={hint}>{k}</li>
        ))}
        <li aria-hidden className="px-1 text-muted">=</li>
        <li className="rounded-full bg-sage-100 px-3 py-1 font-medium text-sage-700">Seller share</li>
      </ol>
      <p className="mt-2 text-[12px] text-muted">Refunds and chargebacks take back the seller&apos;s proportional share automatically.</p>
    </div>
  );
}

/** Waterfall for one payment: sale − tax − MoR fee − commission = seller share (all from the API). */
export function SplitBreakdown({ p }: { p: SellerPayment }) {
  const rows: { label: string; hint: string; minor: number; tone?: "sub" | "result" }[] = [
    { label: "Sale", hint: "Buyer paid, including tax", minor: p.amount },
    { label: "Tax", hint: "Remitted by the Merchant of Record", minor: -p.tax_amount, tone: "sub" },
    { label: "MoR fee", hint: "Platform processing fee", minor: -p.fee_amount, tone: "sub" },
    { label: "Your commission", hint: "Application fee on the sale excluding tax", minor: -p.application_fee_amount, tone: "sub" },
    { label: "Seller share", hint: "Credited to the seller's pending balance", minor: p.seller_amount, tone: "result" },
  ];
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li
          key={r.label}
          className={r.tone === "result" ? "flex items-center justify-between gap-3 rounded-inner sage-gradient px-4 py-3" : "flex items-center justify-between gap-3 rounded-[14px] bg-surface-2 px-4 py-2.5"}
        >
          <span className="min-w-0">
            <span className={r.tone === "result" ? "block text-[13.5px] font-medium text-text" : "block text-[13px] text-text"}>{r.label}</span>
            <span className="block text-[11.5px] text-muted">{r.hint}</span>
          </span>
          <Amount minor={r.minor} currency={p.currency} size={r.tone === "result" ? "md" : "sm"} />
        </li>
      ))}
    </ul>
  );
}

/** Bank details for seller payouts. Changing them always needs a fresh re-authentication. */
export function PayoutAccountModal({ seller, onClose, onSaved }: { seller: Seller; onClose: () => void; onSaved: (s: Seller) => void }) {
  const withStepUp = useStepUp();
  const toast = useToast();
  const [bank, setBank] = useState(seller.payout_bank_name ?? "");
  const [currency, setCurrency] = useState(seller.payout_currency ?? seller.default_currency);
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const digits = number.replace(/[^a-z0-9]/gi, "");
  const numberBad = number !== "" && (digits.length < 6 || digits.length > 34);
  const invalid = !bank.trim() || digits.length < 6 || digits.length > 34;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const s = await withStepUp(() => api<Seller>(`/v1/sellers/${seller.id}/payout_account`, { body: { bank_name: bank.trim(), currency, account_number: number.trim() } }));
      toast(`Payout account ••••${s.payout_last4} saved`);
      onSaved(s);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={seller.payout_last4 ? "Replace payout account" : "Add payout account"}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-[13px] text-muted">
          Where {seller.name}&apos;s available balance is paid out. The account number is encrypted and only the last 4 digits are shown afterwards.
          You&apos;ll confirm your password; the change is recorded in the audit log.
        </p>
        <Field label="Bank name">
          <Input value={bank} onChange={(e) => setBank(e.target.value)} required autoFocus autoComplete="off" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
          <Field label="Account number or IBAN" error={numberBad ? "Enter 6–34 letters or digits." : null}>
            <Input value={number} onChange={(e) => setNumber(e.target.value)} required autoComplete="off" spellCheck={false} className="font-mono" />
          </Field>
          <Field label="Currency" hint="Payouts go out in this currency only.">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {[...new Set([seller.default_currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        </div>
        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={invalid}>Save payout account</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Pays out the seller's whole available balance in one currency to its payout account. */
export function SellerPayoutModal({ seller, balances, onClose, onDone }: { seller: Seller; balances: SellerBalanceRow[]; onClose: () => void; onDone: (p: SellerPayout) => void }) {
  const withStepUp = useStepUp();
  const toast = useToast();
  const act = useAction();
  const payable = balances.filter((b) => b.available > 0);
  const initial = payable.find((b) => b.currency === seller.payout_currency)?.currency ?? payable[0]?.currency ?? seller.payout_currency ?? seller.default_currency;
  const [currency, setCurrency] = useState(initial);
  const row = balances.find((b) => b.currency === currency);
  const mismatch = !!seller.payout_currency && seller.payout_currency !== currency;
  const blocked = !seller.payout_last4 || mismatch || !row || row.available <= 0 || seller.status !== "active";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blocked) return;
    const p = await act.run(() => withStepUp(() => api<SellerPayout>(`/v1/sellers/${seller.id}/payouts`, { body: { currency } })));
    if (p) {
      toast(`Payout of ${money(p.amount, p.currency)} to ••••${p.bank_last4 ?? seller.payout_last4} created`);
      onDone(p);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Pay out ${seller.name}`}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-[13.5px] text-muted">
          Sends the seller&apos;s full available balance to their bank account. Pending funds become available after your settlement delay.
        </p>
        {balances.length > 1 && (
          <Field label="Currency">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {balances.map((b) => <option key={b.currency} value={b.currency}>{b.currency}</option>)}
            </Select>
          </Field>
        )}
        <div className="rounded-inner bg-surface-2 px-5 py-4">
          <div className="text-[12.5px] text-muted">Available to pay out</div>
          <Amount minor={row?.available ?? 0} currency={currency} size="md" className="mt-1" />
          <div className="mt-2 text-[12.5px] text-text-2">
            {seller.payout_last4 ? <>To {seller.payout_bank_name ?? "bank"} ••••{seller.payout_last4} ({seller.payout_currency})</> : "No payout account yet"}
          </div>
        </div>
        {seller.status !== "active" && <ErrorNote error={{ message: "Payouts are available once the seller is active." }} />}
        {!seller.payout_last4 && <ErrorNote error={{ message: "Add a payout account for this seller first." }} />}
        {mismatch && <ErrorNote error={{ message: `The payout account is in ${seller.payout_currency}. Add a ${currency} account to pay out this balance.` }} />}
        <div aria-live="assertive">{act.error ? <ErrorNote error={act.error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={act.busy} disabled={blocked}>{row && row.available > 0 ? `Pay out ${money(row.available, currency)}` : "Nothing to pay out"}</Button>
        </div>
      </form>
    </Modal>
  );
}
