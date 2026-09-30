"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { CheckoutSession, Price } from "@/lib/merchant/types";
import { Amount, Button, ErrorNote, Field, Input, Modal, Segmented, Select } from "@/components/ui";
import { date, flag, money } from "@/lib/format";
import { useToast } from "../context";
import { PriceSelect } from "../pickers";
import { useCountries } from "../useMeta";
import { Icon } from "../icons";
import { QrPanel } from "./Qr";
import { checkoutUrl, parseCount } from "./links";

type Mode = "payment" | "subscription";
type Row = { key: number; priceId: string; quantity: string };

/**
 * Creates a hosted checkout session. The server prices the lines (tax, coupon, totals); this dialog
 * only collects the inputs and then shows the hosted URL.
 */
export function CheckoutCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const countries = useCountries().filter((c) => c.checkout_enabled);
  const [mode, setMode] = useState<Mode>("payment");
  const [rows, setRows] = useState<Row[]>([{ key: 1, priceId: "", quantity: "1" }]);
  const [nextKey, setNextKey] = useState(2);
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("");
  const [coupon, setCoupon] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<CheckoutSession | null>(null);

  // Payment mode can't include recurring prices; subscription mode may add one-time setup fees.
  const filter = (p: Price) => mode === "subscription" || p.type === "one_time";
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const invalid = rows.some((r) => !r.priceId || parseCount(r.quantity) === null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api<CheckoutSession>("/v1/checkout/sessions", {
        body: {
          mode,
          line_items: rows.map((r) => ({ price_id: r.priceId, quantity: parseCount(r.quantity) })),
          customer_email: email.trim() || undefined,
          country: country || undefined,
          coupon: coupon.trim() || undefined,
        },
      });
      setCreated(s);
      onCreated();
      toast("Checkout session created");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (created)
    return (
      <Modal open onClose={onClose} title="Checkout session created" footer={<Button onClick={onClose}>Done</Button>}>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3 rounded-inner sage-gradient p-4">
          <div>
            <div className="text-[12.5px] text-text-2">Total the customer will see</div>
            <Amount minor={created.total} currency={created.currency} size="md" className="mt-1" />
          </div>
          <div className="text-right text-[12px] text-text-2">
            {created.tax_label || "Tax"}: {money(created.tax, created.currency)}
            {!created.country && <><br />Tax is finalised when the buyer picks a country</>}
            <br />Expires {date(created.expires_at, true)}
          </div>
        </div>
        <QrPanel url={checkoutUrl(created.id)} />
      </Modal>
    );

  return (
    <Modal open onClose={onClose} title="Create checkout session" wide>
      <form onSubmit={submit} className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented<Mode>
            value={mode}
            onChange={(m) => { setMode(m); setRows((rs) => rs.map((r) => ({ ...r, priceId: "" }))); }}
            options={[{ value: "payment", label: "One-time payment" }, { value: "subscription", label: "Subscription" }]}
          />
          <span className="text-[12.5px] text-muted">{mode === "payment" ? "Only one-time prices" : "Recurring prices must share one billing interval"}</span>
        </div>

        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={r.key} className="grid grid-cols-1 items-end gap-3 rounded-inner bg-surface-2 p-3 sm:grid-cols-[minmax(0,1fr)_110px_auto]">
              <Field label={`Line ${i + 1} price`}>
                <PriceSelect value={r.priceId} filter={filter} onChange={(id) => update(r.key, { priceId: id })} />
              </Field>
              <Field label="Quantity" error={r.quantity && parseCount(r.quantity) === null ? "Whole number, 1 or more" : null}>
                <Input inputMode="numeric" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} />
              </Field>
              <Button type="button" variant="ghost" size="sm" className="mb-1.5" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove line ${i + 1}`}>
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="soft"
            size="sm"
            icon={<Icon name="plus" size={14} />}
            disabled={rows.length >= 50}
            onClick={() => { setRows((rs) => [...rs, { key: nextKey, priceId: "", quantity: "1" }]); setNextKey((k) => k + 1); }}
          >
            Add line item
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Customer email (optional)">
            <Input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="buyer@example.com" />
          </Field>
          <Field label="Country (optional)" hint="Pre-fills tax; the buyer can change it.">
            <Select value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="">Buyer chooses</option>
              {countries.map((c) => <option key={c.country} value={c.country}>{flag(c.country)} {c.name}</option>)}
            </Select>
          </Field>
          <Field label="Coupon code (optional)">
            <Input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="LAUNCH20" />
          </Field>
        </div>

        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={invalid}>Create session</Button>
        </div>
      </form>
    </Modal>
  );
}
