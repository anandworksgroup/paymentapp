"use client";

import { API_URL, ApiError, session } from "@/lib/api";

/**
 * Multipart upload with the same credentials, idempotency key and error shape as `api()` (which only
 * sends JSON). The server sniffs the content, so the browser's declared type is irrelevant.
 */
export async function uploadFile<T>(path: string, form: FormData): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", "Idempotency-Key": crypto.randomUUID() };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (session.orgId) headers["X-Org-Id"] = session.orgId;
  if (session.live) headers["X-Livemode"] = "true";
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method: "POST", headers, body: form });
  } catch {
    throw new ApiError(0, "network_error", "Can't reach the server. Check your connection and try again.");
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; request_id?: string; details?: unknown } } | undefined)?.error;
    if (res.status === 401) window.dispatchEvent(new CustomEvent("pa:unauthorized"));
    throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `Upload failed (${res.status})`, err?.request_id, err?.details);
  }
  return data as T;
}

/** Absolute URL for a path the API returns (signed download links are relative). */
export const apiUrl = (path: string) => (/^https?:\/\//.test(path) ? path : `${API_URL}${path}`);
