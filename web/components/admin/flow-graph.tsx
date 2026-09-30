"use client";

/**
 * Money-flow graph: a layered, left-to-right node-link diagram drawn in SVG.
 *
 * - Nodes are typed (user wallet, merchant, bank account, funding source, device, external).
 * - Edges carry amount + currency. `relation` decides the stroke: "actual" (a recorded movement) is
 *   solid; "inferred_source" / "inferred_onward" are dashed because pooled wallet balances are
 *   fungible — the platform must never present those as a proven path of the same funds.
 * - Clicking a node opens the entity; clicking an edge label opens the transfer.
 */
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Button, Chip, cx } from "@/components/ui";
import { date, flag, money } from "@/lib/format";
import { adminApi, useDirectory } from "./data";
import type { GraphEdge, GraphNode, SearchResult } from "./types";

const NODE_W = 212;
const NODE_H = 54;
const COL_W = 330;
const ROW_H = 92;
const PAD = 40;

const NODE_TONES: Record<string, { dot: string; bg: string; label: string }> = {
  user_wallet: { dot: "var(--sage-500)", bg: "var(--sage-50)", label: "User wallet" },
  merchant_wallet: { dot: "var(--lemon)", bg: "#fdfbe9", label: "Merchant wallet" },
  merchant: { dot: "var(--lemon)", bg: "#fdfbe9", label: "Merchant" },
  bank_account: { dot: "var(--peach)", bg: "#fdf4ea", label: "Bank account" },
  funding_source: { dot: "var(--sky-ink)", bg: "var(--sky-soft)", label: "Funding source" },
  device: { dot: "var(--muted)", bg: "var(--surface-2)", label: "Device" },
  external: { dot: "var(--faint)", bg: "var(--surface-2)", label: "External" },
};

export const RELATION_STYLE: Record<string, { stroke: string; dash?: string; width: number; label: string; note: string }> = {
  actual: { stroke: "var(--ink)", width: 2, label: "Actual movement", note: "Recorded movement of funds on the ledger." },
  inferred_source: {
    stroke: "var(--sage-700)",
    dash: "7 6",
    width: 1.75,
    label: "Inferred source",
    note: "Earlier inflows into the sender's pooled balance — context, not a proven path.",
  },
  inferred_onward: {
    stroke: "var(--peach-ink)",
    dash: "7 6",
    width: 1.75,
    label: "Inferred onward",
    note: "Later outflows from the recipient's pooled balance — not a claim these are the same funds.",
  },
  signal: { stroke: "var(--faint)", dash: "2 5", width: 1.5, label: "Signal", note: "Non-monetary link such as a device used by the account." },
};

type Placed = GraphNode & { x: number; y: number; layer: number };
type PlacedEdge = GraphEdge & { d: string; lx: number; ly: number; back: boolean };

function layout(nodes: GraphNode[], edges: GraphEdge[], focus?: string | null) {
  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  const valid = edges.filter((e) => known.has(e.from) && known.has(e.to));
  const outs = new Map<string, number[]>();
  const indeg = new Map<string, number>(ids.map((i) => [i, 0]));
  valid.forEach((e, i) => {
    outs.set(e.from, [...(outs.get(e.from) ?? []), i]);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  });

  // 1. Break cycles (circular flows are exactly what investigators look for) with a DFS: edges that
  //    point back into the current path are drawn as return arcs instead of driving the layering.
  const state = new Map<string, 1 | 2>();
  const back = new Set<number>();
  const visit = (u: string) => {
    state.set(u, 1);
    for (const i of outs.get(u) ?? []) {
      const v = valid[i].to;
      if (v === u || state.get(v) === 1) back.add(i);
      else if (!state.has(v)) visit(v);
    }
    state.set(u, 2);
  };
  const starts = [...ids].sort((a, b) => {
    const fa = a === focus ? 1 : 0;
    const fb = b === focus ? 1 : 0;
    return (indeg.get(a) ?? 0) - (indeg.get(b) ?? 0) || fa - fb;
  });
  starts.forEach((s) => !state.has(s) && visit(s));

  // 2. Longest-path layering over the acyclic part.
  const layer = new Map<string, number>(ids.map((i) => [i, 0]));
  const fwd = valid.map((e, i) => ({ e, i })).filter(({ i }) => !back.has(i));
  const deg = new Map<string, number>(ids.map((i) => [i, 0]));
  fwd.forEach(({ e }) => deg.set(e.to, (deg.get(e.to) ?? 0) + 1));
  const queue = ids.filter((i) => (deg.get(i) ?? 0) === 0);
  while (queue.length) {
    const u = queue.shift()!;
    for (const { e } of fwd.filter((f) => f.e.from === u)) {
      layer.set(e.to, Math.max(layer.get(e.to) ?? 0, (layer.get(u) ?? 0) + 1));
      deg.set(e.to, (deg.get(e.to) ?? 0) - 1);
      if (deg.get(e.to) === 0) queue.push(e.to);
    }
  }
  // Pull pure sources (funding) right next to what they feed so they don't stack in column 0.
  for (const id of ids) {
    const targets = fwd.filter((f) => f.e.from === id).map((f) => layer.get(f.e.to) ?? 0);
    const sources = fwd.filter((f) => f.e.to === id);
    if (targets.length && sources.length === 0) layer.set(id, Math.max(0, Math.min(...targets) - 1));
  }

  // 3. Order within each layer by barycenter sweeps.
  const layers: string[][] = [];
  ids.forEach((id) => (layers[layer.get(id)!] ??= []).push(id));
  const compact = layers.filter(Boolean);
  compact.forEach((col, li) => col.forEach((id) => layer.set(id, li)));
  const pos = new Map<string, number>();
  const setPos = () => compact.forEach((col) => col.forEach((id, i) => pos.set(id, i - (col.length - 1) / 2)));
  setPos();
  const neighbours = (id: string, dir: "in" | "out") => valid.filter((e) => (dir === "in" ? e.to === id : e.from === id)).map((e) => (dir === "in" ? e.from : e.to));
  for (let pass = 0; pass < 4; pass++) {
    const down = pass % 2 === 0;
    const order = down ? compact : [...compact].reverse();
    for (const col of order) {
      const bary = new Map(
        col.map((id) => {
          const ns = neighbours(id, down ? "in" : "out").filter((n) => pos.has(n));
          return [id, ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : pos.get(id)!];
        }),
      );
      col.sort((a, b) => bary.get(a)! - bary.get(b)!);
      col.forEach((id, i) => pos.set(id, i - (col.length - 1) / 2));
    }
  }

  const maxRows = Math.max(1, ...compact.map((c) => c.length));
  const height = maxRows * ROW_H + PAD * 2 + 40;
  const width = Math.max(1, compact.length) * COL_W - (COL_W - NODE_W) + PAD * 2;
  const midY = PAD + (maxRows * ROW_H) / 2;
  const placed = new Map<string, Placed>();
  for (const n of nodes) {
    const li = layer.get(n.id) ?? 0;
    placed.set(n.id, { ...n, layer: li, x: PAD + li * COL_W, y: midY + (pos.get(n.id) ?? 0) * ROW_H });
  }

  // 4. Edge geometry: parallel edges between the same pair fan out; back edges arc underneath.
  const pairCount = new Map<string, number>();
  const pairIndex = new Map<number, number>();
  valid.forEach((e, i) => {
    const k = [e.from, e.to].sort().join("|");
    pairIndex.set(i, pairCount.get(k) ?? 0);
    pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
  });
  let maxY = height;
  const placedEdges: PlacedEdge[] = valid.map((e, i) => {
    const a = placed.get(e.from)!;
    const b = placed.get(e.to)!;
    const k = [e.from, e.to].sort().join("|");
    const n = pairCount.get(k)!;
    const off = (pairIndex.get(i)! - (n - 1) / 2) * 26;
    const isBack = back.has(i) || b.layer <= a.layer;
    if (!isBack) {
      const x1 = a.x + NODE_W, y1 = a.y, x2 = b.x, y2 = b.y;
      const cx = (x1 + x2) / 2;
      const c1 = { x: cx, y: y1 + off }, c2 = { x: cx, y: y2 + off };
      return { ...e, back: false, d: `M ${x1} ${y1} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${x2} ${y2}`, ...mid({ x: x1, y: y1 }, c1, c2, { x: x2, y: y2 }) };
    }
    // Return arc from the bottom of the source to the bottom of the target.
    const x1 = a.x + NODE_W / 2 + 18, y1 = a.y + NODE_H / 2;
    const x2 = b.x + NODE_W / 2 - 18, y2 = b.y + NODE_H / 2;
    const dip = Math.max(y1, y2) + 70 + Math.abs(off) * 1.5 + Math.abs(a.layer - b.layer) * 12;
    maxY = Math.max(maxY, dip + 20);
    const c1 = { x: x1, y: dip }, c2 = { x: x2, y: dip };
    return { ...e, back: true, d: `M ${x1} ${y1} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${x2} ${y2}`, ...mid({ x: x1, y: y1 }, c1, c2, { x: x2, y: y2 }) };
  });

  const ys = [...placed.values()].map((p) => p.y);
  const minY = Math.min(PAD, ...ys.map((y) => y - NODE_H / 2 - 20));
  return { nodes: [...placed.values()], edges: placedEdges, width, minY, height: Math.max(maxY, height) };
}

function mid(p0: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }) {
  return { lx: (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8, ly: (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8 };
}

function trunc(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function FlowGraph({
  nodes,
  edges,
  focusNode,
  rootEdge,
  subjectUserId,
  height = 560,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focusNode?: string | null;
  rootEdge?: string | null;
  /** Owner of device nodes in a user's fund-flow graph. */
  subjectUserId?: string | null;
  height?: number;
}) {
  const router = useRouter();
  const dir = useDirectory();
  const g = useMemo(() => layout(nodes, edges, focusNode), [nodes, edges, focusNode]);
  const W = g.width;
  const H = g.height - g.minY;
  // Rendered at a readable scale inside a scrollable box; drag or scroll to pan, buttons to zoom.
  const [scale, setScale] = useState(0.85);
  const [hover, setHover] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; sl: number; st: number; moved: boolean } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const zoom = (f: number) => setScale((k) => Math.min(2, Math.max(0.3, k * f)));
  const fitToBox = () => {
    const el = boxRef.current;
    if (!el) return;
    setScale(Math.max(0.3, Math.min(1.2, (el.clientWidth - 8) / W, (height - 8) / H)));
  };

  const open = async (n: GraphNode) => {
    if (drag.current?.moved) return;
    setHint(null);
    if (n.type === "user_wallet" || n.type === "merchant_wallet") {
      const w = dir.wallets.get(n.id);
      if (w) return router.push(w.owner_type === "user" ? `/admin/users/${w.owner_id}` : `/admin/merchants/${w.owner_id}`);
      setBusy(n.id);
      try {
        const r = await adminApi<SearchResult>(`/search?q=${encodeURIComponent(n.id)}`);
        const hit = r.wallets.find((x) => x.id === n.id);
        if (hit) router.push(hit.owner_type === "user" ? `/admin/users/${hit.owner_id}` : `/admin/merchants/${hit.owner_id}`);
        else setHint("This wallet's owner couldn't be resolved.");
      } catch (e) {
        setHint((e as Error).message);
      } finally {
        setBusy(null);
      }
      return;
    }
    if (n.type === "merchant") return router.push(`/admin/merchants/${n.id}`);
    if (n.type === "device") {
      if (subjectUserId) return router.push(`/admin/users/${subjectUserId}`);
      try {
        const r = await adminApi<SearchResult>(`/search?q=${encodeURIComponent(n.id)}`);
        if (r.devices[0]) return router.push(`/admin/users/${r.devices[0].user_id}`);
      } catch {
        /* fall through */
      }
    }
    if (n.type === "bank_account") return setHint(`${n.label}: bank accounts are shown by last 4 digits only. Open a connected transfer for details.`);
    if (n.type === "funding_source") return setHint(`${n.label}: external funding source (card, bank transfer or top-up). Open the funding transfer for details.`);
    setHint(`${n.label}: this is an external party with no record in the console.`);
  };

  const related = (e: GraphEdge) => !hover || e.from === hover || e.to === hover;
  const relations = [...new Set(edges.map((e) => e.relation))];

  if (nodes.length === 0) {
    return <div className="rounded-inner bg-surface-2 px-6 py-14 text-center text-[13.5px] text-muted">No money movement in this window.</div>;
  }

  return (
    <div>
      <div className="relative rounded-inner border border-line bg-surface-2">
        <div className="absolute right-3 top-3 z-10 flex gap-1.5">
          <Button size="sm" variant="soft" aria-label="Zoom in" onClick={() => zoom(1.2)} className="bg-surface shadow-card">
            +
          </Button>
          <Button size="sm" variant="soft" aria-label="Zoom out" onClick={() => zoom(1 / 1.2)} className="bg-surface shadow-card">
            −
          </Button>
          <Button size="sm" variant="soft" onClick={fitToBox} className="bg-surface shadow-card">
            Fit
          </Button>
        </div>
        <div
          ref={boxRef}
          className="cursor-grab overflow-auto active:cursor-grabbing"
          style={{ maxHeight: height }}
          onPointerDown={(e) => {
            const el = boxRef.current;
            if (!el) return;
            drag.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, moved: false };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            const el = boxRef.current;
            if (!d || !el) return;
            const dx = e.clientX - d.x, dy = e.clientY - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
            if (!d.moved) return;
            el.scrollLeft = d.sl - dx;
            el.scrollTop = d.st - dy;
          }}
          onPointerUp={() => setTimeout(() => (drag.current = null), 0)}
          onPointerLeave={() => (drag.current = null)}
        >
        <svg
          role="img"
          aria-label="Money flow graph"
          viewBox={`0 ${g.minY} ${W} ${H}`}
          width={W * scale}
          height={H * scale}
          className="block select-none"
        >
          <defs>
            {Object.entries(RELATION_STYLE).map(([k, s]) => (
              <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill={s.stroke} />
              </marker>
            ))}
          </defs>

          {g.edges.map((e) => {
            const s = RELATION_STYLE[e.relation] ?? RELATION_STYLE.actual;
            const isRoot = e.id === rootEdge;
            return (
              <path
                key={e.id + e.from}
                d={e.d}
                fill="none"
                stroke={s.stroke}
                strokeWidth={isRoot ? s.width + 1.5 : s.width}
                strokeDasharray={s.dash}
                markerEnd={`url(#arrow-${e.relation in RELATION_STYLE ? e.relation : "actual"})`}
                opacity={related(e) ? 1 : 0.15}
              />
            );
          })}

          {g.edges
            .filter((e) => e.relation !== "signal")
            .map((e) => {
              const s = RELATION_STYLE[e.relation] ?? RELATION_STYLE.actual;
              const text = money(e.amount, e.currency, { code: true }) + (e.status && e.status !== "COMPLETED" ? ` · ${e.status.toLowerCase()}` : "");
              const w = text.length * 6.3 + 20;
              const inferred = e.relation.startsWith("inferred");
              return (
                <g
                  key={"l" + e.id + e.from}
                  transform={`translate(${e.lx - w / 2}, ${e.ly - 11})`}
                  opacity={related(e) ? 1 : 0.2}
                  className="cursor-pointer"
                  onClick={() => !drag.current?.moved && router.push(`/admin/transactions/${e.id}`)}
                >
                  <title>{`${e.type} · ${text}\n${date(e.at, true)}\n${s.label}${e.note ? ` — ${e.note}` : ""}\nClick to open the transfer.`}</title>
                  <rect width={w} height={22} rx={11} fill="white" stroke={e.id === rootEdge ? "var(--ink)" : inferred ? s.stroke : "var(--line-strong)"} strokeDasharray={inferred ? "3 3" : undefined} />
                  <text x={w / 2} y={15} textAnchor="middle" fontSize="11" fill={e.status === "HELD" ? "var(--peach-ink)" : "var(--text)"}>
                    {text}
                  </text>
                </g>
              );
            })}

          {g.nodes.map((n) => {
            const t = NODE_TONES[n.type] ?? NODE_TONES.external;
            const isFocus = n.id === focusNode;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x}, ${n.y - NODE_H / 2})`}
                className="cursor-pointer"
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => void open(n)}
                role="button"
                aria-label={`${t.label}: ${n.label}`}
                tabIndex={0}
                onKeyDown={(ev) => ev.key === "Enter" && void open(n)}
              >
                <title>{`${t.label}\n${n.label}${n.country ? `\nCountry: ${n.country}` : ""}\n${n.id}`}</title>
                <rect width={NODE_W} height={NODE_H} rx={NODE_H / 2} fill="white" stroke={isFocus ? "var(--ink)" : hover === n.id ? "var(--sage-500)" : "var(--line-strong)"} strokeWidth={isFocus ? 2 : 1} />
                <circle cx={NODE_H / 2} cy={NODE_H / 2} r={15} fill={t.bg} stroke={t.dot} strokeWidth={1.5} />
                <text x={NODE_H / 2} y={NODE_H / 2 + 4.5} textAnchor="middle" fontSize="12">
                  {n.country && n.country.length === 2 ? flag(n.country) : "•"}
                </text>
                <text x={NODE_H - 2} y={22} fontSize="12.5" fill="var(--text)" fontWeight={isFocus ? 500 : 400}>
                  {trunc(n.label, 24)}
                </text>
                <text x={NODE_H - 2} y={39} fontSize="10.5" fill="var(--muted)">
                  {busy === n.id ? "Opening…" : `${t.label}${n.country ? ` · ${n.country}` : ""}`}
                </text>
              </g>
            );
          })}
        </svg>
        </div>
      </div>

      {hint && <p className="mt-2 rounded-full bg-surface-2 px-3.5 py-1.5 text-[12px] text-text-2">{hint}</p>}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-text-2" aria-label="Edge legend">
          {Object.entries(RELATION_STYLE)
            .filter(([k]) => relations.includes(k) || k === "actual" || k.startsWith("inferred"))
            .map(([k, s]) => (
              <li key={k} className="flex items-center gap-2" title={s.note}>
                <svg width="36" height="10" aria-hidden>
                  <line x1="1" y1="5" x2="35" y2="5" stroke={s.stroke} strokeWidth={s.width + 0.25} strokeDasharray={s.dash} />
                </svg>
                <span>
                  <span className="font-medium text-text">{s.label}</span> <span className="text-muted">— {s.note}</span>
                </span>
              </li>
            ))}
        </ul>
        <ul className="flex flex-wrap items-start gap-1.5" aria-label="Node legend">
          {Object.entries(NODE_TONES)
            .filter(([k]) => nodes.some((n) => n.type === k))
            .map(([k, t]) => (
              <li key={k}>
                <Chip className={cx("border")}>
                  <span className="h-2 w-2 rounded-full" style={{ background: t.dot }} />
                  {t.label}
                </Chip>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}
