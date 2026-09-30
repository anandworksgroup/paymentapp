"use client";

/**
 * Typed-enough client for the platform REST API. The server is authoritative for every amount,
 * status and balance; the UI only formats what it receives (URS §334).
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5080";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const KEYS = { token: "pa.session", org: "pa.org", live: "pa.live" } as const;

/**
 * The admin console and the merchant app share one origin, so each keeps its own session: signing in
 * to /admin must never replace (or reuse) a merchant session in another tab, and vice versa.
 */
function scoped(key: string) {
  const admin = typeof window !== "undefined" && window.location.pathname.startsWith("/admin");
  return admin ? key.replace(/^pa\./, "pa.admin.") : key;
}

function read(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(scoped(key));
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(scoped(key));
    else window.localStorage.setItem(scoped(key), value);
  } catch {
    /* storage unavailable (private mode) — session lasts for this tab only */
  }
}

export const session = {
  get token() {
    return read(KEYS.token);
  },
  set token(v: string | null) {
    write(KEYS.token, v);
  },
  get orgId() {
    return read(KEYS.org);
  },
  set orgId(v: string | null) {
    write(KEYS.org, v);
  },
  get live() {
    return read(KEYS.live) === "true";
  },
  set live(v: boolean) {
    write(KEYS.live, v ? "true" : "false");
  },
  clear() {
    write(KEYS.token, null);
    write(KEYS.org, null);
    write(KEYS.live, null);
  },
};

type Options = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Send without the org header (e.g. admin console, /v1/me). */
  noOrg?: boolean;
  /** Public buyer-facing calls carry no credentials at all. */
  anonymous?: boolean;
  idempotencyKey?: string;
};

// Callers usually name T; the permissive default keeps quick one-off calls terse.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function api<T = any>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (!opts.anonymous) {
    const token = session.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (!opts.noOrg && session.orgId) headers["X-Org-Id"] = session.orgId;
    if (!opts.noOrg && session.live) headers["X-Livemode"] = "true";
  }
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  // Every money-moving POST gets an idempotency key so retries can never double-charge (§20).
  if (method === "POST") headers["Idempotency-Key"] = opts.idempotencyKey ?? crypto.randomUUID();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new ApiError(0, "network_error", "Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; request_id?: string; details?: unknown } } | undefined)?.error;
    // A wrong password or MFA code during re-authentication is a failed attempt, not an expired session.
    const retryable = ["invalid_credentials", "invalid_mfa_code", "too_many_attempts"].includes(err?.code ?? "");
    if (res.status === 401 && typeof window !== "undefined" && !opts.anonymous && !retryable) {
      window.dispatchEvent(new CustomEvent("pa:unauthorized"));
    }
    throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `Request failed (${res.status})`, err?.request_id, err?.details);
  }
  return data as T;
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Download a binary/text endpoint (PDF invoices, CSV exports) with the current credentials. */
export async function download(path: string, filename: string) {
  const headers: Record<string, string> = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (session.orgId) headers["X-Org-Id"] = session.orgId;
  if (session.live) headers["X-Livemode"] = "true";
  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) throw new ApiError(res.status, "download_failed", "Download failed.");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type List<T> = { object: "list"; data: T[]; has_more?: boolean };
