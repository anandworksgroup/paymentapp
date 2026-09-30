"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Barcode, Button, Card, Empty, ErrorNote, Input, Modal, Skeleton, cx, inputClass, Amount } from "@/components/ui";
import { date, flag, titleCase } from "@/lib/format";
import type { StateTransition } from "@/lib/merchant/types";
import { Icon } from "./icons";

// ───────────────────────── Small building blocks ─────────────────────────

export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard blocked — the value is still visible to copy by hand */
        }
      }}
      className={cx("inline-flex h-7 items-center gap-1 rounded-full bg-surface-2 px-2.5 text-[11.5px] text-text-2 transition hover:bg-surface-3", className)}
      aria-label={`${label} ${value}`}
    >
      <Icon name={done ? "check" : "copy"} size={13} />
      <span aria-live="polite">{done ? "Copied" : label}</span>
    </button>
  );
}

/** Monospace object id with copy on click. */
export function Mono({ children, copy = true, className }: { children: string; copy?: boolean; className?: string }) {
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-1.5 font-mono text-[12px] normal-case tracking-normal text-text-2", className)}>
      <span className="truncate">{children}</span>
      {copy && <CopyButton value={children} label="Copy" className="h-6 px-2" />}
    </span>
  );
}

/** Circular flag avatar on a hairline (reference transaction rows). */
export function FlagAvatar({ country, size = 34 }: { country?: string | null; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full border border-line bg-surface-2"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      aria-label={country ? `Country ${country}` : "Unknown country"}
      role="img"
    >
      {flag(country)}
    </span>
  );
}

export function KV({ rows, className }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cx("grid grid-cols-1 gap-x-6 gap-y-3 text-[13.5px] sm:grid-cols-[minmax(120px,max-content)_1fr]", className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-text">{v ?? <span className="text-faint">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mb-3 inline-flex items-center gap-1 rounded-full text-[13px] text-muted hover:text-text">
      <Icon name="left" size={15} /> {children}
    </Link>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-[15px] font-medium text-text">{children}</h3>
      {action}
    </div>
  );
}

/** Status timeline from state transitions (§215). */
export function Timeline({ items, empty = "No state changes recorded yet." }: { items: StateTransition[]; empty?: string }) {
  if (!items.length) return <p className="text-[13px] text-muted">{empty}</p>;
  return (
    <ol className="relative space-y-4 pl-6">
      <span aria-hidden className="absolute bottom-2 left-[7px] top-2 w-px bg-line" />
      {items.map((t, i) => (
        <li key={t.id} className="relative">
          <span aria-hidden className={cx("absolute -left-6 top-1 h-3.5 w-3.5 rounded-full border-2 border-white", i === items.length - 1 ? "bg-ink" : "bg-sage-300")} />
          <div className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
            <span className="font-medium text-text">{titleCase(t.to_state)}</span>
            {t.from_state && <span className="text-muted">from {titleCase(t.from_state)}</span>}
          </div>
          <div className="text-[12px] text-muted">
            {date(t.created_at, true)}
            {t.reason ? ` · ${t.reason}` : ""}
            {t.actor_id && t.actor_id !== "system" ? ` · by ${t.actor_id}` : ""}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Pager({ page, hasPrev, hasMore, onPrev, onNext, loading }: { page: number; hasPrev: boolean; hasMore: boolean; onPrev: () => void; onNext: () => void; loading?: boolean }) {
  if (!hasPrev && !hasMore) return null;
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-end gap-2 text-[12.5px] text-muted">
      <span>Page {page}</span>
      <Button size="sm" variant="soft" disabled={!hasPrev || loading} onClick={onPrev} icon={<Icon name="left" size={14} />}>Previous</Button>
      <Button size="sm" variant="soft" disabled={!hasMore || loading} onClick={onNext}>Next <Icon name="right" size={14} /></Button>
    </nav>
  );
}

export function SearchBox({ value, onChange, placeholder = "Search", label = "Search" }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-xs">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"><Icon name="search" size={16} /></span>
      <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cx(inputClass, "h-10 rounded-full pl-10")} />
    </div>
  );
}

/** A pill select for filter bars. */
export function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 appearance-none rounded-full border border-line bg-surface pl-4 pr-9 text-[13px] text-text-2 outline-none transition focus:border-sage-500 focus:ring-4 focus:ring-sage-100">
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3 text-muted"><Icon name="chevron" size={15} /></span>
    </label>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center gap-2">{children}</div>;
}

/** Money input: typed in major units, shows the currency code. */
export function MoneyInput({ currency, value, onChange, id, ...rest }: { currency: string; value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <div className="relative">
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="pr-14" {...rest} />
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] text-muted">{currency}</span>
    </div>
  );
}

export function ConfirmModal({ open, onClose, title, children, confirmLabel = "Confirm", onConfirm, busy, error, danger }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; confirmLabel?: string; onConfirm: () => void; busy?: boolean; error?: unknown; danger?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? "danger" : "ink"} loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="space-y-3 text-[14px] text-text-2">{children}</div>
      <div aria-live="assertive" className="mt-3">{error ? <ErrorNote error={error} /> : null}</div>
    </Modal>
  );
}

/** A small (i) button that reveals a definition. Keyboard and screen-reader friendly. */
export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex">
      <button type="button" aria-label={`About ${label}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="grid h-5 w-5 place-items-center rounded-full text-muted hover:text-text">
        <Icon name="info" size={14} />
      </button>
      {open && (
        <span id={id} role="note" className="absolute left-1/2 top-6 z-30 w-64 -translate-x-1/2 rounded-inner bg-surface p-3.5 text-left text-[12.5px] font-normal leading-relaxed text-text-2 shadow-float">
          <span className="mb-1 block font-medium text-text">{label}</span>
          {children}
        </span>
      )}
    </span>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-inner bg-surface-2 p-4 font-mono text-[12px] leading-relaxed text-text-2">{JSON.stringify(value, null, 2)}</pre>
  );
}

// ───────────────────────── Page states ─────────────────────────

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 rounded-[14px]" />
      ))}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-10 w-72" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-48 lg:col-span-2" />
        <Skeleton className="h-48" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

/** Wraps a loaded region: skeleton → error → content. */
export function Loaded<T>({ data, error, loading, skeleton, children, onRetry }: { data: T | undefined; error: unknown; loading?: boolean; skeleton?: ReactNode; children: (d: T) => ReactNode; onRetry?: () => void }) {
  if (data !== undefined) return <>{children(data)}</>;
  if (error)
    return (
      <div className="space-y-3" aria-live="assertive">
        <ErrorNote error={error} />
        {onRetry && <Button size="sm" variant="soft" onClick={onRetry}>Try again</Button>}
      </div>
    );
  if (loading !== false) return <>{skeleton ?? <ListSkeleton />}</>;
  return null;
}

export function NoAccess({ what }: { what: string }) {
  return (
    <Card>
      <Empty title="You don't have access to this" icon={<Icon name="lock" />}>
        Your role can&apos;t view {what}. Ask an owner or admin of this organization if you need it.
      </Empty>
    </Card>
  );
}

// ───────────────────────── Reference-style rows ─────────────────────────

/**
 * The reference transaction row: small grey label, large light amount + code, barcode sparkline and
 * a circular flag avatar, separated by hairlines.
 */
export function TxRow({ href, label, minor, currency, country, spark, right, onClick }: {
  href?: string; label: ReactNode; minor: number; currency: string; country?: string | null; spark?: number[]; right?: ReactNode; onClick?: () => void;
}) {
  const inner = (
    <div className="flex items-center gap-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-muted">{label}</div>
        <Amount minor={minor} currency={currency} size="md" className="mt-0.5" />
      </div>
      {spark && spark.length > 1 && <div className="hidden sm:block"><Barcode values={spark} /></div>}
      {right}
      <FlagAvatar country={country} />
    </div>
  );
  const cls = "block border-b border-line last:border-b-0 rounded-sm transition hover:bg-surface-2/60 -mx-2 px-2";
  if (href) return <Link href={href} className={cls}>{inner}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cx(cls, "w-full text-left")}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}

/**
 * Barcode values for row `i` of a newest-first list: the amounts of the up-to-12 rows ending at this
 * one (oldest → this row), so the charcoal last bar is this payment next to its predecessors.
 */
export function rollingSpark<T>(rows: T[], i: number, value: (r: T) => number, n = 12) {
  return rows.slice(i, i + n).map(value).reverse();
}

export function Help({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] leading-relaxed text-muted">{children}</p>;
}
