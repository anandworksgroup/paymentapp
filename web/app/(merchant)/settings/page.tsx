"use client";

import Link from "next/link";
import { useApi } from "@/lib/merchant/hooks";
import type { Organization } from "@/lib/merchant/types";
import { Card, CardHeader, Chip, PageHeader, StatusChip } from "@/components/ui";
import { date, flag, money, titleCase } from "@/lib/format";
import { useMerchant } from "@/components/merchant/context";
import { DetailSkeleton, KV, Loaded, Mono, NoAccess } from "@/components/merchant/common";
import { OrgForm } from "@/components/merchant/settings/OrgForm";
import { SettingsNav } from "@/components/merchant/settings/shared";

const GO_LIVE_LABELS: Record<string, string> = { TEST: "Test mode only", READY: "Ready to go live", PRODUCTION: "Live in production" };

export default function OrganizationSettingsPage() {
  const { can, refreshMe } = useMerchant();
  const allowed = can("team.read");
  const res = useApi<Organization>(allowed ? "/v1/organization" : null);

  if (!allowed) return <NoAccess what="organization settings" />;

  return (
    <>
      <PageHeader title="Organization" subtitle="Your business profile, payout schedule and subscription retry rules." />
      <SettingsNav current="/settings" />
      <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<DetailSkeleton />}>
        {(org) => (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <OrgForm key={org.id} org={org} canEdit={can("org.manage")} onSaved={(o) => { res.setData(() => o); if (o.name !== org.name) refreshMe().catch(() => {}); }} />
            <div className="space-y-5">
              <Card className="sage-gradient">
                <div className="text-[12.5px] text-text-2">Account</div>
                <div className="mt-1 text-[24px] font-normal tracking-[-0.02em] text-text">{org.name}</div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <StatusChip status={org.status} />
                  <Chip tone={org.go_live_state === "PRODUCTION" ? "ink" : "lemon"}>{GO_LIVE_LABELS[org.go_live_state] ?? titleCase(org.go_live_state)}</Chip>
                  {org.restriction && org.restriction !== "NORMAL" && <Chip tone="peach">{titleCase(org.restriction)}</Chip>}
                </div>
                {org.go_live_state !== "PRODUCTION" && (
                  <Link href="/settings/go-live" className="mt-4 inline-flex rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-white hover:bg-ink-2">Go-live checklist</Link>
                )}
              </Card>
              <Card>
                <CardHeader title="Account facts" subtitle="Set by the platform during review" />
                <KV rows={[
                  ["Organization id", <Mono key="id">{org.id}</Mono>],
                  ["Country", <span key="c">{flag(org.country)} {org.country}</span>],
                  ["Default currency", org.default_currency],
                  ["Settlement delay", `${org.settlement_delay_days} day${org.settlement_delay_days === 1 ? "" : "s"} after payment`],
                  ["Rolling reserve", org.reserve_bps ? `${(org.reserve_bps / 100).toFixed(2)}% of each payment` : "None"],
                  ["Minimum payout", money(org.minimum_payout_minor, org.default_currency, { code: true })],
                  ["Created", date(org.created_at)],
                ]} />
                <p className="mt-4 text-[12.5px] text-muted">To change these, contact support. They depend on your business verification and risk review.</p>
              </Card>
            </div>
          </div>
        )}
      </Loaded>
    </>
  );
}
