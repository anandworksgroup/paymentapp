"use client";

/**
 * Page-local helpers for the configuration screens: unit conversions (bps ↔ %, major ↔ minor),
 * a switch control, and the shared "audited and versioned" copy used by every change dialog.
 */
import { ReactNode } from "react";
import { Chip, cx } from "@/components/ui";
import { exponent, money } from "@/lib/format";

export function pctFromBps(bps: number | null | undefined) {
  if (bps === null || bps === undefined) return "—";
  return `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/** "3.5" → 350 bps. Up to two decimals of a percent (1 bp precision). Null when invalid. */
export function bpsFromPct(input: string): number | null {
  const t = input.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  const bps = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}

export function pctInput(bps: number | null | undefined) {
  if (bps === null || bps === undefined) return "";
  return String(bps / 100);
}

/** "0.30" USD → 30. Respects the currency exponent (JPY 0, BHD 3). Null when invalid. */
export function minorFromMajor(input: string, currency: string): number | null {
  const t = input.trim().replace(/,/g, "");
  const exp = exponent(currency);
  const re = exp === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${exp}})?$`);
  if (!re.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 10 ** exp + (exp ? Number(frac.padEnd(exp, "0")) : 0);
}

export function majorInput(minor: number | null | undefined, currency: string) {
  if (minor === null || minor === undefined) return "";
  const exp = exponent(currency);
  return (minor / 10 ** exp).toFixed(exp);
}

/** Explains a stored parameter value in human units (USD cents, bps, time windows). */
export function paramHint(name: string, value: number | null): string | null {
  if (value === null || Number.isNaN(value)) return null;
  if (name.includes("usd")) return `${money(value, "USD")} (USD cents)`;
  if (name.endsWith("_bps")) return `${pctFromBps(value)} (basis points)`;
  if (name.includes("minutes")) return `${value} minute${value === 1 ? "" : "s"}`;
  if (name.includes("hours")) return `${value} hour${value === 1 ? "" : "s"}`;
  if (name.includes("days")) return `${value} day${value === 1 ? "" : "s"}`;
  return null;
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-sage-500" : "bg-surface-3 ring-1 ring-inset ring-line-strong",
      )}
    >
      <span className={cx("inline-block h-5 w-5 rounded-full bg-surface shadow-card transition", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
    </button>
  );
}

export function ToggleRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[14px] bg-surface-2 px-4 py-3">
      <div>
        <div className="text-[13.5px] text-text">{label}</div>
        {hint && <div className="text-[12px] text-muted">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </div>
  );
}

/** The standing promise of every configuration change. */
/**
 * "versioned": the change creates a new record and the old one is kept untouched (fees, tax rules, list entries).
 * "history": the record is updated in place and its previous values live in the audit log's before/after (rules, countries).
 */
export function AuditedNote({ children, mode = "versioned" }: { children?: ReactNode; mode?: "versioned" | "history" }) {
  return (
    <div className="rounded-[14px] bg-sky-soft px-4 py-3 text-[12.5px] leading-relaxed text-sky-ink">
      {children}
      {children ? " " : ""}
      The change is recorded in the audit log with your name, the time and the before/after values.{" "}
      {mode === "versioned" ? "Earlier versions are kept as they were, never edited." : "The previous settings stay on record in that audit entry."}
    </div>
  );
}

/** A before → after line for review steps. */
export function ChangeLine({ label, before, after }: { label: ReactNode; before: ReactNode; after: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] bg-surface-2 px-4 py-2.5 text-[13px]">
      <span className="text-text-2">{label}</span>
      <span className="inline-flex items-center gap-2">
        <span className="text-muted line-through decoration-faint">{before}</span>
        <span className="text-muted">→</span>
        <span className="font-medium text-text">{after}</span>
      </span>
    </li>
  );
}

export function VersionChip({ version }: { version: number | string }) {
  return <Chip tone="neutral">v{version}</Chip>;
}

export function onOff(v: boolean) {
  return v ? "On" : "Off";
}
