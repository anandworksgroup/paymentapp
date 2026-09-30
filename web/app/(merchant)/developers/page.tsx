"use client";

import Link from "next/link";
import type { List } from "@/lib/api";
import { API_URL } from "@/lib/api";
import { useApi } from "@/lib/merchant/hooks";
import type { ApiKey, WebhookEndpoint } from "@/lib/merchant/types";
import { Card, CardHeader, Chip, ErrorNote, PageHeader, Skeleton } from "@/components/ui";
import { titleCase } from "@/lib/format";
import { useMerchant } from "@/components/merchant/context";
import { CopyButton, Help, NoAccess } from "@/components/merchant/common";
import { useMeta } from "@/components/merchant/useMeta";
import { Icon } from "@/components/merchant/icons";
import { Quickstart } from "@/components/merchant/developers/Quickstart";
import { DevNav } from "@/components/merchant/developers/shared";

export default function DevelopersPage() {
  const { can, live } = useMerchant();
  const allowed = can("developers.read");
  const keys = useApi<List<ApiKey>>(allowed ? "/v1/api_keys" : null);
  const hooks = useApi<List<WebhookEndpoint>>(allowed ? "/v1/webhook_endpoints" : null);
  const meta = useMeta();

  if (!allowed) return <NoAccess what="developer settings" />;
  const modeKeys = keys.data?.data.filter((k) => k.livemode === live && !k.revoked_at) ?? [];
  const failing = hooks.data?.data.filter((h) => h.status === "failing").length ?? 0;

  const cards = [
    { href: "/developers/api-keys", icon: "key", title: "API keys", body: keys.data ? `${modeKeys.length} active ${live ? "live" : "test"} key${modeKeys.length === 1 ? "" : "s"}` : "Secret, restricted and publishable keys" },
    { href: "/developers/webhooks", icon: "hook", title: "Webhooks", body: hooks.data ? `${hooks.data.data.length} endpoint${hooks.data.data.length === 1 ? "" : "s"}${failing ? ` · ${failing} failing` : ""}` : "Get notified when things happen" },
    { href: "/developers/events", icon: "bolt", title: "Events", body: "Every event, its payload and deliveries" },
    { href: "/developers/logs", icon: "list", title: "Request logs", body: "Recent API requests with status and latency" },
  ];

  return (
    <>
      <PageHeader title="Developers" subtitle="Keys, webhooks, events and logs for building on the platform." />
      <DevNav current="/developers" />

      <section aria-label="Developer tools" className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="card flex items-start gap-3 p-5 transition hover:shadow-float">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full sage-gradient text-sage-700"><Icon name={c.icon} size={18} /></span>
            <span className="min-w-0">
              <span className="block text-[15px] text-text">{c.title}</span>
              <span className="mt-0.5 block text-[12.5px] text-muted">{c.body}</span>
            </span>
          </Link>
        ))}
      </section>

      {keys.error ? <div className="mb-5" aria-live="assertive"><ErrorNote error={keys.error} /></div> : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Quickstart keys={keys.data?.data} keysLoading={keys.loading} />
        <div className="space-y-5">
          <Card>
            <CardHeader title="Test cards" subtitle="Use in test mode with any future expiry and any CVC" />
            {meta ? (
              <ul className="space-y-1.5">
                {meta.test_cards.map((c) => (
                  <li key={c.number} className="flex flex-wrap items-center gap-2 rounded-[14px] bg-surface-2 px-3 py-2">
                    <code className="font-mono text-[12.5px] text-text">{c.number.replace(/(\d{4})(?=\d)/g, "$1 ")}</code>
                    <span className="text-[12px] text-muted">{titleCase(c.brand)} · {c.country}</span>
                    <Chip tone={c.behavior === "success" ? "sage" : c.behavior.includes("3ds") || c.behavior.includes("action") ? "lemon-soft" : "peach"} className="ml-auto">{titleCase(c.behavior)}</Chip>
                    <CopyButton value={c.number} label="Copy" className="h-6 px-2" />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
            )}
          </Card>
          <Card>
            <CardHeader title="Test UPI" subtitle="Virtual payment addresses for UPI checkouts" />
            {meta ? (
              <ul className="space-y-1.5">
                {Object.entries(meta.test_upi).map(([vpa, behavior]) => (
                  <li key={vpa} className="flex flex-wrap items-center gap-2 rounded-[14px] bg-surface-2 px-3 py-2">
                    <code className="font-mono text-[12.5px] text-text">{vpa}</code>
                    <Chip tone={behavior === "success" ? "sage" : behavior.includes("async") ? "lemon-soft" : "peach"} className="ml-auto">{titleCase(behavior)}</Chip>
                    <CopyButton value={vpa} label="Copy" className="h-6 px-2" />
                  </li>
                ))}
              </ul>
            ) : (
              <Skeleton className="h-24" />
            )}
          </Card>
          <Card>
            <CardHeader title="API reference" />
            <Help>
              The OpenAPI description lists every route and payload. Import it into your HTTP client or generate an SDK from it.
            </Help>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a href={`${API_URL}/openapi/v1.json`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-white hover:bg-ink-2">
                <Icon name="external" size={15} /> Open OpenAPI JSON
              </a>
              <CopyButton value={`${API_URL}/openapi/v1.json`} label="Copy URL" />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
