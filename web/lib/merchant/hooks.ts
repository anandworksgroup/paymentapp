"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type List } from "@/lib/api";

type LoadState<T> = { key: string | null; path: string | null; data?: T; error?: unknown };

/**
 * Loads a GET endpoint. `path = null` skips the request. Stale data for the same path stays visible
 * while a reload is in flight, so refreshing after an action never flashes a skeleton.
 */
export function useApi<T>(path: string | null, opts: { noOrg?: boolean; anonymous?: boolean } = {}) {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<LoadState<T>>({ key: null, path: null });
  const key = path ? `${path}#${nonce}` : null;
  const { noOrg, anonymous } = opts;

  useEffect(() => {
    if (!key || !path) return;
    let cancelled = false;
    api<T>(path, { noOrg, anonymous }).then(
      (data) => !cancelled && setState({ key, path, data }),
      (error) => !cancelled && setState((s) => ({ key, path, error, data: s.path === path ? s.data : undefined })),
    );
    return () => {
      cancelled = true;
    };
  }, [key, path, noOrg, anonymous]);

  const samePath = state.path === path;
  const data = samePath ? state.data : undefined;
  const error = samePath && state.key === key ? state.error : undefined;
  const loading = key !== null && state.key !== key;
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((updater: (d: T | undefined) => T | undefined) => setState((s) => ({ ...s, data: updater(s.data) })), []);
  return { data, error, loading, reload, setData };
}

/**
 * Cursor-paginated list (`?limit=&starting_after=`). Keeps a stack of cursors so Previous works
 * without the API needing ending_before bookkeeping.
 */
export function useCursorList<T extends { id: string }>(basePath: string | null, limit = 25) {
  const [cursors, setCursors] = useState<string[]>([]);
  const [prevBase, setPrevBase] = useState(basePath);
  if (prevBase !== basePath) {
    // Filters changed: start again from the first page.
    setPrevBase(basePath);
    setCursors([]);
  }
  const after = cursors[cursors.length - 1];
  const path = basePath ? `${basePath}${basePath.includes("?") ? "&" : "?"}limit=${limit}${after ? `&starting_after=${encodeURIComponent(after)}` : ""}` : null;
  const res = useApi<List<T>>(path);
  const rows = res.data?.data ?? [];
  return {
    ...res,
    rows,
    page: cursors.length + 1,
    hasMore: !!res.data?.has_more,
    hasPrev: cursors.length > 0,
    next: () => rows.length && setCursors((c) => [...c, rows[rows.length - 1].id]),
    prev: () => setCursors((c) => c.slice(0, -1)),
  };
}

/** Runs a mutation with a busy flag and captured error. Returns the result or undefined on failure. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      if (mounted.current) setError(e);
      return undefined;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

/** Debounces a fast-changing value (search boxes). */
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Builds a query string from non-empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
