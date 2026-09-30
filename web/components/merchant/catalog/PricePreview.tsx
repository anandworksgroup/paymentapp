"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { qs, useDebounced } from "@/lib/merchant/hooks";
import type { Price } from "@/lib/merchant/types";
import { Amount, ErrorNote, Field, Input, Select, Skeleton } from "@/components/ui";
import { flag } from "@/lib/format";
import { priceLabel } from "../pickers";
import { useCountries } from "../useMeta";

type Preview = { price: string; currency: string; amounts: { quantity: number; amount: number }[] };

/** Parses "1, 10, 100" into whole numbers; null when any entry isn't one. */
function parseQuantities(s: string): number[] | null {
  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  if (!parts.length || parts.length > 20 || parts.some((p) => !/^\d{1,9}$/.test(p))) return null;
  return parts.map(Number);
}

/**
 * What a price charges at several quantities, computed by the server's pricing engine (tiers,
 * packages, minimum/maximum and country overrides), before tax and discounts.
 */
export function PricePreview({ prices, selected, onSelect }: { prices: Price[]; selected: string; onSelect: (id: string) => void }) {
  const countries = useCountries();
  const [quantities, setQuantities] = useState("1,10,100,1000");
  const [country, setCountry] = useState("");
  const q = useDebounced(quantities, 400);
  const parsed = parseQuantities(q);
  const key = selected && parsed ? `/v1/prices/${selected}/preview${qs({ quantities: parsed.join(","), country })}` : null;
  const [state, setState] = useState<{ key: string | null; data?: Preview; error?: unknown }>({ key: null });

  useEffect(() => {
    if (!key) return;
    let alive = true;
    api<Preview>(key, { method: "POST" }).then(
      (data) => alive && setState({ key, data }),
      (error) => alive && setState({ key, error }),
    );
    return () => {
      alive = false;
    };
  }, [key]);

  const current = state.key === key ? state : null;
  const data = current?.data;
  const price = prices.find((p) => p.id === selected);
  const typedInvalid = quantities.trim() !== "" && parseQuantities(quantities) === null;

  if (!prices.length) return <p className="text-[13px] text-muted">Add a price to preview what it charges.</p>;

  return (
    <div className="space-y-4">
      <Field label="Price">
        <Select value={selected} onChange={(e) => onSelect(e.target.value)}>
          {prices.map((p) => <option key={p.id} value={p.id}>v{p.version} · {priceLabel(p)}{p.active ? "" : " (inactive)"}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Field label="Quantities" error={typedInvalid ? "Comma-separated whole numbers, up to 20." : null}>
          <Input value={quantities} onChange={(e) => setQuantities(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Country">
          <Select value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">Base price</option>
            {countries.map((c) => <option key={c.country} value={c.country}>{flag(c.country)} {c.name}{price?.country_amounts?.[c.country] !== undefined ? " · override" : ""}</option>)}
          </Select>
        </Field>
      </div>
      <div aria-live="polite">
        {current?.error ? (
          <ErrorNote error={current.error} />
        ) : data ? (
          <table className="w-full text-[13.5px]">
            <caption className="sr-only">Amount charged per quantity</caption>
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th className="pb-2 font-normal">Quantity</th>
                <th className="pb-2 text-right font-normal">Amount (before tax)</th>
              </tr>
            </thead>
            <tbody>
              {data.amounts.map((r) => (
                <tr key={r.quantity} className="border-t border-line">
                  <td className="py-2.5 numeral text-text-2">{r.quantity.toLocaleString()}</td>
                  <td className="py-2.5 text-right"><Amount minor={r.amount} currency={data.currency} size="sm" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : key ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading preview">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : null}
      </div>
    </div>
  );
}
