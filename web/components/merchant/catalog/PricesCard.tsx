"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction } from "@/lib/merchant/hooks";
import type { Price } from "@/lib/merchant/types";
import { Button, Card, CardHeader, Chip, Empty } from "@/components/ui";
import { money, titleCase } from "@/lib/format";
import { useToast } from "../context";
import { ConfirmModal, Mono } from "../common";
import { intervalLabel, priceLabel } from "../pickers";
import { Icon } from "../icons";

function tierLines(p: Price) {
  let from = 1;
  return (p.tiers ?? []).map((t) => {
    const range = t.up_to === null ? `${from.toLocaleString()}+` : `${from.toLocaleString()}–${t.up_to.toLocaleString()}`;
    if (t.up_to !== null) from = t.up_to + 1;
    return `${range}: ${money(t.unit_amount, p.currency)}/unit${t.flat_amount ? ` + ${money(t.flat_amount, p.currency)} flat` : ""}`;
  });
}

/** Every price of a product — active and retired versions — with version, scheme and actions. */
export function PricesCard({ prices, canWrite, canLink, onAdd, onVersion, onPreview, onChanged }: {
  prices: Price[];
  canWrite: boolean;
  canLink: boolean;
  onAdd: () => void;
  onVersion: (p: Price) => void;
  onPreview: (p: Price) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const act = useAction();
  const [deactivating, setDeactivating] = useState<Price | null>(null);
  const sorted = [...prices].sort((a, b) => Number(b.active) - Number(a.active));

  return (
    <Card>
      <CardHeader
        title="Prices"
        subtitle="Published prices are immutable — change one by publishing a new version."
        action={canWrite && <Button size="sm" icon={<Icon name="plus" size={14} />} onClick={onAdd}>Add price</Button>}
      />
      {sorted.length === 0 ? (
        <Empty title="No prices yet" icon={<Icon name="tag" />} action={canWrite && <Button onClick={onAdd}>Add a price</Button>}>
          A product needs at least one active price before it can be sold.
        </Empty>
      ) : (
        <ul className="space-y-2">
          {sorted.map((p) => (
            <li key={p.id} className="rounded-inner bg-surface-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] text-text">{priceLabel(p)}</span>
                    <Chip tone={p.active ? "sage" : "neutral"}>{p.active ? "Active" : "Inactive"}</Chip>
                    <Chip tone="lemon-soft">v{p.version}</Chip>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
                    <span>{intervalLabel(p)}</span>
                    <span>{titleCase(p.scheme)}{p.scheme === "tiered" ? ` · ${p.tiers_mode ?? "graduated"}` : ""}</span>
                    <span>Tax {p.tax_behavior}</span>
                    {p.trial_days > 0 && <span>{p.trial_days}-day trial</span>}
                    {p.usage_type === "metered" && p.meter_id && <span>Meter <span className="font-mono">{p.meter_id}</span></span>}
                    {p.credits_granted > 0 && <span>{p.credits_granted.toLocaleString()} credits</span>}
                    {typeof p.minimum_amount === "number" && <span>Min {money(p.minimum_amount, p.currency)}</span>}
                    {typeof p.maximum_amount === "number" && <span>Max {money(p.maximum_amount, p.currency)}</span>}
                    {p.country_amounts && Object.keys(p.country_amounts).length > 0 && (
                      <span>{Object.entries(p.country_amounts).map(([c, a]) => `${c} ${money(a, p.currency)}`).join(" · ")}</span>
                    )}
                  </div>
                  {p.scheme === "tiered" && (
                    <ul className="mt-2 space-y-0.5 text-[12px] text-text-2">
                      {tierLines(p).map((l) => <li key={l} className="numeral">{l}</li>)}
                    </ul>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                    <Mono>{p.id}</Mono>
                    {p.superseded_by_id && <span>Superseded by <span className="font-mono text-text-2">{p.superseded_by_id}</span></span>}
                    {p.previous_version_id && <span>Replaces <span className="font-mono text-text-2">{p.previous_version_id}</span></span>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => onPreview(p)}>Preview</Button>
                  {canLink && p.active && (
                    <Link href={`/payment-links?new=1&price=${p.id}`} className="inline-flex h-8 items-center rounded-full px-3.5 text-[12.5px] font-medium text-text-2 transition hover:bg-surface-3">
                      Payment link
                    </Link>
                  )}
                  {canWrite && !p.superseded_by_id && <Button size="sm" variant="soft" className="bg-surface" onClick={() => onVersion(p)}>New version</Button>}
                  {canWrite && p.active && <Button size="sm" variant="ghost" onClick={() => { act.setError(null); setDeactivating(p); }}>Deactivate</Button>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmModal
        open={!!deactivating}
        onClose={() => setDeactivating(null)}
        title="Deactivate this price?"
        confirmLabel="Deactivate"
        danger
        busy={act.busy}
        error={act.error}
        onConfirm={async () => {
          if (!deactivating) return;
          const r = await act.run(() => api(`/v1/prices/${deactivating.id}/deactivate`, { method: "POST" }));
          if (r) {
            toast("Price deactivated");
            setDeactivating(null);
            onChanged();
          }
        }}
      >
        <p>{deactivating ? priceLabel(deactivating) : ""} will no longer be offered in new checkouts or payment links.</p>
        <p>Subscriptions already on this price are not changed.</p>
      </ConfirmModal>
    </Card>
  );
}
