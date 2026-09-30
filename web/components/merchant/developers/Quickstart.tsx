"use client";

import Link from "next/link";
import type { List } from "@/lib/api";
import { API_URL } from "@/lib/api";
import { useApi } from "@/lib/merchant/hooks";
import type { ApiKey, Price } from "@/lib/merchant/types";
import { Card, CardHeader, Chip, Skeleton } from "@/components/ui";
import { useMerchant } from "../context";
import { Help } from "../common";
import { Snippet } from "./shared";

/** Copy-paste curl snippets against the local API, using the org's active secret key for this mode. */
export function Quickstart({ keys, keysLoading }: { keys: ApiKey[] | undefined; keysLoading: boolean }) {
  const { live, can } = useMerchant();
  const prices = useApi<List<Price>>(can("products.read") ? "/v1/prices?limit=1" : null);
  const active = keys?.find((k) => k.type === "secret" && !k.revoked_at && k.livemode === live);
  const priceId = prices.data?.data[0]?.id ?? "price_…";
  const base = API_URL;
  const auth = `  -H "Authorization: Bearer $SECRET_KEY"`;
  const json = `  -H "Content-Type: application/json"`;

  const snippets = [
    {
      title: "1 · Create a customer",
      code: `curl -X POST ${base}/v1/customers \\\n${auth} \\\n${json} \\\n  -H "Idempotency-Key: $(uuidgen)" \\\n  -d '{"email":"jane@example.com","name":"Jane Doe","country":"US"}'`,
    },
    {
      title: "2 · Create a checkout session",
      code: `curl -X POST ${base}/v1/checkout/sessions \\\n${auth} \\\n${json} \\\n  -H "Idempotency-Key: $(uuidgen)" \\\n  -d '{"mode":"payment","line_items":[{"price_id":"${priceId}","quantity":1}],"customer_email":"jane@example.com"}'`,
    },
    {
      title: "3 · List recent payments",
      code: `curl "${base}/v1/payments?limit=5" \\\n${auth}`,
    },
    {
      title: "4 · Send a usage event",
      code: `curl -X POST ${base}/v1/usage_events \\\n${auth} \\\n${json} \\\n  -d '{"customer":"cus_…","event_name":"api_calls","quantity":1,"idempotency_key":"call-0001"}'`,
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Quickstart"
        subtitle={`Make your first requests against ${base} in ${live ? "live" : "test"} mode`}
        action={<Chip tone={live ? "ink" : "lemon"}>{live ? "Live" : "Test mode"}</Chip>}
      />
      <div className="mb-4 rounded-inner sage-gradient p-4">
        <div className="text-[12.5px] text-text-2">Your secret key</div>
        {keysLoading && !keys ? (
          <Skeleton className="mt-2 h-7 w-56" />
        ) : active ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="font-mono text-[15px] text-text">{active.display_key}</code>
            <span className="text-[12.5px] text-muted">· {active.name}</span>
          </div>
        ) : (
          <div className="mt-1 text-[13.5px] text-text">
            No active {live ? "live" : "test"} secret key yet.{" "}
            {can("developers.write") && <Link href="/developers/api-keys?new=1" className="underline underline-offset-4">Create one</Link>}
          </div>
        )}
        <p className="mt-2 text-[12.5px] text-text-2">
          Full secrets are only shown once, when the key is created. Export it as <code className="font-mono">$SECRET_KEY</code> in your shell — the snippets below read it from there:
        </p>
        <code className="mt-2 block break-all rounded-[12px] bg-white/70 px-3 py-2 font-mono text-[12px] text-text-2">export SECRET_KEY=&quot;{active ? active.display_key.split("…")[0] : live ? "sk_live_" : "sk_test_"}…&quot;</code>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {snippets.map((s) => <Snippet key={s.title} title={s.title} code={s.code} className="min-w-0" />)}
      </div>
      <div className="mt-4">
        <Help>
          Every POST accepts an <code className="font-mono">Idempotency-Key</code> header so retries never double-charge. The full API description is at{" "}
          <a href={`${base}/openapi/v1.json`} target="_blank" rel="noreferrer" className="font-mono underline underline-offset-4">{base}/openapi/v1.json</a>.
        </Help>
      </div>
    </Card>
  );
}
