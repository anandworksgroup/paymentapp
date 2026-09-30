"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Chip, PageHeader, Stat, StatusChip } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { adminApi, type Query } from "@/components/admin/data";
import { Loadable, Mono, Num, PageSkeleton } from "@/components/admin/kit";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import type { SystemHealth } from "@/components/admin/types";

const REFRESH_MS = 30_000;

export default function HealthPage() {
  return (
    <Guard perm="admin.overview">
      <Health />
    </Guard>
  );
}

/** Like useAdminQuery, but also records when the last successful response arrived. */
function useHealth(): Query<SystemHealth> & { updatedAt: Date | null } {
  const [nonce, setNonce] = useState(0);
  const [res, setRes] = useState<{ nonce: number; data?: SystemHealth; error?: unknown; at: Date | null }>({ nonce: -1, at: null });
  useEffect(() => {
    let alive = true;
    adminApi<SystemHealth>("/system_health").then(
      (data) => alive && setRes({ nonce, data, at: new Date() }),
      (error) => alive && setRes((r) => ({ ...r, nonce, error })),
    );
    return () => {
      alive = false;
    };
  }, [nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data: res.data, error: res.nonce === nonce ? res.error : undefined, loading: res.nonce !== nonce, reload, updatedAt: res.at };
}

function Health() {
  const router = useRouter();
  const { can } = useAdmin();
  const q = useHealth();
  const reload = q.reload;

  useEffect(() => {
    const t = setInterval(reload, REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);

  return (
    <>
      <PageHeader
        eyebrow="Operations · live status"
        title="System health"
        subtitle="API traffic, background queues and provider state. Refreshes every 30 seconds."
        actions={
          <>
            <span className="text-[12.5px] text-muted">{q.updatedAt ? `Updated ${q.updatedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}` : "Loading…"}</span>
            <Button variant="soft" size="sm" onClick={reload} loading={q.loading && !!q.data}>
              Refresh
            </Button>
          </>
        }
      />
      <Loadable q={q} skeleton={<PageSkeleton />}>
        {(h) => {
          const err = h.api.error_rate_pct;
          const dbShort = h.database.split(".").pop() ?? h.database;
          return (
            <div className="space-y-5">
              <Card>
                <CardHeader title="API" subtitle="Requests handled in the last hour. Errors are responses with a 5xx status." />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat label="Requests (last hour)">
                    <Num value={h.api.requests_last_hour} />
                  </Stat>
                  <Stat label="Error rate" chip={err === 0 ? <Chip tone="sage">Normal</Chip> : err < 1 ? <Chip tone="lemon">Elevated</Chip> : <Chip tone="rose">High</Chip>}>
                    <Num value={err} suffix="%" />
                  </Stat>
                  <Stat label="Latency p50">
                    <Num value={h.api.p50_ms} suffix="ms" />
                  </Stat>
                  <Stat label="Latency p95" chip={h.api.p95_ms > 1000 ? <Chip tone="peach">Slow</Chip> : undefined}>
                    <Num value={h.api.p95_ms} suffix="ms" />
                  </Stat>
                </div>
              </Card>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Background queues" subtitle="Outbox events waiting to be processed and webhook deliveries to merchants." />
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label="Outbox backlog" chip={h.outbox.backlog > 0 ? <Chip tone="lemon-soft">Draining</Chip> : <Chip tone="sage">Clear</Chip>}>
                      <Num value={h.outbox.backlog} />
                    </Stat>
                    <Stat label="Outbox with errors" chip={h.outbox.failed > 0 ? <Chip tone="peach">Needs attention</Chip> : undefined}>
                      <Num value={h.outbox.failed} />
                    </Stat>
                    <Stat label="Webhooks pending" chip={h.webhooks.pending > 0 ? <Chip tone="lemon-soft">Retrying</Chip> : <Chip tone="sage">Clear</Chip>}>
                      <Num value={h.webhooks.pending} />
                    </Stat>
                    <Stat label="Webhooks dead" chip={h.webhooks.dead > 0 ? <Chip tone="rose">Gave up</Chip> : undefined}>
                      <Num value={h.webhooks.dead} />
                    </Stat>
                  </div>
                </Card>

                <Card>
                  <CardHeader title="Money integrity" subtitle="Open reconciliation exceptions between platform and provider records." />
                  <div className="grid grid-cols-2 gap-3">
                    <Stat
                      label="Open recon exceptions"
                      chip={h.ledger_exceptions > 0 ? <Chip tone="peach">Review</Chip> : <Chip tone="sage">All matched</Chip>}
                      onClick={can("admin.recon.read") ? () => router.push("/admin/reconciliation") : undefined}
                    >
                      <Num value={h.ledger_exceptions} />
                    </Stat>
                    <Stat label="Database">
                      <span title={h.database} className="numeral text-[26px] font-light leading-none text-text">
                        {dbShort}
                      </span>
                      <div className="mt-1">
                        <Mono className="text-muted">{h.database}</Mono>
                      </div>
                    </Stat>
                  </div>
                </Card>
              </div>

              <Card>
                <CardHeader
                  title="Payment providers"
                  subtitle="Current health state as seen by the router."
                  action={
                    <Button size="sm" variant="soft" onClick={() => router.push("/admin/providers")}>
                      Providers
                    </Button>
                  }
                />
                {h.providers.length === 0 ? (
                  <p className="text-[13px] text-muted">No providers configured.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {h.providers.map((p) => (
                      <li key={p.id}>
                        <Link href="/admin/providers" className="inline-flex items-center gap-2 rounded-full bg-surface-2 py-1 pl-3.5 pr-1 text-[13px] text-text hover:bg-surface-3">
                          <Mono className="text-text">{p.id}</Mono>
                          {p.enabled ? <StatusChip status={p.health_state} /> : <StatusChip status="disabled" />}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          );
        }}
      </Loadable>
    </>
  );
}
