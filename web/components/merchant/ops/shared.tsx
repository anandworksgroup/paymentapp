"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/merchant/hooks";
import type { Balance } from "@/lib/merchant/types";
import { Chip, cx, type Tone } from "@/components/ui";
import { useMerchant } from "../context";

// ───────── Months ─────────

export const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/** "2026-09" → "September 2026" (or "Sep 26" when short). */
export function monthLabel(key: string, short = false) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return short
    ? d.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" })
    : d.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Month keys, newest first, starting `offset` months before the current UTC month. */
export function recentMonths(count: number, offset = 0, now = new Date()) {
  return Array.from({ length: count }, (_, i) => monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset - i, 1))));
}

/** First instant of the month and of the next month, as ISO dates (the API reads them as UTC). */
export function monthRange(key: string) {
  const [y, m] = key.split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 1));
  return { from: `${key}-01`, to: next.toISOString().slice(0, 10) };
}

// ───────── Currencies ─────────

/** Currencies the org actually holds (default first), for report currency pickers. */
export function useOrgCurrencies() {
  const { can, org } = useMerchant();
  const bal = useApi<Balance>(can("balance.read") ? "/v1/balance" : null);
  return Array.from(new Set([org.default_currency, ...(bal.data?.balances.map((b) => b.currency) ?? [])]));
}

// ───────── Several GETs at once ─────────

type ManyState<T> = { key: string | null; base: string | null; data?: T[]; error?: unknown };

/** Like useApi, for a list of paths loaded in parallel (e.g. one report per month). */
export function useApiMany<T>(paths: string[] | null) {
  const base = paths ? paths.join("|") : null;
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<ManyState<T>>({ key: null, base: null });
  const key = base ? `${base}#${nonce}` : null;
  useEffect(() => {
    if (!key || !base) return;
    let cancelled = false;
    Promise.all(base.split("|").map((p) => api<T>(p))).then(
      (data) => !cancelled && setState({ key, base, data }),
      (error) => !cancelled && setState((s) => ({ key, base, error, data: s.base === base ? s.data : undefined })),
    );
    return () => {
      cancelled = true;
    };
  }, [key, base]);
  const same = state.base === base;
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return {
    data: same ? state.data : undefined,
    error: same && state.key === key ? state.error : undefined,
    loading: key !== null && state.key !== key,
    reload,
  };
}

// ───────── Small visual pieces ─────────

/** Checklist tick / cross / warning dot used by the close checklist. */
export function CheckDot({ state }: { state: "pass" | "block" | "warn" }) {
  const styles = { pass: "bg-sage-100 text-sage-700", block: "bg-rose-soft text-rose-ink", warn: "bg-peach-soft text-peach-ink" } as const;
  const glyph = { pass: "✓", block: "✕", warn: "!" } as const;
  const label = { pass: "Passed", block: "Blocking", warn: "Needs attention" } as const;
  return (
    <span role="img" aria-label={label[state]} className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold", styles[state])}>
      {glyph[state]}
    </span>
  );
}

export function StatTile({ label, children, hint, chip }: { label: string; children: ReactNode; hint?: ReactNode; chip?: ReactNode }) {
  return (
    <div className="flex min-h-[124px] flex-col rounded-inner bg-surface-2 p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] text-muted">{label}</span>
        {chip}
      </div>
      <div className="mt-auto pt-3">{children}</div>
      {hint && <div className="mt-1 text-[12px] text-muted">{hint}</div>}
    </div>
  );
}

export function Numeral({ children, unit, size = "md" }: { children: ReactNode; unit?: string; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "text-[17px]", md: "text-[26px]", lg: "text-[38px]" } as const;
  return (
    <span className={cx("numeral inline-flex items-baseline gap-1.5 text-text", sizes[size])}>
      <span>{children}</span>
      {unit && <span className="text-[12px] font-normal tracking-normal text-muted">{unit}</span>}
    </span>
  );
}

const TICKET_TONES: Record<string, { tone: Tone; label: string }> = {
  open: { tone: "lemon-soft", label: "Open" },
  awaiting_merchant: { tone: "peach", label: "Awaiting your reply" },
  resolved: { tone: "sage", label: "Resolved" },
  closed: { tone: "neutral", label: "Closed" },
};

export function TicketStatusChip({ status }: { status: string }) {
  const t = TICKET_TONES[status] ?? { tone: "neutral" as Tone, label: status };
  return <Chip tone={t.tone}>{t.label}</Chip>;
}

const DOMAIN_TONES: Record<string, { tone: Tone; label: string }> = {
  PENDING: { tone: "lemon-soft", label: "Pending DNS" },
  VERIFIED: { tone: "sage", label: "Verified" },
  FAILED: { tone: "rose", label: "Verification failed" },
  REVOKED: { tone: "neutral", label: "Removed" },
};

export function DomainStatusChip({ status }: { status: string }) {
  const t = DOMAIN_TONES[status] ?? { tone: "neutral" as Tone, label: status };
  return <Chip tone={t.tone}>{t.label}</Chip>;
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
