"use client";

import { useId } from "react";
import { toMinor } from "@/lib/merchant/money";
import { Button, Input, Segmented, cx } from "@/components/ui";
import { MoneyInput } from "../common";
import { PriceSelect } from "../pickers";
import { Icon } from "../icons";

export type DraftLine = { key: string; mode: "price" | "custom"; price_id: string; description: string; quantity: string; unit: string };

export function newLine(): DraftLine {
  return { key: crypto.randomUUID(), mode: "custom", price_id: "", description: "", quantity: "1", unit: "" };
}

/** Validation message for a line, or null when it can be sent. */
export function lineError(l: DraftLine, currency: string): string | null {
  const q = Number(l.quantity);
  if (!Number.isInteger(q) || q < 1) return "Quantity must be a whole number, 1 or more.";
  if (l.mode === "price") return l.price_id ? null : "Choose a price.";
  if (!l.description.trim()) return "Add a description.";
  const unit = toMinor(l.unit, currency);
  if (unit === null || unit <= 0) return "Enter a unit amount greater than zero, with at most the currency's decimals.";
  return null;
}

/** Converts a valid draft line to the API's InvoiceLineRequest {price_id?, description?, quantity, unit_amount?}. */
export function toRequestLine(l: DraftLine, currency: string) {
  return l.mode === "price"
    ? { price_id: l.price_id, description: l.description.trim() || undefined, quantity: Number(l.quantity) }
    : { description: l.description.trim(), quantity: Number(l.quantity), unit_amount: toMinor(l.unit, currency) ?? undefined };
}

export function InvoiceLineEditor({ lines, onChange, currency, showErrors }: { lines: DraftLine[]; onChange: (lines: DraftLine[]) => void; currency: string; showErrors: boolean }) {
  const update = (key: string, patch: Partial<DraftLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-3">
      {lines.map((l, i) => (
        <LineRow
          key={l.key}
          index={i}
          line={l}
          currency={currency}
          error={showErrors ? lineError(l, currency) : null}
          onChange={(patch) => update(l.key, patch)}
          onRemove={lines.length > 1 ? () => onChange(lines.filter((x) => x.key !== l.key)) : undefined}
        />
      ))}
      <Button type="button" variant="soft" size="sm" icon={<Icon name="plus" size={14} />} onClick={() => onChange([...lines, newLine()])}>Add line</Button>
    </div>
  );
}

function LineRow({ index, line, currency, error, onChange, onRemove }: {
  index: number; line: DraftLine; currency: string; error: string | null; onChange: (p: Partial<DraftLine>) => void; onRemove?: () => void;
}) {
  const id = useId();
  const label = "mb-1.5 block text-[12.5px] font-medium text-text-2";
  return (
    <fieldset className={cx("rounded-inner bg-surface-2 p-4", error && "ring-2 ring-rose-soft")}>
      <legend className="sr-only">Line {index + 1}</legend>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] text-muted">Line {index + 1}</span>
        <div className="flex items-center gap-2">
          <Segmented<"custom" | "price">
            value={line.mode}
            onChange={(mode) => onChange({ mode })}
            options={[{ value: "custom", label: "Custom item" }, { value: "price", label: "From catalog" }]}
          />
          {onRemove && (
            <button type="button" onClick={onRemove} aria-label={`Remove line ${index + 1}`} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-text">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_100px]">
        {line.mode === "price" ? (
          <div className="min-w-0">
            <label htmlFor={`${id}-price`} className={label}>Price</label>
            <PriceSelect id={`${id}-price`} value={line.price_id} onChange={(price_id) => onChange({ price_id })} filter={(p) => p.currency === currency} />
          </div>
        ) : (
          <div className="min-w-0">
            <label htmlFor={`${id}-desc`} className={label}>Description</label>
            <Input id={`${id}-desc`} value={line.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="e.g. Implementation services, March" />
          </div>
        )}
        {line.mode === "price" ? (
          <div className="min-w-0">
            <label htmlFor={`${id}-desc2`} className={label}>Description (optional)</label>
            <Input id={`${id}-desc2`} value={line.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="Product name" />
          </div>
        ) : (
          <div className="min-w-0">
            <label htmlFor={`${id}-unit`} className={label}>Unit amount</label>
            <MoneyInput id={`${id}-unit`} currency={currency} value={line.unit} onChange={(unit) => onChange({ unit })} placeholder="0.00" />
          </div>
        )}
        <div className="min-w-0">
          <label htmlFor={`${id}-qty`} className={label}>Quantity</label>
          <Input id={`${id}-qty`} type="number" min={1} step={1} value={line.quantity} onChange={(e) => onChange({ quantity: e.target.value })} />
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-[12px] text-rose-ink">{error}</p>}
    </fieldset>
  );
}
