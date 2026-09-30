"use client";

import Link from "next/link";
import { Amount, Chip, Table } from "@/components/ui";
import { money, titleCase } from "@/lib/format";
import type { LineItem } from "@/lib/merchant/types";

/** Line items exactly as the server priced them: amount, discount, tax, rate and tax type. */
export function LineItems({ items, currency }: { items: LineItem[]; currency: string }) {
  return (
    <Table
      rows={items.map((it, i) => ({ ...it, id: `${it.price_id}-${i}` }))}
      rowKey={(r) => r.id}
      empty={<p className="text-[13px] text-muted">No line items.</p>}
      columns={[
        {
          key: "d",
          header: "Item",
          render: (it) => (
            <div className="min-w-[160px]">
              <div className="text-text">
                {it.product_id ? <Link href={`/products/${it.product_id}`} className="underline-offset-4 hover:underline">{it.description ?? it.product_id}</Link> : it.description ?? "Item"}
              </div>
              <div className="font-mono text-[11.5px] text-muted">{it.price_id}</div>
            </div>
          ),
        },
        { key: "q", header: "Qty", align: "right", render: (it) => <span className="numeral">{it.quantity.toLocaleString()}</span> },
        { key: "u", header: "Unit", align: "right", render: (it) => <span className="whitespace-nowrap text-text-2">{money(it.unit_amount, currency)}</span> },
        { key: "a", header: "Amount", align: "right", render: (it) => <span className="whitespace-nowrap">{money(it.amount, currency)}</span> },
        { key: "disc", header: "Discount", align: "right", render: (it) => (it.discount ? <span className="whitespace-nowrap text-sage-700">−{money(it.discount, currency)}</span> : <span className="text-faint">—</span>) },
        {
          key: "t",
          header: "Tax",
          align: "right",
          render: (it) => (
            <div className="whitespace-nowrap">
              <div>{money(it.tax, currency)}</div>
              <div className="mt-0.5 flex justify-end gap-1">
                {it.tax_type && <Chip tone={it.tax_type === "reverse_charge" ? "sky" : "neutral"}>{it.tax_type === "NONE" ? "No tax" : titleCase(it.tax_type).replace(/\bVat\b/, "VAT").replace(/\bGst\b/, "GST")}</Chip>}
                <Chip tone="neutral">{(it.tax_rate_bps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%</Chip>
                {it.tax_inclusive && <Chip tone="lemon-soft">Incl.</Chip>}
              </div>
            </div>
          ),
        },
      ]}
    />
  );
}

/** Server totals (never recomputed here). */
export function Totals({ currency, subtotal, discount, tax, total, taxLabel, extra }: {
  currency: string; subtotal: number; discount: number; tax: number; total: number; taxLabel?: string | null; extra?: [string, number][];
}) {
  const rows: [string, number][] = [["Subtotal", subtotal], ["Discount", -discount], [taxLabel || "Tax", tax], ...(extra ?? [])];
  return (
    <dl className="ml-auto mt-4 w-full max-w-sm space-y-2 text-[13.5px]">
      {rows.map(([label, v]) => (
        <div key={label} className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">{label}</dt>
          <dd className="numeral text-text-2">{v < 0 ? `−${money(-v, currency)}` : money(v, currency)}</dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
        <dt className="text-text">Total</dt>
        <dd><Amount minor={total} currency={currency} size="md" /></dd>
      </div>
    </dl>
  );
}
