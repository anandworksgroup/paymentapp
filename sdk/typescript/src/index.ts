/**
 * Official TypeScript SDK for the Monetization Platform API (URS §55, §168).
 *
 * Server-side only: it takes a secret or restricted key. Never ship a secret key to a browser or
 * mobile app (URS §55) — use hosted checkout or payment links there instead.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type PlatformOptions = {
  apiKey: string;
  baseUrl?: string;
  /** Retries on network errors, 409 idempotency_in_progress, 429 and 5xx. Default 2. */
  maxRetries?: number;
  timeoutMs?: number;
};

export class PlatformError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "PlatformError";
  }
}

export type List<T> = { object: "list"; data: T[]; has_more: boolean };
export type ListParams = { limit?: number; starting_after?: string; ending_before?: string } & Record<string, string | number | boolean | undefined>;
type Obj = Record<string, any>;

export class Platform {
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: PlatformOptions) {
    if (!options.apiKey?.startsWith("sk_") && !options.apiKey?.startsWith("rk_"))
      throw new Error("Use a secret (sk_) or restricted (rk_) key on the server.");
    this.baseUrl = (options.baseUrl ?? "http://localhost:5080").replace(/\/$/, "");
    this.maxRetries = options.maxRetries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /** Low-level request. POSTs always carry an Idempotency-Key, reused across retries (§20). */
  async request<T = Obj>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, opts: { idempotencyKey?: string; query?: ListParams } = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { Authorization: `Bearer ${this.options.apiKey}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method === "POST") headers["Idempotency-Key"] = opts.idempotencyKey ?? randomUUID();

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
      } catch (e) {
        clearTimeout(timer);
        if (attempt < this.maxRetries) { await sleep(backoff(attempt)); continue; }
        throw new PlatformError(0, "network_error", (e as Error).message);
      }
      clearTimeout(timer);
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      const data = text ? JSON.parse(text) : undefined;
      if (res.ok) return data as T;
      const retryable = res.status === 429 || res.status >= 500 || data?.error?.code === "idempotency_in_progress";
      if (retryable && attempt < this.maxRetries) {
        const after = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : backoff(attempt));
        continue;
      }
      throw new PlatformError(res.status, data?.error?.code ?? "http_error", data?.error?.message ?? res.statusText, data?.error?.request_id, data?.error?.details);
    }
  }

  private resource(path: string) {
    return {
      list: (params?: ListParams) => this.request<List<Obj>>("GET", path, undefined, { query: params }),
      retrieve: (id: string) => this.request("GET", `${path}/${id}`),
      create: (body: Obj, idempotencyKey?: string) => this.request("POST", path, body, { idempotencyKey }),
      update: (id: string, body: Obj) => this.request("PATCH", `${path}/${id}`, body),
    };
  }

  /** Async iterator over every page of a list endpoint. */
  async *paginate(path: string, params: ListParams = {}): AsyncGenerator<Obj> {
    let startingAfter: string | undefined;
    for (;;) {
      const page = await this.request<List<Obj>>("GET", path, undefined, { query: { ...params, starting_after: startingAfter } });
      for (const item of page.data) yield item;
      if (!page.has_more || page.data.length === 0) return;
      startingAfter = page.data[page.data.length - 1].id;
    }
  }

  readonly products = this.resource("/v1/products");
  readonly prices = {
    ...this.resource("/v1/prices"),
    /** Published prices are immutable; this creates version N+1 (§184). */
    newVersion: (id: string, body: Obj) => this.request("POST", `/v1/prices/${id}/versions`, body),
  };
  readonly customers = this.resource("/v1/customers");
  readonly coupons = this.resource("/v1/coupons");
  readonly meters = this.resource("/v1/meters");
  readonly paymentLinks = this.resource("/v1/payment_links");
  readonly checkout = { sessions: this.resource("/v1/checkout/sessions") };
  readonly payments = this.resource("/v1/payments");
  readonly refunds = this.resource("/v1/refunds");
  readonly disputes = {
    ...this.resource("/v1/disputes"),
    submitEvidence: (id: string, evidence: { type: string; text: string }[], submit = true) =>
      this.request("POST", `/v1/disputes/${id}/evidence`, { evidence, submit }),
  };
  readonly subscriptions = {
    ...this.resource("/v1/subscriptions"),
    previewChange: (id: string, price: string, quantity = 1) => this.request("POST", `/v1/subscriptions/${id}/change`, { price, quantity, preview: true }),
    change: (id: string, price: string, quantity = 1) => this.request("POST", `/v1/subscriptions/${id}/change`, { price, quantity }),
    cancel: (id: string, atPeriodEnd = true, reason?: string) => this.request("POST", `/v1/subscriptions/${id}/cancel`, { at_period_end: atPeriodEnd, reason }),
    pause: (id: string) => this.request("POST", `/v1/subscriptions/${id}/pause`),
    resume: (id: string) => this.request("POST", `/v1/subscriptions/${id}/resume`),
  };
  readonly invoices = {
    ...this.resource("/v1/invoices"),
    finalize: (id: string) => this.request("POST", `/v1/invoices/${id}/finalize`),
    pay: (id: string) => this.request("POST", `/v1/invoices/${id}/pay`),
    void: (id: string) => this.request("POST", `/v1/invoices/${id}/void`),
  };
  readonly usage = {
    /** Idempotent by idempotency_key: resending the same event never double-bills (§29). */
    record: (event: { customer: string; event_name: string; quantity: number; timestamp?: string; idempotency_key: string }) =>
      this.request("POST", "/v1/usage_events", event),
    recordBatch: (events: { customer: string; event_name: string; quantity: number; timestamp?: string; idempotency_key: string }[]) =>
      this.request("POST", "/v1/usage_events/batch", { events }),
    summary: (params?: ListParams) => this.request("GET", "/v1/usage/summary", undefined, { query: params }),
  };
  readonly credits = {
    balance: (customer: string) => this.request("GET", `/v1/credits/${customer}`),
    apply: (body: { customer: string; operation: "issue" | "consume" | "reserve" | "release" | "consume_reserved" | "expire" | "adjust"; amount: number; idempotency_key?: string; description?: string }) =>
      this.request("POST", "/v1/credits", body),
  };
  readonly balance = {
    retrieve: () => this.request("GET", "/v1/balance"),
    transactions: (params?: ListParams) => this.request<List<Obj>>("GET", "/v1/balance_transactions", undefined, { query: params }),
  };
  readonly payouts = this.resource("/v1/payouts");
  readonly entitlements = { list: (params?: ListParams) => this.request<List<Obj>>("GET", "/v1/entitlements", undefined, { query: params }) };
  readonly events = this.resource("/v1/events");
  readonly reports = {
    dashboard: (params?: ListParams) => this.request("GET", "/v1/reports/dashboard", undefined, { query: params }),
    statement: (month: string, currency: string) => this.request("GET", "/v1/statements", undefined, { query: { month, currency } }),
    tax: (params?: ListParams) => this.request("GET", "/v1/tax/summary", undefined, { query: params }),
  };
}

/**
 * Verifies a webhook (§57). Header format: `t=<unix>,v1=<hex>[,v1=<hex>]` — several v1 signatures are
 * present while a secret rotation grace period is active (§160). Rejects stale timestamps to stop replays.
 */
export function verifyWebhook(payload: string, signatureHeader: string, timestampHeader: string | null, secret: string, toleranceSeconds = 300): Obj {
  const parts = Object.groupBy(signatureHeader.split(",").map((p) => p.trim().split("=", 2) as [string, string]), ([k]) => k);
  const t = parts.t?.[0]?.[1] ?? timestampHeader;
  if (!t) throw new PlatformError(400, "invalid_signature", "Missing timestamp.");
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSeconds) throw new PlatformError(400, "stale_webhook", "Webhook timestamp outside tolerance.");
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex"));
  const ok = (parts.v1 ?? []).some(([, sig]) => {
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok) throw new PlatformError(400, "invalid_signature", "Webhook signature verification failed.");
  return JSON.parse(payload);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt: number) => Math.min(8000, 400 * 2 ** attempt) + Math.floor(Math.random() * 200);

export default Platform;
