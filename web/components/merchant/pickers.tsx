"use client";

import { useEffect, useId, useState } from "react";
import { api, type List } from "@/lib/api";
import { money, titleCase } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/merchant/hooks";
import type { Customer, Price, Product } from "@/lib/merchant/types";
import { Select, Spinner, cx, inputClass } from "@/components/ui";

/** Human summary of a price: "$29.00 / month", "Tiered (graduated) / month", "$5.00 per 100 units". */
export function priceLabel(p: Price) {
  const base =
    p.scheme === "tiered" ? `Tiered (${p.tiers_mode ?? "graduated"})`
    : p.scheme === "package" ? `${money(p.unit_amount, p.currency)} per ${p.package_size} units`
    : money(p.unit_amount, p.currency, { code: true });
  const every = p.type === "recurring" ? ` / ${p.interval_count > 1 ? `${p.interval_count} ${p.interval}s` : p.interval}` : " one-time";
  return `${p.nickname ? `${p.nickname} · ` : ""}${base}${every}${p.usage_type === "metered" ? " · metered" : ""}`;
}

/** Searchable customer picker backed by `/v1/customers?search=`. */
export function CustomerPicker({ value, onChange, id, required }: { value: Customer | null; onChange: (c: Customer | null) => void; id?: string; required?: boolean }) {
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim(), 250);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ term: string; rows: Customer[] }>({ term: "", rows: [] });
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const path = term.length > 1 ? `/v1/customers?search=${encodeURIComponent(term)}&limit=8` : "/v1/customers?limit=8";
    api<List<Customer>>(path).then((r) => alive && setState({ term, rows: r.data }), () => alive && setState({ term, rows: [] }));
    return () => {
      alive = false;
    };
  }, [term, open]);
  const loading = open && state.term !== term;
  const listId = useId();

  if (value)
    return (
      <div className="flex h-11 items-center justify-between gap-2 rounded-field border border-line bg-surface-2 px-3.5 text-[14px]">
        <span className="min-w-0 truncate">{value.name ?? value.email ?? value.id} <span className="text-muted">{value.email && value.name ? `· ${value.email}` : ""}</span></span>
        <button type="button" onClick={() => onChange(null)} className="text-[12.5px] text-muted hover:text-text">Change</button>
      </div>
    );
  return (
    <div className="relative">
      <input
        id={id}
        required={required}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search by name, email or id"
        className={inputClass}
        role="combobox"
        aria-controls={listId}
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-auto rounded-inner bg-surface p-1.5 shadow-float">
          {loading && <li className="flex items-center gap-2 px-3 py-2 text-[13px] text-muted"><Spinner /> Searching…</li>}
          {!loading && state.rows.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">No customers found.</li>}
          {state.rows.map((c) => (
            <li key={c.id} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(c); setQ(""); setOpen(false); }} className="w-full rounded-[12px] px-3 py-2 text-left text-[13px] hover:bg-surface-2">
                <span className="block truncate text-text">{c.name ?? c.email ?? c.id}</span>
                <span className="block truncate text-[12px] text-muted">{c.email ?? ""} · {c.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Select of active prices, grouped by product. `filter` narrows it (e.g. recurring prices in the
 * subscription's currency and interval for a plan change).
 */
export function PriceSelect({ value, onChange, filter, id, className }: { value: string; onChange: (id: string, price?: Price) => void; filter?: (p: Price) => boolean; id?: string; className?: string }) {
  const prices = useApi<List<Price>>("/v1/prices?active=true&limit=100");
  const products = useApi<List<Product>>("/v1/products?limit=100");
  const names = new Map((products.data?.data ?? []).map((p) => [p.id, p.name]));
  const rows = (prices.data?.data ?? []).filter((p) => !filter || filter(p));
  const groups = new Map<string, Price[]>();
  for (const p of rows) groups.set(p.product_id, [...(groups.get(p.product_id) ?? []), p]);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value, rows.find((p) => p.id === e.target.value))} className={cx(className)} disabled={!prices.data}>
      <option value="">{prices.data ? (rows.length ? "Choose a price" : "No matching active prices") : "Loading prices…"}</option>
      {[...groups.entries()].map(([pid, list]) => (
        <optgroup key={pid} label={names.get(pid) ?? pid}>
          {list.map((p) => <option key={p.id} value={p.id}>{priceLabel(p)}</option>)}
        </optgroup>
      ))}
    </Select>
  );
}

export function intervalLabel(p: Pick<Price, "type" | "interval" | "interval_count">) {
  if (p.type !== "recurring") return "One-time";
  return p.interval_count > 1 ? `Every ${p.interval_count} ${p.interval}s` : titleCase(`${p.interval}ly`).replace("Dayly", "Daily");
}
