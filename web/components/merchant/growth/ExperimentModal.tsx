"use client";

import { useState } from "react";
import { api, type List } from "@/lib/api";
import { useApi } from "@/lib/merchant/hooks";
import type { Coupon, PaymentLink, Price, Product } from "@/lib/merchant/types";
import { Button, ErrorNote, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { useToast } from "../context";
import { Help } from "../common";
import { Icon } from "../icons";
import { priceLabel } from "../pickers";
import { useCatalogNames } from "../sales/lookups";
import { parseCount } from "../sales/links";
import type { Experiment } from "./types";

type Draft = { key: string; weight: string; price_id: string; coupon_code: string };

const KEY = /^[a-z0-9_-]{1,40}$/;

export function ExperimentModal({ initialLink, onClose, onCreated }: { initialLink?: string; onClose: () => void; onCreated: (e: Experiment) => void }) {
  const toast = useToast();
  const links = useApi<List<PaymentLink>>("/v1/payment_links?limit=100");
  const coupons = useApi<List<Coupon>>("/v1/coupons?limit=100");
  const active = (links.data?.data ?? []).filter((l) => l.status === "active");
  const names = useCatalogNames(active.map((l) => l.price_id));
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [linkId, setLinkId] = useState(initialLink ?? "");
  const [variants, setVariants] = useState<Draft[]>([
    { key: "control", weight: "50", price_id: "", coupon_code: "" },
    { key: "variant_b", weight: "50", price_id: "", coupon_code: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const link = active.find((l) => l.id === linkId);
  const basePrice = link ? names.price(link.price_id) : undefined;
  const activeCoupons = (coupons.data?.data ?? []).filter((c) => c.active);
  const weights = variants.map((v) => parseCount(v.weight));
  const totalWeight = weights.reduce<number>((a, w) => a + (w ?? 0), 0);
  const keys = variants.map((v) => v.key.trim());
  const dupKey = keys.find((k, i) => keys.indexOf(k) !== i);
  const invalid = !name.trim() || !link || variants.some((v, i) => !KEY.test(v.key.trim()) || weights[i] === null) || !!dupKey;

  const update = (i: number, patch: Partial<Draft>) => setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const x = await api<Experiment>("/v1/experiments", {
        body: {
          name: name.trim(),
          payment_link: linkId,
          hypothesis: hypothesis.trim() || undefined,
          variants: variants.map((v, i) => ({ key: v.key.trim(), weight: weights[i], price_id: v.price_id || undefined, coupon_code: v.coupon_code || undefined })),
        },
      });
      toast("Experiment created as a draft");
      onCreated(x);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="New checkout experiment" wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="Launch discount test" />
          </Field>
          <Field label="Payment link" hint="Visitors to this link are split between the variants.">
            <Select value={linkId} onChange={(e) => setLinkId(e.target.value)} required disabled={!links.data}>
              <option value="">{links.data ? (active.length ? "Choose a link" : "No active payment links") : "Loading links…"}</option>
              {active.map((l) => {
                const p = names.price(l.price_id);
                return (
                  <option key={l.id} value={l.id}>
                    {p ? `${names.productName(p.product_id) ?? p.product_id} · ${priceLabel(p)}` : l.id}
                  </option>
                );
              })}
            </Select>
          </Field>
        </div>
        <Field label="Hypothesis (optional)" hint="Write down what you expect before you start, so the result can't move the goalposts.">
          <Textarea value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} placeholder="A 20% launch discount raises conversion enough to earn more per visitor." className="min-h-20" />
        </Field>

        <fieldset className="space-y-2">
          <legend className="mb-1 flex w-full items-center justify-between text-[12.5px] font-medium text-text-2">
            <span>Variants <span className="font-normal text-muted">— the first is the control</span></span>
            <span className="font-normal text-muted">Traffic weights total {totalWeight}</span>
          </legend>
          {variants.map((v, i) => {
            const share = weights[i] && totalWeight ? Math.round(((weights[i] ?? 0) / totalWeight) * 100) : 0;
            return (
              <div key={i} className="grid grid-cols-1 gap-3 rounded-inner bg-surface-2 p-4 md:grid-cols-[minmax(0,1fr)_90px_minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-end">
                <Field label={i === 0 ? "Key (control)" : "Key"} error={v.key && !KEY.test(v.key.trim()) ? "a–z, 0–9, - or _" : dupKey && v.key.trim() === dupKey ? "Keys must be unique" : null}>
                  <Input value={v.key} onChange={(e) => update(i, { key: e.target.value.toLowerCase() })} className="font-mono" />
                </Field>
                <Field label={`Weight · ${share}%`} error={weights[i] === null ? "1 or more" : null}>
                  <Input inputMode="numeric" value={v.weight} onChange={(e) => update(i, { weight: e.target.value })} />
                </Field>
                <Field label="Price">
                  <VariantPriceSelect
                    value={v.price_id}
                    onChange={(id) => update(i, { price_id: id })}
                    filter={(p) => !basePrice || (p.type === basePrice.type && p.currency === basePrice.currency)}
                  />
                </Field>
                <Field label="Coupon">
                  <Select value={v.coupon_code} onChange={(e) => update(i, { coupon_code: e.target.value })}>
                    <option value="">No coupon</option>
                    {activeCoupons.map((c) => <option key={c.id} value={c.code}>{c.code}{c.name ? ` · ${c.name}` : ""}</option>)}
                  </Select>
                </Field>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove variant ${v.key || i + 1}`}
                  disabled={variants.length <= 2}
                  onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))}
                  className="md:mb-1.5"
                >
                  <Icon name="close" size={14} />
                </Button>
              </div>
            );
          })}
          {variants.length < 5 && (
            <Button
              type="button"
              size="sm"
              variant="soft"
              icon={<Icon name="plus" size={14} />}
              onClick={() => setVariants((vs) => [...vs, { key: `variant_${String.fromCharCode(97 + vs.length)}`, weight: "50", price_id: "", coupon_code: "" }])}
            >
              Add variant
            </Button>
          )}
        </fieldset>
        <Help>
          Leave price blank to use the link&apos;s own price{basePrice ? ` (${priceLabel(basePrice)})` : ""}. Variant prices must be the same kind (one-time or recurring)
          {basePrice ? ` and currency (${basePrice.currency})` : ""} as the link price. The experiment is created as a draft — start it when you&apos;re ready.
        </Help>

        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={invalid}>Create experiment</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Active prices grouped by product; blank means "use the link's own price". */
function VariantPriceSelect({ value, onChange, filter }: { value: string; onChange: (id: string) => void; filter: (p: Price) => boolean }) {
  const prices = useApi<List<Price>>("/v1/prices?active=true&limit=100");
  const products = useApi<List<Product>>("/v1/products?limit=100");
  const names = new Map((products.data?.data ?? []).map((p) => [p.id, p.name]));
  const groups = new Map<string, Price[]>();
  for (const p of (prices.data?.data ?? []).filter(filter)) groups.set(p.product_id, [...(groups.get(p.product_id) ?? []), p]);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={!prices.data}>
      <option value="">{prices.data ? "Link price" : "Loading prices…"}</option>
      {[...groups.entries()].map(([pid, list]) => (
        <optgroup key={pid} label={names.get(pid) ?? pid}>
          {list.map((p) => <option key={p.id} value={p.id}>{priceLabel(p)}</option>)}
        </optgroup>
      ))}
    </Select>
  );
}
