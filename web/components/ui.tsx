"use client";

/**
 * Shared design-system primitives. Every page composes these so the whole product keeps the
 * reference look: white 28px cards on a misty sage canvas, lemon/sage/peach chips, charcoal pills,
 * light large numerals, pill-bar charts with a smooth line and barcode sparklines.
 */
import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { moneyParts } from "@/lib/format";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

// ───────────────────────── Surfaces ─────────────────────────

export function Card({ children, className, pad = true, as: As = "section" }: { children: ReactNode; className?: string; pad?: boolean; as?: React.ElementType }) {
  return <As className={cx("card", pad && "p-6", className)}>{children}</As>;
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-[19px] font-medium tracking-[-0.01em] text-text">{title}</h2>
        {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="mb-1 text-[12px] uppercase tracking-[0.08em] text-muted">{eyebrow}</div>}
        <h1 className="text-[34px] font-normal leading-tight tracking-[-0.03em] text-text">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[14px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

// ───────────────────────── Numbers ─────────────────────────

/** Large light numeral with a small currency code: €8,499 EUR (reference style). */
export function Amount({ minor, currency, size = "lg", className, showCode = true }: { minor: number | null | undefined; currency: string; size?: "sm" | "md" | "lg" | "xl"; className?: string; showCode?: boolean }) {
  if (minor === null || minor === undefined) return <span className="text-muted">—</span>;
  const p = moneyParts(minor, currency);
  const sizes = { sm: "text-[17px]", md: "text-[26px]", lg: "text-[38px]", xl: "text-[48px]" } as const;
  return (
    <span className={cx("numeral inline-flex items-baseline gap-1.5 text-text", sizes[size], className)}>
      <span>
        {p.negative ? "−" : ""}
        {p.symbol}
        {p.whole}
        {/* Large numerals drop ".00" like the reference, but never hide real minor units (29.75 must not read as 29). */}
        {p.fraction && ((size !== "xl" && size !== "lg") || /[1-9]/.test(p.fraction)) ? (
          <span className={cx("text-text-2", (size === "xl" || size === "lg") && "text-[0.6em]")}>.{p.fraction}</span>
        ) : null}
      </span>
      {showCode && <span className="text-[12px] font-normal tracking-normal text-muted">{p.code}</span>}
    </span>
  );
}

export function Stat({ label, children, chip, spark, onClick }: { label: string; children: ReactNode; chip?: ReactNode; spark?: number[]; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => onClick && (e.key === "Enter" || e.key === " ") && onClick()}
      className={cx("rounded-inner bg-surface-2 p-5 transition", onClick && "cursor-pointer hover:bg-surface-3")}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] text-muted">{label}</span>
        {chip}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>{children}</div>
        {spark && spark.length > 1 && <Barcode values={spark} />}
      </div>
    </div>
  );
}

// ───────────────────────── Chips & buttons ─────────────────────────

const TONES = {
  lemon: "bg-lemon text-lemon-ink",
  "lemon-soft": "bg-lemon-soft text-lemon-ink",
  sage: "bg-sage-100 text-sage-700",
  peach: "bg-peach-soft text-peach-ink",
  rose: "bg-rose-soft text-rose-ink",
  sky: "bg-sky-soft text-sky-ink",
  ink: "bg-ink text-white",
  neutral: "bg-surface-3 text-text-2",
} as const;
export type Tone = keyof typeof TONES;

export function Chip({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-medium", TONES[tone], className)}>{children}</span>;
}

const STATUS_TONES: Record<string, Tone> = {
  succeeded: "sage", paid: "sage", active: "sage", completed: "sage", approved: "sage", verified: "sage", won: "sage", matched: "sage",
  healthy: "sage", normal: "sage", available: "sage", executed: "sage", resolved: "sage", false_positive: "sage", clear: "sage", enabled: "sage", applied: "sage", complete: "sage",
  processing: "lemon-soft", pending: "lemon-soft", requires_action: "lemon-soft", open: "lemon-soft", trialing: "sky", under_review: "lemon-soft",
  in_review: "lemon-soft", new: "lemon", queued: "lemon-soft", draft: "neutral", screening: "lemon-soft", degraded: "lemon", needs_response: "peach",
  action_required: "peach", held: "peach", on_hold: "peach", past_due: "peach", partially_refunded: "peach", escalated: "peach", disputed: "peach",
  medium: "lemon-soft", high: "peach", critical: "rose", low: "neutral", potential_match: "rose", review: "lemon-soft",
  failed: "rose", declined: "rose", chargeback: "rose", lost: "rose", rejected: "rose", unavailable: "rose", frozen: "rose", suspended: "rose",
  dead: "rose", returned: "rose", uncollectible: "rose", cancelled: "neutral", canceled: "neutral", expired: "neutral", void: "neutral",
  refunded: "neutral", archived: "neutral", closed: "neutral", disabled: "neutral", revoked: "neutral", discarded: "neutral", incomplete: "neutral",
  paused: "sky", reported: "sky", test: "lemon", live: "ink",
};

export function StatusChip({ status, className }: { status?: string | null; className?: string }) {
  if (!status) return null;
  const key = status.toLowerCase();
  return (
    <Chip tone={STATUS_TONES[key] ?? "neutral"} className={className}>
      {status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
    </Chip>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "ink" | "lemon" | "ghost" | "soft" | "danger"; size?: "sm" | "md"; loading?: boolean; icon?: ReactNode };
export function Button({ variant = "ink", size = "md", loading, icon, className, children, disabled, ...rest }: ButtonProps) {
  const variants = {
    ink: "bg-ink text-white hover:bg-ink-2",
    lemon: "bg-lemon text-lemon-ink hover:brightness-95",
    ghost: "bg-transparent text-text-2 hover:bg-surface-3",
    soft: "bg-surface-2 text-text hover:bg-surface-3",
    danger: "bg-rose-soft text-rose-ink hover:brightness-95",
  } as const;
  const sizes = { sm: "h-8 px-3.5 text-[12.5px]", md: "h-11 px-5 text-[14px]" } as const;
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx("inline-flex items-center justify-center gap-2 rounded-full font-medium transition disabled:cursor-not-allowed disabled:opacity-50", variants[variant], sizes[size], className)}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cx("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}

// ───────────────────────── Forms ─────────────────────────

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  const id = useId();
  return (
    // The label wraps its control, so the association is implicit (an htmlFor pointing at an id
    // the control doesn't carry would break it and leave the input unnamed for screen readers).
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-text-2">{label}</span>
      <div data-field-id={id}>{children}</div>
      {error ? <span role="alert" className="mt-1 block text-[12px] text-rose-ink">{error}</span> : hint ? <span className="mt-1 block text-[12px] text-muted">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full h-11 rounded-field border border-line bg-surface px-3.5 text-[14px] text-text placeholder:text-faint outline-none transition focus:border-sage-500 focus:ring-4 focus:ring-sage-100";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(inputClass, "appearance-none pr-9", props.className)}>
      {children}
    </select>
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputClass, "h-auto min-h-24 py-3", props.className)} />;
}

/** Segmented control (the "Custom ▾ / Weekly" pills in the reference). */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="inline-flex rounded-full bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx("h-8 rounded-full px-3.5 text-[12.5px] font-medium transition", o.value === value ? "bg-ink text-white" : "text-text-2 hover:text-text")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── Feedback ─────────────────────────

export function Empty({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-inner bg-surface-2 px-6 py-14 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-full sage-gradient text-sage-700">{icon ?? <span className="text-xl">✦</span>}</div>
      <h3 className="text-[16px] font-medium text-text">{title}</h3>
      {children && <p className="mt-1.5 max-w-md text-[13.5px] text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as { message?: string; requestId?: string };
  return (
    <div role="alert" className="rounded-inner bg-rose-soft px-4 py-3 text-[13px] text-rose-ink">
      {e.message ?? "Something went wrong."}
      {e.requestId && <span className="ml-2 opacity-70">({e.requestId})</span>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-inner bg-surface-3", className)} />;
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    // Move focus into the dialog unless a child already took it (autoFocus).
    if (dialog && !dialog.contains(document.activeElement)) {
      const first = dialog.querySelector<HTMLElement>("input, select, textarea, button:not([aria-label='Close']), [href], [tabindex]:not([tabindex='-1'])");
      (first ?? dialog).focus();
    }
    const onKey = (e: KeyboardEvent) => {
      // Only the top-most dialog reacts, so Escape in a nested dialog doesn't close its parent too.
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== dialogRef.current) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === "Tab" && dialogRef.current) {
        const items = [...dialogRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")];
        if (!items.length) return;
        const firstEl = items[0], lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(29,31,30,0.28)] p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()} className={cx("card max-h-[90vh] w-full overflow-auto p-7 shadow-float outline-none", wide ? "max-w-3xl" : "max-w-lg")}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-[20px] font-medium tracking-[-0.01em]">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted hover:text-text">✕</button>
        </div>
        {children}
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

// ───────────────────────── Tables ─────────────────────────

export type Column<T> = { key: string; header: ReactNode; render: (row: T) => ReactNode; align?: "left" | "right"; className?: string };

export function Table<T>({ rows, columns, onRowClick, empty, rowKey }: { rows: T[]; columns: Column<T>[]; onRowClick?: (row: T) => void; empty?: ReactNode; rowKey: (row: T) => string }) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="relative -mx-2 overflow-x-auto">
      <table className="w-full border-separate border-spacing-y-1 text-[13.5px]">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cx("px-3 pb-2 text-[12px] font-normal text-muted", c.align === "right" ? "text-right" : "text-left")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={() => onRowClick?.(r)}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={(e) => onRowClick && e.key === "Enter" && onRowClick(r)}
              className={cx("group", onRowClick && "cursor-pointer")}
            >
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  className={cx(
                    "bg-surface px-3 py-3 transition group-hover:bg-surface-2",
                    i === 0 && "rounded-l-[14px]",
                    i === columns.length - 1 && "rounded-r-[14px]",
                    c.align === "right" && "text-right",
                    c.className,
                  )}
                >
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────── Charts ─────────────────────────

/** Mini "barcode" sparkline from the reference transaction list. */
export function Barcode({ values, width = 72, height = 26 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(1, ...values.map(Math.abs));
  const n = values.length;
  const bw = Math.max(1.5, width / (n * 2));
  return (
    <svg width={width} height={height} aria-hidden className="shrink-0">
      {values.map((v, i) => {
        const h = Math.max(2, (Math.abs(v) / max) * height);
        const x = (i / n) * width;
        return <rect key={i} x={x} y={height - h} width={bw} height={h} rx={bw / 2} fill={i === n - 1 ? "var(--ink)" : "var(--faint)"} />;
      })}
    </svg>
  );
}

/**
 * The reference "Weekly Rate" chart: soft pill-shaped bars with vertical gradients and a smooth
 * charcoal line running through them; the highlighted bar gets a value bubble.
 */
export function PillChart({
  data, height = 220, highlight, format = (v) => String(v), tones = ["sage", "lemon", "sage", "peach", "sage", "lemon"],
}: {
  data: { label: string; value: number }[];
  height?: number;
  highlight?: number;
  format?: (v: number) => string;
  tones?: ("sage" | "lemon" | "peach")[];
}) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const padX = 18, padTop = 28, padBottom = 28;
  const n = Math.max(1, data.length);
  const slot = (width - padX * 2) / n;
  const barW = Math.min(44, slot * 0.62);
  const max = Math.max(1, ...data.map((d) => d.value));
  const y = (v: number) => padTop + (1 - v / max) * (height - padTop - padBottom);
  const pts = data.map((d, i) => ({ x: padX + slot * i + slot / 2, y: y(d.value) }));
  const path = smooth(pts);
  const active = hover ?? highlight ?? (data.length ? data.length - 1 : null);
  const colors = { sage: ["#b9dcae", "#eef7ea"], lemon: ["#efe27a", "#fbf8e2"], peach: ["#f3b98a", "#fdf0e4"] } as const;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Chart">
      <defs>
        {(["sage", "lemon", "peach"] as const).map((t) => (
          <linearGradient key={t} id={`${id}-${t}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={colors[t][0]} stopOpacity="0.95" />
            <stop offset="100%" stopColor={colors[t][1]} stopOpacity="0.25" />
          </linearGradient>
        ))}
      </defs>
      {data.map((d, i) => {
        const x = padX + slot * i + (slot - barW) / 2;
        const top = Math.min(y(d.value), height - padBottom - barW) - 10;
        const tone = i === active ? "peach" : tones[i % tones.length];
        return (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={x} y={Math.max(padTop - 12, top)} width={barW} height={height - padBottom - Math.max(padTop - 12, top)} rx={barW / 2} fill={`url(#${id}-${tone})`} />
            <text x={x + barW / 2} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{d.label}</text>
          </g>
        );
      })}
      {pts.length > 1 && <path d={path} fill="none" stroke="var(--ink)" strokeWidth="2.25" strokeLinecap="round" />}
      {active !== null && pts[active] && (
        <g>
          <circle cx={pts[active].x} cy={pts[active].y} r="4.5" fill="var(--ink)" />
          <g transform={`translate(${Math.min(width - 60, Math.max(4, pts[active].x - 32))}, ${Math.max(2, pts[active].y - 34)})`}>
            <rect width="64" height="24" rx="12" fill="white" stroke="var(--line)" />
            <text x="32" y="16" textAnchor="middle" fontSize="11.5" fill="var(--text)">{format(data[active].value)}</text>
          </g>
        </g>
      )}
    </svg>
  );
}

function smooth(pts: { x: number; y: number }[]) {
  if (pts.length === 0) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1], p1 = pts[i];
    const cx = (p0.x + p1.x) / 2;
    d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  return d;
}

/** Horizontal share bars (by country / method), styled as pills. */
export function ShareBars({ rows, format }: { rows: { label: ReactNode; value: number; sub?: ReactNode }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={i}>
          <div className="mb-1.5 flex items-center justify-between text-[13px]">
            <span className="text-text-2">{r.label}</span>
            <span className="numeral text-text">{format(r.value)} {r.sub && <span className="ml-1 text-muted">{r.sub}</span>}</span>
          </div>
          <div className="h-2.5 rounded-full bg-surface-3">
            <div className="h-2.5 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: i % 3 === 1 ? "var(--lemon)" : i % 3 === 2 ? "var(--peach)" : "var(--sage-300)" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Horizontal day scrubber from the reference ("12 14 16 20 …" in a sage pill track). */
export function DayScrubber({ days, value, onChange }: { days: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto rounded-full bg-gradient-to-r from-sage-200 via-sage-100 to-transparent p-1">
      {days.map((d) => (
        <button
          type="button"
          key={d.key}
          onClick={() => onChange(d.key)}
          className={cx("h-8 min-w-9 shrink-0 rounded-full px-2 text-[12px] transition", d.key === value ? "bg-surface text-text shadow-card" : "text-text-2 hover:bg-white/60")}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}
