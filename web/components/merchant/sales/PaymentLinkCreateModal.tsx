"use client";

import { useState } from "react";
import { api, type List } from "@/lib/api";
import { useApi } from "@/lib/merchant/hooks";
import type { Coupon, PaymentLink, Price } from "@/lib/merchant/types";
import { Button, ErrorNote, Field, Input, Modal, Select } from "@/components/ui";
import { money } from "@/lib/format";
import { useMerchant, useToast } from "../context";
import { PriceSelect, priceLabel } from "../pickers";
import { CheckField } from "../catalog/fields";
import { QrPanel } from "./Qr";
import { localToIso, parseCount, payUrl } from "./links";

/**
 * Create a shareable payment link for one price. After creating, the URL and QR code are shown right
 * away so the merchant can copy or download them without leaving the dialog.
 */
export function PaymentLinkCreateModal({ onClose, onCreated, initialPrice = "" }: { onClose: () => void; onCreated: (l: PaymentLink) => void; initialPrice?: string }) {
  const { can } = useMerchant();
  const toast = useToast();
  const coupons = useApi<List<Coupon>>(can("products.read") ? "/v1/coupons?limit=100" : null);
  const [priceId, setPriceId] = useState(initialPrice);
  const [price, setPrice] = useState<Price | undefined>();
  const [quantity, setQuantity] = useState("1");
  const [allowCoupons, setAllowCoupons] = useState(true);
  const [coupon, setCoupon] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<PaymentLink | null>(null);

  const qty = parseCount(quantity);
  const activeCoupons = (coupons.data?.data ?? []).filter((c) => c.active);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!priceId || qty === null) return;
    setBusy(true);
    setError(null);
    try {
      const l = await api<PaymentLink>("/v1/payment_links", {
        body: { price_id: priceId, quantity: qty, allow_coupons: allowCoupons, coupon: coupon || undefined, expires_at: localToIso(expires) },
      });
      setCreated(l);
      onCreated(l);
      toast("Payment link created");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (created)
    return (
      <Modal open onClose={onClose} title="Your payment link is ready" footer={<Button onClick={onClose}>Done</Button>}>
        <p className="mb-4 text-[13.5px] text-muted">
          Share the link or let customers scan the code. {price ? <>It sells <span className="text-text">{priceLabel(price)}</span>{created.quantity > 1 ? ` × ${created.quantity}` : ""}.</> : null}
        </p>
        <QrPanel url={payUrl(created.id)} />
      </Modal>
    );

  return (
    <Modal open onClose={onClose} title="Create payment link">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Price" hint="Only active prices can be sold through a link.">
          <PriceSelect value={priceId} onChange={(id, p) => { setPriceId(id); setPrice(p); }} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Quantity" error={quantity && qty === null ? "Enter a whole number of 1 or more." : null}>
            <Input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </Field>
          <Field label="Expires (optional)" hint="Leave blank to keep the link open.">
            <Input type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </Field>
        </div>
        <Field label="Apply a coupon automatically (optional)">
          <Select value={coupon} onChange={(e) => setCoupon(e.target.value)} disabled={coupons.loading && !coupons.data}>
            <option value="">No coupon</option>
            {activeCoupons.map((c) => (
              <option key={c.id} value={c.code}>
                {c.code} · {c.percent_off_bps ? `${c.percent_off_bps / 100}% off` : c.amount_off && c.currency ? `${money(c.amount_off, c.currency)} off` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <CheckField label="Let customers enter a promotion code" hint="Shows a coupon field on the checkout page." checked={allowCoupons} onChange={setAllowCoupons} />
        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!priceId || qty === null}>Create link</Button>
        </div>
      </form>
    </Modal>
  );
}
