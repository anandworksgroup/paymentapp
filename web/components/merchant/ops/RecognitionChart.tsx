"use client";

import { useId, useState } from "react";
import { compactMoney, money } from "@/lib/format";

type Point = { key: string; label: string; recognized: number; deferred: number };

/**
 * Recognised revenue per month as reference-style pill bars, with the deferred-revenue balance at month
 * end as the smooth charcoal line. Both are money in the same currency, so they share one axis.
 */
export function RecognitionChart({ points, currency, selected, onSelect }: { points: Point[]; currency: string; selected?: string; onSelect?: (key: string) => void }) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const width = 640, height = 240, padX = 18, padTop = 34, padBottom = 28;
  const n = Math.max(1, points.length);
  const slot = (width - padX * 2) / n;
  const barW = Math.min(46, slot * 0.58);
  const max = Math.max(1, ...points.map((p) => Math.max(p.recognized, p.deferred)));
  const y = (v: number) => padTop + (1 - Math.max(0, v) / max) * (height - padTop - padBottom);
  const cx = (i: number) => padX + slot * i + slot / 2;
  const line = points.map((p, i) => ({ x: cx(i), y: y(p.deferred) }));
  const selIdx = points.findIndex((p) => p.key === selected);
  const active = hover ?? (selIdx >= 0 ? selIdx : points.length - 1);
  const colors = { sage: ["#b9dcae", "#eef7ea"], peach: ["#f3b98a", "#fdf0e4"] } as const;
  const base = height - padBottom;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-[12px] text-text-2" aria-hidden>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-2 rounded-full bg-sage-300" /> Recognised revenue</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-ink" /> Deferred at month end</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Recognised revenue by month with the deferred revenue balance">
        <defs>
          {(["sage", "peach"] as const).map((t) => (
            <linearGradient key={t} id={`${id}-${t}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={colors[t][0]} stopOpacity="0.95" />
              <stop offset="100%" stopColor={colors[t][1]} stopOpacity="0.3" />
            </linearGradient>
          ))}
        </defs>
        <line x1={padX} x2={width - padX} y1={base} y2={base} stroke="var(--line)" />
        {points.map((p, i) => {
          const top = Math.min(y(p.recognized), base - barW);
          const x = cx(i) - barW / 2;
          return (
            <g
              key={p.key}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(p.key)}
              className={onSelect ? "cursor-pointer" : undefined}
            >
              {/* Hit target covers the whole column, not just the bar. */}
              <rect x={cx(i) - slot / 2} y={padTop - 20} width={slot} height={base - padTop + 20} fill="transparent" />
              {p.recognized > 0 ? (
                <rect x={x} y={top} width={barW} height={base - top} rx={barW / 2} fill={`url(#${id}-${i === active ? "peach" : "sage"})`} />
              ) : (
                // Nothing recognised: a flat stub, so an empty month never looks like a small one.
                <rect x={x} y={base - 6} width={barW} height={6} rx={3} fill={i === active ? "var(--peach-soft)" : "var(--surface-3)"} />
              )}
              <text x={cx(i)} y={height - 8} textAnchor="middle" fontSize="11" fill={i === active ? "var(--text)" : "var(--muted)"}>{p.label}</text>
            </g>
          );
        })}
        {line.length > 1 && <path d={smooth(line)} fill="none" stroke="var(--ink)" strokeWidth="2.25" strokeLinecap="round" pointerEvents="none" />}
        {line.map((pt, i) => (
          <circle key={i} cx={pt.x} cy={pt.y} r={i === active ? 4.5 : 2.5} fill="var(--ink)" stroke="white" strokeWidth={i === active ? 2 : 1} pointerEvents="none" />
        ))}
        {points[active] && (
          <g transform={`translate(${Math.min(width - 150, Math.max(4, cx(active) - 73))}, 2)`} pointerEvents="none">
            <rect width="146" height="28" rx="14" fill="white" stroke="var(--line)" />
            <text x="73" y="18" textAnchor="middle" fontSize="11" fill="var(--text)">
              {compactMoney(points[active].recognized, currency)} · {compactMoney(points[active].deferred, currency)} def.
            </text>
          </g>
        )}
      </svg>
      <table className="sr-only">
        <caption>Recognised and deferred revenue by month ({currency})</caption>
        <thead><tr><th scope="col">Month</th><th scope="col">Recognised</th><th scope="col">Deferred at month end</th></tr></thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.key}><th scope="row">{p.key}</th><td>{money(p.recognized, currency, { code: true })}</td><td>{money(p.deferred, currency, { code: true })}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function smooth(pts: { x: number; y: number }[]) {
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1], p1 = pts[i];
    const mid = (p0.x + p1.x) / 2;
    d += ` C ${mid} ${p0.y}, ${mid} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  return d;
}
