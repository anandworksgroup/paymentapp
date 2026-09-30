"use client";

import { Chip, type Tone } from "@/components/ui";

/** 1250 → "12.5%" (display only; basis points come from the API). */
export function bpsLabel(bps: number) {
  return `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/**
 * "12.5" / "12.5%" → 1250 basis points; null unless it's a percentage with ≤ 2 decimals within
 * [min, max] basis points. String-based so no floating-point rounding is involved.
 */
export function percentToBps(input: string, min = 0, max = 10_000): number | null {
  const v = input.trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(v)) return null;
  const [w, f = ""] = v.split(".");
  const bps = Number(w) * 100 + Number(f.padEnd(2, "0"));
  return bps >= min && bps <= max ? bps : null;
}

/** Saves text as a file in the browser (CSV templates, exports). */
export function downloadText(filename: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Status chip with explicit tones for states the shared StatusChip map doesn't know. */
export function StateChip({ status, tones, className }: { status: string; tones?: Record<string, Tone>; className?: string }) {
  const key = status.toLowerCase();
  const tone = tones?.[key] ?? DEFAULT_TONES[key] ?? "neutral";
  return <Chip tone={tone} className={className}>{key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</Chip>;
}

const DEFAULT_TONES: Record<string, Tone> = {
  active: "sage", running: "sage", approved: "sage", paid: "sage", valid: "sage", imported: "sage", completed: "sage", clear: "sage",
  pending: "lemon-soft", pending_verification: "lemon-soft", processing: "lemon-soft", previewed: "lemon-soft", draft: "neutral", duplicate: "lemon",
  skipped: "neutral", stopped: "neutral", inactive: "neutral", restricted: "peach", potential_match: "peach",
  invalid: "rose", failed: "rose", rejected: "rose", reversed: "rose",
};

/** Inline sage/peach progress bar used for budgets and traffic splits. */
export function Meter({ value, max, tone, label }: { value: number; max: number; tone?: "sage" | "lemon" | "peach" | "rose"; label: string }) {
  const pct = max <= 0 ? 0 : Math.min(100, (value / max) * 100);
  const color = tone === "peach" ? "var(--peach)" : tone === "lemon" ? "var(--lemon)" : tone === "rose" ? "var(--rose)" : "var(--sage-300)";
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)} className="h-2.5 w-full rounded-full bg-surface-3">
      <div className="h-2.5 rounded-full transition-[width]" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
