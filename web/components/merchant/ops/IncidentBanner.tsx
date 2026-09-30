"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { date, relative, titleCase } from "@/lib/format";
import { latestUpdate, type IncidentEntry } from "@/lib/merchant/platform";
import { Icon } from "../icons";

const DISMISSED_KEY = "pa.incidents.dismissed";

function readDismissed(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(DISMISSED_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** A dismissal covers one incident at one update: a newer update brings the banner back. */
const dismissKey = (e: IncidentEntry) => `${e.incident.id}@${latestUpdate(e)?.created_at ?? e.incident.started_at}`;

const SEVERITY: Record<string, { box: string; chip: string; label: string }> = {
  critical: { box: "bg-rose-soft text-rose-ink", chip: "bg-white/70 text-rose-ink", label: "Major outage" },
  major: { box: "bg-peach-soft text-peach-ink", chip: "bg-white/70 text-peach-ink", label: "Partial outage" },
  minor: { box: "bg-lemon-soft text-lemon-ink", chip: "bg-white/70 text-lemon-ink", label: "Degraded" },
};

/** Unresolved platform incidents, newest first, each with its latest public update. */
export function IncidentBanner({ active }: { active: IncidentEntry[] }) {
  const [dismissed, setDismissed] = useState<string[]>(() => (typeof window === "undefined" ? [] : readDismissed()));
  const visible = active.filter((e) => !dismissed.includes(dismissKey(e)));
  if (!visible.length) return null;

  const dismiss = (e: IncidentEntry) => {
    // Keep only keys for incidents that are still active so storage never grows unbounded.
    const next = [...dismissed.filter((k) => active.some((a) => k.startsWith(a.incident.id + "@"))), dismissKey(e)];
    setDismissed(next);
    try {
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      /* dismissal lasts for this page view only */
    }
  };

  return (
    <div className="mb-5 space-y-2" role="region" aria-label="Platform status">
      {visible.map((e) => {
        const tone = SEVERITY[e.incident.severity] ?? SEVERITY.minor;
        const last = latestUpdate(e);
        const affected = e.incident.affected_services_csv.split(",").map((s) => s.trim()).filter(Boolean);
        return (
          <div key={e.incident.id} role="status" className={cx("flex items-start gap-3 rounded-inner px-5 py-4 shadow-card", tone.box)}>
            <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-medium">{e.incident.title}</span>
                <span className={cx("rounded-full px-2.5 py-0.5 text-[11.5px] font-medium", tone.chip)}>{tone.label}</span>
                <span className={cx("rounded-full px-2.5 py-0.5 text-[11.5px] font-medium", tone.chip)}>{titleCase(e.incident.status)}</span>
              </div>
              {last?.message && <p className="mt-1 text-[13px] leading-relaxed opacity-90">{last.message}</p>}
              <p className="mt-1 text-[12px] opacity-75">
                {e.incident.customer_impact ? `${e.incident.customer_impact} · ` : ""}
                {affected.length ? `Affects ${affected.join(", ")} · ` : ""}
                Started {date(e.incident.started_at, true)}
                {last ? ` · updated ${relative(last.created_at)}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => dismiss(e)}
              aria-label={`Dismiss notice about ${e.incident.title}`}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/60 transition hover:bg-white"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Small header button listing incidents resolved in the last 14 days. Renders nothing when there are none. */
export function RecentIncidents({ recent }: { recent: IncidentEntry[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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
  if (!recent.length) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        aria-label={`${recent.length} recently resolved platform incident${recent.length === 1 ? "" : "s"}`}
        className="glass grid h-10 w-10 place-items-center rounded-full text-text-2 shadow-card transition hover:text-text"
      >
        <Icon name="clock" size={17} />
      </button>
      {open && (
        <div role="dialog" aria-label="Recent incidents" className="absolute right-0 top-full z-40 mt-2 w-80 rounded-inner bg-surface p-4 shadow-float">
          <div className="mb-2 text-[13px] font-medium text-text">Resolved in the last 14 days</div>
          <ul className="space-y-3">
            {recent.map((e) => {
              const last = latestUpdate(e);
              return (
                <li key={e.incident.id} className="rounded-[14px] bg-surface-2 px-3.5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] text-text">{e.incident.title}</span>
                    <span className="shrink-0 rounded-full bg-sage-100 px-2 py-0.5 text-[11px] font-medium text-sage-700">Resolved</span>
                  </div>
                  <div className="mt-1 text-[12px] text-muted">
                    {date(e.incident.started_at, true)} → {date(e.incident.resolved_at, true)}
                  </div>
                  {last?.message && <p className="mt-1 text-[12px] leading-relaxed text-text-2">{last.message}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
