"use client";

import { useRouter } from "next/navigation";
import { Amount, Card, Chip, PageHeader, PillChart, Stat, StatusChip, Button } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { useAdminQuery } from "@/components/admin/data";
import { Loadable, Num, PageSkeleton } from "@/components/admin/kit";
import { ActiveIncidentsCard } from "@/components/admin/ops";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import type { Overview } from "@/components/admin/types";

export default function OverviewPage() {
  return (
    <Guard perm="admin.overview">
      <OverviewBody />
    </Guard>
  );
}

function OverviewBody() {
  const router = useRouter();
  const { can, me } = useAdmin();
  const q = useAdminQuery<Overview>("/overview");
  const aml = can("admin.aml.read");

  return (
    <>
      <PageHeader
        eyebrow="Platform overview · last 24 hours"
        title={`Good to see you, ${me?.user.name.split(" ")[0] ?? ""}`}
        subtitle="Volumes, review queues and platform health. Counts link to the queue behind them."
        actions={
          <Button variant="soft" size="sm" onClick={q.reload} loading={q.loading && !!q.data}>
            Refresh
          </Button>
        }
      />
      <Loadable q={q} skeleton={<PageSkeleton />}>
        {(o) => {
          const queue = [
            aml && { label: "AML", value: o.aml_alerts_open },
            aml && { label: "Sanctions", value: o.sanctions_alerts_open },
            aml && { label: "Cases", value: o.open_cases },
            { label: "KYC", value: o.pending_kyc },
            { label: "KYB", value: o.pending_kyb },
            { label: "Holds", value: o.transfers_on_hold + o.payouts_on_hold },
            { label: "Approvals", value: o.pending_approvals },
            { label: "Recon", value: o.recon_exceptions_open },
          ].filter(Boolean) as { label: string; value: number }[];
          const busiest = queue.reduce((m, x, i) => (x.value > queue[m].value ? i : m), 0);
          return (
            <div className="space-y-5">
              <ActiveIncidentsCard />
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                <Card>
                  <CardHeader title="Money moved" subtitle="Converted to USD at reference rates for comparison only." />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Stat label="Payment volume" onClick={() => router.push("/admin/transactions?tab=payments")}>
                      <Amount minor={o.daily_payment_volume_usd} currency="USD" size="md" />
                    </Stat>
                    <Stat label="Wallet volume (completed)" onClick={() => router.push("/admin/transactions")}>
                      <Amount minor={o.daily_wallet_volume_usd} currency="USD" size="md" />
                    </Stat>
                    <Stat label="Cross-border volume" onClick={() => router.push("/admin/money-movement")}>
                      <Amount minor={o.cross_border_volume_usd} currency="USD" size="md" />
                    </Stat>
                    <Stat
                      label="Payment success rate"
                      chip={<Chip tone={o.payment_success_rate >= 95 ? "sage" : o.payment_success_rate >= 85 ? "lemon" : "peach"}>{o.failed_transactions} failed</Chip>}
                    >
                      <Num value={o.payment_success_rate} suffix="%" />
                    </Stat>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <Stat label="Transactions">
                      <Num value={o.daily_transactions} className="text-[24px]" />
                    </Stat>
                    <Stat label="Active users (30d)">
                      <Num value={o.active_users} className="text-[24px]" />
                    </Stat>
                    <Stat label="Approved merchants" onClick={() => router.push("/admin/merchants")}>
                      <Num value={o.active_merchants} className="text-[24px]" />
                    </Stat>
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Review queues" subtitle="Items waiting for a person. The peach bar is the largest queue." />
                  <PillChart data={queue} highlight={busiest} height={230} format={(v) => `${v} open`} />
                </Card>
              </div>

              {aml && (
                <Card>
                  <CardHeader title="Financial crime" subtitle="Signals for review. An alert is not a finding of wrongdoing." />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Stat label="Open AML alerts" chip={o.aml_alerts_open ? <Chip tone="peach">Review</Chip> : <Chip tone="sage">Clear</Chip>} onClick={() => router.push("/admin/alerts")}>
                      <Num value={o.aml_alerts_open} />
                    </Stat>
                    <Stat label="Open screening alerts" chip={o.sanctions_alerts_open ? <Chip tone="rose">Priority</Chip> : undefined} onClick={() => router.push("/admin/alerts?type=sanctions")}>
                      <Num value={o.sanctions_alerts_open} />
                    </Stat>
                    <Stat label="Open cases" chip={o.high_priority_cases ? <Chip tone="lemon">{o.high_priority_cases} high priority</Chip> : undefined} onClick={() => router.push("/admin/cases")}>
                      <Num value={o.open_cases} />
                    </Stat>
                    <Stat label="Pending approvals" chip={<Chip tone="neutral">Four-eyes</Chip>} onClick={() => router.push("/admin/approvals")}>
                      <Num value={o.pending_approvals} />
                    </Stat>
                  </div>
                </Card>
              )}

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Onboarding & holds" />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Stat label="KYC reviews pending" onClick={() => router.push("/admin/users?kyc_status=REVIEW")}>
                      <Num value={o.pending_kyc} />
                    </Stat>
                    <Stat label="KYB reviews pending" onClick={() => router.push("/admin/merchants?status=UNDER_REVIEW")}>
                      <Num value={o.pending_kyb} />
                    </Stat>
                    <Stat label="Transfers on hold" onClick={() => router.push("/admin/transactions?status=HELD")}>
                      <Num value={o.transfers_on_hold} />
                    </Stat>
                    <Stat label="Payouts on hold" onClick={() => router.push("/admin/payouts?status=ON_HOLD")}>
                      <Num value={o.payouts_on_hold} />
                    </Stat>
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Platform health" action={<Button size="sm" variant="soft" onClick={() => router.push("/admin/health")}>System health</Button>} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Stat label="Recon exceptions" onClick={can("admin.recon.read") ? () => router.push("/admin/reconciliation") : undefined}>
                      <Num value={o.recon_exceptions_open} />
                    </Stat>
                    <Stat label="Webhook backlog">
                      <Num value={o.webhook_backlog} />
                    </Stat>
                    <Stat label="Outbox backlog">
                      <Num value={o.outbox_backlog} />
                    </Stat>
                  </div>
                  <div className="mt-4">
                    <div className="mb-2 text-[12.5px] text-muted">Payment providers</div>
                    <ul className="flex flex-wrap gap-2">
                      {o.providers.map((p) => (
                        <li key={p.id}>
                          <button onClick={() => router.push("/admin/providers")} className="inline-flex items-center gap-2 rounded-full bg-surface-2 py-1 pl-3.5 pr-1 text-[13px] text-text hover:bg-surface-3">
                            {p.name}
                            {!p.enabled ? <StatusChip status="disabled" /> : <StatusChip status={p.health_state} />}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Card>
              </div>
            </div>
          );
        }}
      </Loadable>
    </>
  );
}
