"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { List } from "@/lib/api";
import { useApi } from "@/lib/merchant/hooks";
import type { WebhookEndpoint } from "@/lib/merchant/types";
import { Button, Card, CardHeader, Empty, PageHeader, cx } from "@/components/ui";
import { relative } from "@/lib/format";
import { useMerchant } from "@/components/merchant/context";
import { ListSkeleton, Loaded, NoAccess } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { EndpointDetail } from "@/components/merchant/developers/EndpointDetail";
import { WebhookFormModal } from "@/components/merchant/developers/WebhookFormModal";
import { DevNav, EndpointStatus } from "@/components/merchant/developers/shared";
import { parseEvents } from "@/components/merchant/developers/EventFilterPicker";

export default function WebhooksPage() {
  const { can, live } = useMerchant();
  const router = useRouter();
  const params = useSearchParams();
  const allowed = can("developers.read");
  const canWrite = can("developers.write");
  const list = useApi<List<WebhookEndpoint>>(allowed ? "/v1/webhook_endpoints" : null);
  const [creating, setCreating] = useState(false);
  const selectedId = params.get("endpoint");

  if (!allowed) return <NoAccess what="webhooks" />;

  const endpoints = list.data?.data ?? [];
  const selected = endpoints.find((e) => e.id === selectedId) ?? endpoints.find((e) => e.status !== "disabled") ?? endpoints[0];
  const select = (id: string) => router.replace(`/developers/webhooks?endpoint=${id}`, { scroll: false });

  return (
    <>
      <PageHeader
        title="Webhooks"
        subtitle={`Endpoints that receive ${live ? "live" : "test"}-mode events as they happen, signed and retried with backoff.`}
        actions={canWrite && <Button icon={<Icon name="plus" size={16} />} onClick={() => setCreating(true)}>Add endpoint</Button>}
      />
      <DevNav current="/developers/webhooks" />
      <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<Card><ListSkeleton rows={3} /></Card>}>
        {() =>
          endpoints.length === 0 ? (
            <Card>
              <Empty title="No webhook endpoints yet" icon={<Icon name="hook" />} action={canWrite ? <Button onClick={() => setCreating(true)}>Add endpoint</Button> : undefined}>
                Add a URL on your server and we&apos;ll POST a signed JSON event to it whenever a payment succeeds, a subscription renews, a payout lands and more.
              </Empty>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <Card>
                <CardHeader title="Endpoints" subtitle={`${endpoints.length} in ${live ? "live" : "test"} mode`} />
                <ul className="space-y-2">
                  {endpoints.map((e) => {
                    const ev = parseEvents(e.enabled_events_csv);
                    const active = selected?.id === e.id;
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => select(e.id)}
                          aria-current={active ? "true" : undefined}
                          className={cx("w-full rounded-inner px-4 py-3 text-left transition", active ? "bg-ink text-white" : "bg-surface-2 hover:bg-surface-3")}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className={cx("min-w-0 break-all font-mono text-[12.5px]", active ? "text-white" : "text-text")}>{e.url}</span>
                            <EndpointStatus status={e.status} />
                          </div>
                          <div className={cx("mt-1 text-[12px]", active ? "text-white/70" : "text-muted")}>
                            {ev.includes("*") ? "All events" : `${ev.length} event pattern${ev.length === 1 ? "" : "s"}`}
                            {" · "}
                            {e.last_success_at ? `last success ${relative(e.last_success_at)}` : e.last_failure_at ? `last failure ${relative(e.last_failure_at)}` : "no deliveries yet"}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
              {selected && <EndpointDetail key={selected.id} endpoint={selected} onChanged={list.reload} />}
            </div>
          )
        }
      </Loaded>
      {creating && <WebhookFormModal onClose={() => setCreating(false)} onSaved={(id) => { list.reload(); select(id); }} />}
    </>
  );
}
