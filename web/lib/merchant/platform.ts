"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api, type List } from "@/lib/api";

// ───────────────────────── Feature flags (§119) ─────────────────────────

export type Features = Record<string, boolean>;

/**
 * Flags are fetched once per organization per browser session and shared by every consumer (sidebar,
 * command palette, header). The server still enforces every flag; this only hides entry points that
 * would lead to a "not available" page.
 */
const featureStore = new Map<string, Features | "error">();
const featureInflight = new Set<string>();
const featureListeners = new Set<() => void>();
const storageKey = (orgId: string) => `pa.features.${orgId}`;

function notify() {
  featureListeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  featureListeners.add(listener);
  return () => {
    featureListeners.delete(listener);
  };
}

function fromStorage(orgId: string): Features | undefined {
  try {
    const raw = window.sessionStorage.getItem(storageKey(orgId));
    return raw ? (JSON.parse(raw) as Features) : undefined;
  } catch {
    return undefined;
  }
}

function ensureFeatures(orgId: string) {
  if (featureStore.has(orgId) || featureInflight.has(orgId)) return;
  const stored = fromStorage(orgId);
  if (stored) {
    featureStore.set(orgId, stored);
    notify();
    return;
  }
  featureInflight.add(orgId);
  api<{ features: Features }>("/v1/features").then(
    (r) => {
      featureStore.set(orgId, r.features ?? {});
      try {
        window.sessionStorage.setItem(storageKey(orgId), JSON.stringify(r.features ?? {}));
      } catch {
        /* storage unavailable — the in-memory copy lasts for this tab */
      }
    },
    // If flags can't be read, show everything: the server still refuses anything that isn't enabled.
    () => featureStore.set(orgId, "error"),
  ).finally(() => {
    featureInflight.delete(orgId);
    notify();
  });
}

/**
 * `on(flag)` is true when the flag is enabled, when the flag is unknown to the server (unknown flags
 * don't gate anything) or when the flags couldn't be loaded. While the first load is in flight, flagged
 * items stay hidden so they never flash in and then disappear.
 */
export function useFeatures(orgId: string | null | undefined) {
  const snap = useSyncExternalStore(subscribe, () => (orgId ? featureStore.get(orgId) : undefined), () => undefined);
  useEffect(() => {
    if (orgId) ensureFeatures(orgId);
  }, [orgId]);
  const loaded = snap !== undefined;
  const features = snap && snap !== "error" ? snap : null;
  const on = useCallback(
    (flag?: string) => {
      if (!flag) return true;
      if (snap === undefined) return false;
      if (snap === "error") return true;
      return snap[flag] ?? true;
    },
    [snap],
  );
  return { features, loaded, on };
}

// ───────────────────────── Incidents (§111) ─────────────────────────

export type IncidentUpdate = { status: string; message: string; created_at: string };
export type Incident = {
  id: string;
  object: "incident";
  title: string;
  severity: "minor" | "major" | "critical" | string;
  status: "investigating" | "identified" | "monitoring" | "resolved" | string;
  affected_services_csv: string;
  customer_impact: string;
  started_at: string;
  resolved_at: string | null;
  created_at: string;
};
export type IncidentEntry = { incident: Incident; updates: IncidentUpdate[] };

/** Latest public update of an incident (updates arrive oldest first). */
export function latestUpdate(e: IncidentEntry): IncidentUpdate | undefined {
  return e.updates[e.updates.length - 1];
}

/**
 * Platform incidents: unresolved ones plus those resolved in the last 14 days. Polled every minute while
 * the tab is visible (and again when it becomes visible). Failures keep the last good answer.
 */
export function useIncidents(intervalMs = 60_000) {
  const [data, setData] = useState<IncidentEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<List<IncidentEntry>>("/v1/incidents", { noOrg: true }).then(
        (r) => alive && setData(r.data),
        () => {
          /* status is best-effort; never interrupt the dashboard for it */
        },
      );
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, intervalMs);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
  const all = data ?? [];
  return {
    active: all.filter((e) => e.incident.status !== "resolved"),
    recent: all.filter((e) => e.incident.status === "resolved"),
    loaded: data !== null,
  };
}
