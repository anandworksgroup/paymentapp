"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { date, titleCase } from "@/lib/format";
import type { Price } from "@/lib/merchant/types";
import { Amount, Button, ErrorNote, Field, Input, Modal } from "@/components/ui";
import { PriceSelect, priceLabel } from "../pickers";
import { KV } from "../common";
import { useStepUp, useToast } from "../context";
import type { ProrationPreview, SubscriptionFull } from "./types";

const BEHAVIOR: Record<string, string> = {
  charged_now_plus_tax: "The difference is invoiced now (plus tax) and charged to the saved payment method.",
  credited_to_next_invoice: "The difference is added to the customer's account credit and used on the next invoice.",
  no_charge: "Nothing is charged or credited now.",
};

/**
 * Plan change with a mandatory server-side proration preview (§183). Confirm only becomes available
 * once the preview for exactly the chosen price and quantity has been fetched.
 */
export function ChangePlanModal({ sub, current, currentQty, onClose, onDone }: {
  sub: SubscriptionFull; current: Price; currentQty: number; onClose: () => void; onDone: () => void;
}) {
  const [priceId, setPriceId] = useState("");
  const [qty, setQty] = useState(String(currentQty));
  const [preview, setPreview] = useState<{ key: string; data: ProrationPreview } | null>(null);
  const [busy, setBusy] = useState<"preview" | "confirm" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const withStepUp = useStepUp();
  const toast = useToast();

  const quantity = Number(qty);
  const qtyInvalid = !Number.isInteger(quantity) || quantity < 1;
  const key = `${priceId}:${quantity}`;
  const fresh = preview?.key === key ? preview.data : null;
  const sameAsNow = priceId === current.id && quantity === currentQty;

  const call = (previewOnly: boolean) =>
    api<ProrationPreview>(`/v1/subscriptions/${sub.id}/change`, { body: { price: priceId, quantity, preview: previewOnly } });

  const runPreview = async () => {
    setBusy("preview");
    setError(null);
    try {
      const data = await call(true);
      setPreview({ key, data });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const confirm = async () => {
    setBusy("confirm");
    setError(null);
    try {
      await withStepUp(() => call(false));
      toast("Plan changed");
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open onClose={onClose} title="Change plan" wide>
      <div className="space-y-4">
        <p className="text-[13.5px] text-muted">
          Currently on <span className="text-text">{priceLabel(current)}</span> × {currentQty}. You can switch to another recurring price in {sub.currency} billed on the same interval.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
          <Field label="New price">
            <PriceSelect
              value={priceId}
              onChange={(id) => setPriceId(id)}
              filter={(p) => p.type === "recurring" && p.currency === current.currency && p.interval === current.interval && p.interval_count === current.interval_count}
            />
          </Field>
          <Field label="Quantity" error={qty && qtyInvalid ? "Whole number, 1 or more." : null}>
            <Input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="soft" onClick={runPreview} loading={busy === "preview"} disabled={!priceId || qtyInvalid || sameAsNow || busy !== null}>
            {fresh ? "Preview again" : "Preview proration"}
          </Button>
          {sameAsNow && <span className="text-[12.5px] text-muted">That is the current plan and quantity.</span>}
          {preview && !fresh && <span className="text-[12.5px] text-muted">The selection changed. Preview again before confirming.</span>}
        </div>

        {fresh && (
          <section aria-label="Proration preview" className="rounded-inner bg-surface-2 p-5">
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Figure label="Credit for unused time" minor={fresh.credit_for_unused_time} currency={fresh.currency} />
              <Figure label="Charge for remaining time" minor={fresh.charge_for_remaining_time} currency={fresh.currency} />
              <Figure label="Net amount" minor={fresh.net_amount} currency={fresh.currency} strong />
            </div>
            <KV rows={[
              ["What happens", <span key="b"><span className="text-text">{titleCase(fresh.behavior)}</span><span className="block text-[12.5px] text-muted">{BEHAVIOR[fresh.behavior] ?? ""}</span></span>],
              ["Next invoice before tax", <Amount key="n" minor={fresh.next_invoice_amount_before_tax} currency={fresh.currency} size="sm" />],
              ["Period ends", date(fresh.period_end, true)],
              ["Remaining fraction", <span key="r">{fresh.remaining_fraction} <span className="text-muted">({(fresh.remaining_fraction * 100).toFixed(2)}% of the period left)</span></span>],
            ]} />
            <p className="mt-3 text-[12px] text-muted">Figures calculated by the server. Tax, if any, is added on the invoice.</p>
          </section>
        )}

        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm} loading={busy === "confirm"} disabled={!fresh || busy !== null}>Confirm change</Button>
        </div>
      </div>
    </Modal>
  );
}

function Figure({ label, minor, currency, strong }: { label: string; minor: number; currency: string; strong?: boolean }) {
  return (
    <div className={strong ? "rounded-inner lemon-gradient p-4" : "rounded-inner bg-surface p-4"}>
      <div className="text-[12.5px] text-text-2">{label}</div>
      <Amount minor={minor} currency={currency} size="md" className="mt-1.5" />
    </div>
  );
}
