"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Amount, Barcode, Chip, DayScrubber, PillChart, cx } from "@/components/ui";
import { compactMoney, pct } from "@/lib/format";

/** "Your current balance" hero card from the reference: label, lemon chip, large light numeral, barcode. */
export function HeroCard({ label, minor, currency, chip, spark, footer, tone = "white", info }: {
  label: string; minor: number | null | undefined; currency: string; chip?: ReactNode; spark?: number[]; footer?: ReactNode; tone?: "white" | "sage"; info?: ReactNode;
}) {
  return (
    <div className={cx("relative flex min-h-[176px] flex-col rounded-card p-6 shadow-card", tone === "sage" ? "sage-gradient" : "bg-surface")}>
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[13px] text-text-2">{label}{info}</span>
        {chip}
      </div>
      <div className="mt-auto pt-6">
        <Amount minor={minor} currency={currency} size="lg" />
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0 text-[12px] text-muted">{footer}</div>
        {spark && spark.length > 1 && <Barcode values={spark} />}
      </div>
    </div>
  );
}

export function DeltaChip({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <Chip tone="neutral">No prior data</Chip>;
  return <Chip tone={value >= 0 ? "lemon" : "peach"}>{value >= 0 ? "+" : ""}{pct(value)}</Chip>;
}

/**
 * Daily revenue as the reference "Weekly Rate" pill chart with a day scrubber underneath. Missing days
 * are shown as zero bars; values are the server's daily totals, unchanged.
 */
export function RevenueChart({ series, from, days, currency }: { series: { date: string; gross: number }[]; from: string; days: number; currency: string }) {
  const byDate = new Map(series.map((s) => [s.date, s.gross]));
  const start = new Date(from);
  const points = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i));
    const key = d.toISOString().slice(0, 10);
    return { key, day: d.getUTCDate(), value: byDate.get(key) ?? 0, month: d.toLocaleString(undefined, { month: "short", timeZone: "UTC" }) };
  });
  const [selected, setSelected] = useState<string | null>(null);
  const sel = selected && points.some((p) => p.key === selected) ? selected : points[points.length - 1]?.key;
  const idx = points.findIndex((p) => p.key === sel);
  const step = days <= 14 ? 1 : days <= 31 ? 3 : 10;
  const current = points[idx];
  const scrubRef = useRef<HTMLDivElement>(null);
  // Start the day scrubber at the most recent days, like the reference.
  useEffect(() => {
    const track = scrubRef.current?.firstElementChild as HTMLElement | null;
    if (track) track.scrollLeft = track.scrollWidth;
  }, [days]);
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-muted">{current ? `${current.month} ${current.day}` : ""}</span>
        {current && <Amount minor={current.value} currency={currency} size="sm" />}
      </div>
      <PillChart
        data={points.map((p, i) => ({ label: i % step === 0 || i === points.length - 1 ? String(p.day) : "", value: p.value }))}
        highlight={idx >= 0 ? idx : undefined}
        format={(v) => compactMoney(v, currency)}
        height={days > 31 ? 200 : 230}
      />
      <div className="mt-3" ref={scrubRef}>
        <DayScrubber days={points.map((p) => ({ key: p.key, label: String(p.day) }))} value={sel ?? ""} onChange={setSelected} />
      </div>
      <table className="sr-only">
        <caption>Daily gross revenue</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.key}><th scope="row">{p.key}</th><td>{compactMoney(p.value, currency)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
