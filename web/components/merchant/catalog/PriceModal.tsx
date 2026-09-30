"use client";

import { useState } from "react";
import { api, type List } from "@/lib/api";
import { useApi } from "@/lib/merchant/hooks";
import type { Meter, Price, Product } from "@/lib/merchant/types";
import { Button, ErrorNote, Modal } from "@/components/ui";
import { useMerchant, useToast } from "../context";
import { priceLabel } from "../pickers";
import { Icon } from "../icons";
import { PriceForm } from "./PriceForm";
import { buildPriceBody, draftFrom, type PriceDraft } from "./priceDraft";

/**
 * Create a price for a product, or publish a new version of an existing price. Published prices are
 * immutable: a version supersedes the old one for new purchases while existing subscriptions keep
 * the version they bought.
 */
export function PriceModal({ product, from, defaultCurrency, onClose, onDone }: {
  product: Product;
  /** When set, this is a "new version" of that price. */
  from?: Price;
  defaultCurrency: string;
  onClose: () => void;
  onDone: (p: Price) => void;
}) {
  const { can } = useMerchant();
  const toast = useToast();
  const canReadMeters = can("usage.read");
  const meters = useApi<List<Meter>>(canReadMeters ? "/v1/meters?limit=100" : null);
  const [draft, setDraft] = useState<PriceDraft>(() => draftFrom(from, defaultCurrency));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const { body, errors } = buildPriceBody(draft, product.id);
  const set = (patch: Partial<PriceDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api<Price>(from ? `/v1/prices/${from.id}/versions` : "/v1/prices", { body });
      toast(from ? `Version ${p.version} published` : "Price created");
      onDone(p);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const errorCount = Object.keys(errors).length;

  return (
    <Modal open onClose={onClose} title={from ? `New version of ${from.nickname ?? "this price"}` : `Add a price to ${product.name}`} wide>
      <form onSubmit={submit} className="space-y-5" noValidate>
        {from && (
          <div className="flex gap-3 rounded-inner bg-lemon-soft px-4 py-3 text-[13px] text-lemon-ink">
            <Icon name="info" size={17} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Published prices are never edited in place.</div>
              <div className="opacity-85">
                This creates version {from.version + 1} and retires version {from.version} ({priceLabel(from)}) for new purchases. Existing subscriptions keep the version they bought until you migrate them.
              </div>
            </div>
          </div>
        )}
        <PriceForm d={draft} set={set} errors={submitted ? errors : {}} meters={meters.data?.data} canReadMeters={canReadMeters} />
        <div aria-live="assertive" className="space-y-2">
          {submitted && errorCount > 0 && <ErrorNote error={{ message: `Check ${errorCount === 1 ? "the highlighted field" : `the ${errorCount} highlighted fields`}.` }} />}
          {error ? <ErrorNote error={error} /> : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{from ? `Publish version ${from.version + 1}` : "Create price"}</Button>
        </div>
      </form>
    </Modal>
  );
}
