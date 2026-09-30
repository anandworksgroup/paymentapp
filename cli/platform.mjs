#!/usr/bin/env node
/**
 * `platform` developer CLI (URS §271-§273). Zero dependencies, Node 22+.
 *
 *   platform login --key sk_test_...            store a key in ~/.paymentapp/config.json
 *   platform products [create --name "Pro"]
 *   platform prices create --product prod_... --amount 2000 --currency USD [--interval month]
 *   platform checkout create --price price_... [--quantity 1] [--mode payment|subscription]
 *   platform payments [--limit 10]
 *   platform logs [--status 500]
 *   platform events [--type payment.*]
 *   platform trigger payment.succeeded           run a test checkout with card 4242 end-to-end
 *   platform listen --forward http://localhost:4242/webhooks
 *
 * `listen` polls the test-mode event stream and forwards each new event to a local URL, signed with a
 * per-session secret it prints at start, so local development needs no public tunnel.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".paymentapp");
const CONFIG = join(CONFIG_DIR, "config.json");
const [, , cmd, sub, ...rest] = process.argv;
const args = parseArgs([sub, ...rest].filter(Boolean));

function parseArgs(list) {
  const out = { _: [] };
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.startsWith("--")) out[a.slice(2)] = list[i + 1] && !list[i + 1].startsWith("--") ? list[++i] : true;
    else out._.push(a);
  }
  return out;
}

function config() {
  try {
    return JSON.parse(readFileSync(CONFIG, "utf8"));
  } catch {
    return {};
  }
}

const baseUrl = () => process.env.PLATFORM_API_URL ?? config().baseUrl ?? "http://localhost:5080";

async function api(method, path, body) {
  const key = process.env.PLATFORM_API_KEY ?? config().apiKey;
  if (!key) fail("Not logged in. Run: platform login --key sk_test_...");
  const headers = { Authorization: `Bearer ${key}`, Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (method === "POST") headers["Idempotency-Key"] = randomUUID();
  const res = await fetch(baseUrl() + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) fail(`${res.status} ${data?.error?.code}: ${data?.error?.message} (${data?.error?.request_id ?? res.headers.get("request-id")})`);
  return data;
}

function fail(msg) {
  console.error(`x ${msg}`);
  process.exit(1);
}

const print = (o) => console.log(JSON.stringify(o, null, 2));
const money = (minor, cur) => `${(minor / (cur === "JPY" ? 1 : 100)).toFixed(cur === "JPY" ? 0 : 2)} ${cur}`;

const commands = {
  async login() {
    const key = args.key ?? fail("--key is required");
    if (!/^(sk|rk)_(test|live)_/.test(key)) fail("That is not a secret or restricted key.");
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG, JSON.stringify({ apiKey: key, baseUrl: args.url ?? "http://localhost:5080" }, null, 2), { mode: 0o600 });
    const bal = await api("GET", "/v1/balance");
    console.log(`Logged in (${bal.livemode ? "LIVE" : "test"} mode). Key stored in ${CONFIG}`);
  },
  async products() {
    if (sub === "create") return print(await api("POST", "/v1/products", { name: args.name ?? fail("--name required"), description: args.description }));
    const list = await api("GET", `/v1/products?limit=${args.limit ?? 20}`);
    for (const p of list.data) console.log(`${p.id}  ${p.status.padEnd(8)} ${p.name}`);
  },
  async prices() {
    if (sub !== "create") fail("usage: platform prices create --product prod_... --amount 2000 --currency USD [--interval month]");
    print(
      await api("POST", "/v1/prices", {
        product_id: args.product ?? fail("--product required"),
        unit_amount: Number(args.amount ?? fail("--amount required (minor units)")),
        currency: args.currency ?? "USD",
        type: args.interval ? "recurring" : "one_time",
        interval: args.interval,
      }),
    );
  },
  async checkout() {
    if (sub !== "create") fail("usage: platform checkout create --price price_...");
    const s = await api("POST", "/v1/checkout/sessions", {
      mode: args.mode ?? "payment",
      line_items: [{ price_id: args.price ?? fail("--price required"), quantity: Number(args.quantity ?? 1) }],
    });
    console.log(`${s.id}\n  Pay at: ${args.web ?? "http://localhost:3000"}${s.url}  (subtotal ${money(s.subtotal, s.currency)}, tax added at checkout)`);
  },
  async payments() {
    const list = await api("GET", `/v1/payments?limit=${args.limit ?? 10}`);
    for (const p of list.data) console.log(`${p.id}  ${p.status.padEnd(18)} ${money(p.amount, p.currency).padStart(14)}  ${p.customer_email ?? ""}`);
  },
  async logs() {
    const list = await api("GET", `/v1/logs?limit=${args.limit ?? 30}${args.status ? `&status=${args.status}` : ""}`);
    for (const l of list.data)
      console.log(`${l.at}  ${String(l.status).padEnd(4)} ${l.method.padEnd(6)} ${l.path}  ${l.latency_ms}ms  ${l.request_id}${l.error_code ? "  " + l.error_code : ""}`);
  },
  async events() {
    const list = await api("GET", `/v1/events?limit=${args.limit ?? 20}${args.type ? `&type=${encodeURIComponent(args.type)}` : ""}`);
    for (const e of list.data) console.log(`${e.created_at}  #${e.sequence}  ${e.type.padEnd(28)} ${e.object_id}`);
  },
  async trigger() {
    const what = sub ?? "payment.succeeded";
    if (what !== "payment.succeeded") fail("Only payment.succeeded can be triggered from the CLI today.");
    // A dedicated product keeps triggered test payments out of your real catalog.
    const existing = (await api("GET", "/v1/products?limit=100")).data.find((p) => p.name === "CLI test product");
    const product = existing ?? (await api("POST", "/v1/products", { name: "CLI test product", description: "Created by `platform trigger`" }));
    const price = await api("POST", "/v1/prices", { product_id: product.id, unit_amount: 1000, currency: "USD", type: "one_time" });
    const s = await api("POST", "/v1/checkout/sessions", { mode: "payment", line_items: [{ price_id: price.id, quantity: 1 }] });
    const json = { "Content-Type": "application/json" };
    const tok = await (await fetch(`${baseUrl()}/v1/public/sim/tokens`, { method: "POST", headers: json, body: JSON.stringify({ type: "card", number: "4242424242424242", exp_month: 12, exp_year: 2031, cvc: "123" }) })).json();
    const r = await (
      await fetch(`${baseUrl()}/v1/public/checkout/${s.id}/confirm`, {
        method: "POST",
        headers: { ...json, "Idempotency-Key": randomUUID() },
        body: JSON.stringify({ email: "cli@example.com", name: "CLI Buyer", country: "US", token: tok.id, accept_terms: true }),
      })
    ).json();
    console.log(`${r.payment} ${r.payment_status}`);
  },
  async listen() {
    const forward = args.forward ?? fail("--forward http://localhost:4242/webhooks is required");
    const secret = "whsec_cli_" + randomBytes(18).toString("base64url");
    console.log(`Ready. Forwarding test-mode events to ${forward}\nSigning secret for this session: ${secret}\n(Ctrl+C to stop)`);
    let cursor = (await api("GET", "/v1/events?limit=1")).data[0]?.sequence ?? 0;
    for (;;) {
      const page = await api("GET", "/v1/events?limit=100");
      const fresh = page.data.filter((e) => e.sequence > cursor).sort((a, b) => a.sequence - b.sequence);
      for (const e of fresh) {
        const payload = JSON.stringify({ id: e.id, object: "event", type: e.type, api_version: e.api_version, created: e.created_at, livemode: e.livemode, sequence: e.sequence, data: { object: e.data } });
        const t = Math.floor(Date.now() / 1000);
        const sig = `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;
        try {
          const res = await fetch(forward, { method: "POST", headers: { "Content-Type": "application/json", "Webhook-Id": e.id, "Webhook-Timestamp": String(t), "Webhook-Signature": sig }, body: payload });
          console.log(`${new Date().toISOString()}  --> ${e.type.padEnd(28)} [${res.status}] ${e.id}`);
        } catch (err) {
          console.log(`${new Date().toISOString()}  --> ${e.type.padEnd(28)} [error] ${err.message}`);
        }
        cursor = e.sequence;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  },
};

const run = commands[cmd];
if (!run) {
  console.log("platform <login|products|prices|checkout|payments|logs|events|trigger|listen>  (see the header of cli/platform.mjs)");
  process.exit(cmd ? 1 : 0);
}
await run();
