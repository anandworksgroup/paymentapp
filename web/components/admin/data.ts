"use client";

/**
 * Admin data access. Every admin call goes through `adminApi` → `api(path, { noOrg: true })`, which
 * never sends X-Org-Id or X-Livemode: staff act across tenants. Under /admin, lib/api keeps the
 * session in its own localStorage keys (pa.admin.*), so a merchant sign-in in another tab can't
 * replace the staff session.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api, API_URL, ApiError, session } from "@/lib/api";
import type { ListResponse, Organization, SearchResult, User, Wallet } from "./types";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function url(path: string) {
  return `${API_URL}${path.startsWith("/v1") ? path : `/v1/admin${path}`}`;
}

async function errorFrom(res: Response): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string; request_id?: string; details?: unknown } } | undefined;
  try {
    body = JSON.parse(await res.text());
  } catch {
    body = undefined;
  }
  const err = body?.error;
  return new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `Request failed (${res.status})`, err?.request_id, err?.details);
}

/** Paths starting with /v1 are used as-is; anything else is under /v1/admin. */
export function adminApi<T>(path: string, opts: { method?: Method; body?: unknown; anonymous?: boolean } = {}): Promise<T> {
  return api<T>(path.startsWith("/v1") ? path : `/v1/admin${path}`, { ...opts, noOrg: true });
}

/**
 * Authenticated file download (CSV / JSON exports). Like `download()` in lib/api but never sends the
 * org header, and it surfaces the API's error message (e.g. "Exports require a reason").
 */
export async function adminDownload(path: string, filename: string) {
  const headers: Record<string, string> = {};
  const token = session.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(url(path), { headers });
  } catch {
    throw new ApiError(0, "network_error", "Can't reach the server. Check your connection and try again.");
  }
  if (!res.ok) throw await errorFrom(res);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Tell listeners (nav badge counts) that an admin action changed server state. */
export function notifyChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("pa:admin-changed"));
}

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export type Query<T> = { data: T | undefined; error: unknown; loading: boolean; reload: () => void };

/**
 * Loads an admin resource. `path === null` means "don't load" (e.g. the role lacks the permission).
 * Previous data stays visible while the same resource reloads, so tables don't flicker after an action.
 */
export function useAdminQuery<T>(path: string | null): Query<T> {
  const [nonce, setNonce] = useState(0);
  const [res, setRes] = useState<{ path: string | null; nonce: number; data?: T; error?: unknown }>({ path: null, nonce: -1 });
  useEffect(() => {
    if (!path) return;
    let alive = true;
    adminApi<T>(path).then(
      (data) => alive && setRes({ path, nonce, data }),
      (error) => alive && setRes({ path, nonce, error }),
    );
    return () => {
      alive = false;
    };
  }, [path, nonce]);
  const current = res.path === path;
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return {
    data: current ? res.data : undefined,
    error: current && res.nonce === nonce ? res.error : undefined,
    loading: !!path && !(current && res.nonce === nonce),
    reload,
  };
}

/** Cursor paging over a `{object:"list", data, has_more}` endpoint (starting_after). */
export function usePagedList<T extends { id: string }>(basePath: string | null, limit = 25) {
  const [cursors, setCursors] = useState<string[]>([]);
  const [key, setKey] = useState(basePath);
  if (key !== basePath) {
    // Filters changed: back to the first page (state reset during render, not in an effect).
    setKey(basePath);
    setCursors([]);
  }
  const after = cursors[cursors.length - 1];
  const sep = basePath?.includes("?") ? "&" : "?";
  const path = basePath ? `${basePath}${sep}limit=${limit}${after ? `&starting_after=${after}` : ""}` : null;
  const q = useAdminQuery<ListResponse<T>>(path);
  const rows = q.data?.data ?? [];
  return {
    ...q,
    rows,
    page: cursors.length + 1,
    hasMore: !!q.data?.has_more,
    next: () => rows.length && setCursors((c) => [...c, rows[rows.length - 1].id]),
    prev: () => setCursors((c) => c.slice(0, -1)),
  };
}

// ───────────────────────── Name directory ─────────────────────────
// The API returns actor/assignee ids only. Staff screens resolve them to names from the user list
// (roles without admin.users.read just see ids). Wallet ids resolve through the search endpoint.

type DirState = { users: Map<string, User>; wallets: Map<string, Wallet | null>; orgs: Map<string, Organization>; version: number };
const dir: DirState = { users: new Map(), wallets: new Map(), orgs: new Map(), version: 0 };
const listeners = new Set<() => void>();
let usersLoading: Promise<void> | null = null;
const walletLoading = new Map<string, Promise<void>>();
/** Name/wallet lookups need admin.users.read (users list + search); other roles just see ids. */
let lookupsAllowed = false;
let orgLookupsAllowed = false;
export function setLookupAccess(users: boolean, merchants: boolean) {
  lookupsAllowed = users;
  orgLookupsAllowed = merchants;
}

function bump() {
  dir.version++;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function resetDirectory() {
  dir.users.clear();
  dir.wallets.clear();
  dir.orgs.clear();
  usersLoading = null;
  walletLoading.clear();
  bump();
}

export function loadDirectory() {
  if (usersLoading) return usersLoading;
  usersLoading = (async () => {
    if (orgLookupsAllowed) {
      try {
        const orgs = await adminApi<ListResponse<Organization>>("/merchants?limit=100");
        orgs.data.forEach((o) => dir.orgs.set(o.id, o));
      } catch {
        /* names fall back to ids */
      }
    }
    if (!lookupsAllowed) return bump();
    try {
      let after: string | undefined;
      for (let i = 0; i < 5; i++) {
        const page = await adminApi<ListResponse<User>>(`/users?limit=100${after ? `&starting_after=${after}` : ""}`);
        page.data.forEach((u) => dir.users.set(u.id, u));
        if (!page.has_more || page.data.length === 0) break;
        after = page.data[page.data.length - 1].id;
      }
    } catch {
      /* no admin.users.read: names fall back to ids */
    }
    bump();
  })();
  return usersLoading;
}

export function resolveWallet(id: string) {
  if (!lookupsAllowed || dir.wallets.has(id) || walletLoading.has(id)) return;
  const p = (async () => {
    try {
      const r = await adminApi<SearchResult>(`/search?q=${encodeURIComponent(id)}`);
      dir.wallets.set(id, r.wallets.find((w) => w.id === id) ?? null);
    } catch {
      dir.wallets.set(id, null);
    }
    bump();
  })();
  walletLoading.set(id, p);
}

export function useDirectory() {
  useSyncExternalStore(subscribe, () => dir.version, () => 0);
  return dir;
}
