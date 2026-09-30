"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { Amount, Button, Card, Chip, Empty, PageHeader, StatusChip, Table } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { adminApi, useAdminQuery } from "@/components/admin/data";
import { AuditTable } from "@/components/admin/audit-table";
import { Country, EntityLink, IdTag, KV, Loadable, Notice, Num, PageSkeleton, Panel, Person, ReadOnlyNote, ReasonDialog, SlaChip, When, humanize } from "@/components/admin/kit";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import type { Balance, MerchantDetail } from "@/components/admin/types";

export default function MerchantDetailPage() {
  return (
    <Guard perm="admin.merchants.read">
      <MerchantBody />
    </Guard>
  );
}

function MerchantBody() {
  const { id } = useParams<{ id: string }>();
  const q = useAdminQuery<MerchantDetail>(`/merchants/${id}`);
  return (
    <Loadable q={q} skeleton={<PageSkeleton />}>
      {(d) => <MerchantView d={d} reload={q.reload} />}
    </Loadable>
  );
}

function MerchantView({ d, reload }: { d: MerchantDetail; reload: () => void }) {
  const { can, guard } = useAdmin();
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const o = d.organization;
  const app = d.application;
  const pending = app?.status === "UNDER_REVIEW";
  const canDecide = can("admin.merchants.decide");
  const ownerHits = d.beneficial_owners.filter((b) => b.screening_status !== "clear");

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            Merchant · <IdTag id={o.id} full />
          </span>
        }
        title={o.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusChip status={o.status} />
            <Chip tone={o.go_live_state === "PRODUCTION" ? "ink" : "neutral"}>Go-live: {o.go_live_state.toLowerCase()}</Chip>
            {o.restriction !== "NORMAL" && <Chip tone="peach">Restricted: {o.restriction.replace(/_/g, " ").toLowerCase()}</Chip>}
            <Country code={o.country} />
          </span>
        }
        actions={
          pending &&
          (canDecide ? (
            <>
              <Button variant="danger" onClick={() => setDecision("reject")}>
                Reject
              </Button>
              <Button onClick={() => setDecision("approve")}>Approve</Button>
            </>
          ) : (
            <ReadOnlyNote>Onboarding decisions need admin.merchants.decide</ReadOnlyNote>
          ))
        }
      />
      {done && (
        <div className="mb-5">
          <Notice>{done}</Notice>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Application"
            subtitle={app ? <>Submitted <When at={app.submitted_at} /> · KYB status {app.status.replace(/_/g, " ").toLowerCase()}</> : "No application submitted yet."}
            action={app && <Chip tone={app.risk_score >= 60 ? "rose" : app.risk_score >= 30 ? "peach" : "sage"}>Risk score {app.risk_score}</Chip>}
          />
          {app ? (
            <div className="space-y-5">
              <KV
                cols={3}
                items={[
                  ["Legal name", app.legal_name],
                  ["Trading name", app.trading_name],
                  ["Registration no.", app.registration_number],
                  ["Tax number", app.tax_number],
                  ["Industry", humanize(app.industry)],
                  ["Business type", humanize(app.business_type)],
                  ["Country", <Country key="c" code={app.country} />],
                  ["Customer type", app.customer_type],
                  ["Website", app.website],
                  ["Registered address", app.registered_address],
                  ["Operating address", app.operating_address],
                  ["Contact", app.contact_email],
                  ["Expected monthly volume", app.expected_monthly_volume_minor != null ? <Amount key="v" minor={app.expected_monthly_volume_minor} currency={o.default_currency} size="sm" /> : null],
                  ["Average order", app.average_order_minor != null ? <Amount key="a" minor={app.average_order_minor} currency={o.default_currency} size="sm" /> : null],
                  ["Countries served", app.countries_served_csv],
                ]}
              />
              <KV cols={1} items={[["Products and services", app.product_description]]} />
              <div className="flex flex-wrap gap-2 text-[12.5px]">
                {[
                  ["Refund policy", app.refund_policy_url],
                  ["Terms", app.terms_url],
                  ["Privacy", app.privacy_url],
                ].map(([k, v]) => (
                  <Chip key={k} tone={v ? "sage" : "peach"}>
                    {k}: {v ? "provided" : "missing"}
                  </Chip>
                ))}
              </div>
              <Panel title="Automated checks">
                {app.checks && app.checks.length > 0 ? (
                  <ul className="divide-y divide-line">
                    {app.checks.map((c, i) => {
                      const { check, result, ...rest } = c as { check?: string; result?: string; [k: string]: unknown };
                      return (
                        <li key={i} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-[13px]">
                          <span className="text-text">{humanize(check)}</span>
                          <span className="flex flex-wrap items-center gap-2 text-muted">
                            {Object.entries(rest).map(([k, v]) => (
                              <span key={k}>
                                {humanize(k)}: <span className="text-text-2">{String(v)}</span>
                              </span>
                            ))}
                            <StatusChip status={result ?? "unknown"} />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-[13px] text-muted">No checks recorded.</p>
                )}
              </Panel>
              {app.required_actions != null && (
                <Panel title="Required actions">
                  <ul className="list-disc space-y-1 pl-5 text-[13px] text-text-2">
                    {(Array.isArray(app.required_actions) ? app.required_actions : [app.required_actions]).map((a, i) => (
                      <li key={i}>{typeof a === "string" ? a : JSON.stringify(a)}</li>
                    ))}
                  </ul>
                </Panel>
              )}
              {app.decided_at && (
                <Panel title="Decision">
                  <KV
                    items={[
                      ["Outcome", <StatusChip key="s" status={app.status} />],
                      ["Decided", <When key="w" at={app.decided_at} />],
                      ["By", <Person key="p" id={app.decided_by} />],
                      ["Reason", app.decision_reason],
                    ]}
                  />
                </Panel>
              )}
            </div>
          ) : (
            <Empty title="No application yet">The merchant hasn&apos;t submitted onboarding details.</Empty>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Balances" subtitle="From the ledger. Test and live are kept apart." />
            <div className="space-y-3">
              <BalanceBlock label="Test mode" b={d.balance_test} tone="lemon" />
              <BalanceBlock label="Live mode" b={d.balance_live} tone="ink" />
            </div>
          </Card>
          <Card>
            <CardHeader title="Volume" subtitle="All time, all modes." />
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["Payments", d.volume.payments],
                  ["Succeeded", d.volume.succeeded],
                  ["Refunds", d.volume.refunds],
                  ["Disputes", d.volume.disputes],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-inner bg-surface-2 p-4">
                  <div className="text-[12.5px] text-muted">{k}</div>
                  <Num value={v} className="mt-2 text-[26px]" />
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Account settings" />
            <KV
              items={[
                ["Default currency", o.default_currency],
                ["Payout schedule", humanize(o.payout_schedule)],
                ["Settlement delay", `${o.settlement_delay_days} days`],
                ["Rolling reserve", `${(o.reserve_bps / 100).toFixed(2)}%`],
                ["Support email", o.support_email],
                ["Risk", <span key="r" className="inline-flex items-center gap-2">{o.risk_score} <StatusChip status={o.risk_level} /></span>],
              ]}
            />
          </Card>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Beneficial owners" subtitle="Screened at onboarding and on every list update." action={ownerHits.length > 0 && <Chip tone="rose">{ownerHits.length} to resolve</Chip>} />
          <Table
            rows={d.beneficial_owners}
            rowKey={(r) => r.id}
            empty={<Empty title="No owners declared" />}
            columns={[
              { key: "name", header: "Name", render: (r) => <span className="text-text">{r.name}</span> },
              { key: "dob", header: "Born", render: (r) => (r.date_of_birth ? `${r.date_of_birth.slice(0, 4)}` : "—") },
              { key: "nat", header: "Nationality", render: (r) => <Country code={r.nationality} /> },
              { key: "own", header: "Ownership", align: "right", render: (r) => `${(r.ownership_bps / 100).toFixed(r.ownership_bps % 100 ? 2 : 0)}%` },
              { key: "rel", header: "Role", render: (r) => humanize(r.relationship) },
              { key: "ver", header: "Verification", render: (r) => <StatusChip status={r.verification_status} /> },
              { key: "scr", header: "Screening", render: (r) => <StatusChip status={r.screening_status} /> },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Team members" subtitle="Emails are masked." />
          <Table
            rows={d.members}
            rowKey={(r) => r.id + r.role}
            empty={<Empty title="No members" />}
            columns={[
              { key: "name", header: "Name", render: (r) => <EntityLink type="user" id={r.id}>{r.name}</EntityLink> },
              { key: "email", header: "Email", render: (r) => <span className="text-text-2">{r.email}</span> },
              { key: "role", header: "Role", render: (r) => <Chip>{r.role}</Chip> },
            ]}
          />
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Recent payouts" />
          <Table
            rows={d.payouts}
            rowKey={(r) => r.id}
            empty={<Empty title="No payouts yet" />}
            columns={[
              { key: "amt", header: "Amount", render: (r) => <Amount minor={r.amount} currency={r.currency} size="sm" /> },
              { key: "st", header: "Status", render: (r) => <StatusChip status={r.status} /> },
              { key: "mode", header: "Mode", render: (r) => <StatusChip status={r.livemode ? "live" : "test"} /> },
              { key: "dest", header: "Destination", render: (r) => (r.destination_last4 ? `•••• ${r.destination_last4}` : "—") },
              { key: "at", header: "Created", render: (r) => <When at={r.created_at} /> },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Cases" />
          <Table
            rows={d.cases}
            rowKey={(r) => r.id}
            empty={<Empty title="No cases">No compliance cases reference this merchant.</Empty>}
            columns={[
              { key: "t", header: "Case", render: (r) => <EntityLink type="case" id={r.id}>{r.title}</EntityLink> },
              { key: "s", header: "Status", render: (r) => <StatusChip status={r.status} /> },
              { key: "p", header: "Priority", render: (r) => <StatusChip status={r.priority} /> },
              { key: "sla", header: "SLA", render: (r) => <SlaChip due={r.due_at} closed={r.status === "CLOSED"} /> },
            ]}
          />
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Audit trail" subtitle="Latest 50 events for this organization. Each row is hash-chained." />
        <AuditTable rows={d.audit} />
      </Card>

      <ReasonDialog
        open={decision !== null}
        onClose={() => setDecision(null)}
        title={decision === "approve" ? `Approve ${o.name}` : `Reject ${o.name}`}
        tone={decision === "approve" ? "ink" : "danger"}
        confirmLabel={decision === "approve" ? "Approve merchant" : "Reject application"}
        description={
          decision === "approve" ? (
            <>
              Approving moves the merchant to <b>Approved</b> and lets them prepare for live payments. The decision, your name and the reason are written to the audit log.
              {ownerHits.length > 0 && <span className="mt-2 block text-rose-ink">Screening matches on beneficial owners must be resolved first; the API will refuse approval.</span>}
            </>
          ) : (
            <>Rejecting closes the application. Use neutral, factual language — the merchant may request the reason.</>
          )
        }
        onSubmit={async (reason) => {
          await guard(() => adminApi(`/merchants/${o.id}/decision`, { body: { approve: decision === "approve", reason } }));
          setDone(decision === "approve" ? "Merchant approved. The decision is recorded in the audit trail." : "Application rejected. The decision is recorded in the audit trail.");
          reload();
        }}
      />
    </>
  );
}

function BalanceBlock({ label, b, tone }: { label: string; b: Balance; tone: "lemon" | "ink" }) {
  return (
    <div className="rounded-inner bg-surface-2 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12.5px] text-muted">{label}</span>
        <Chip tone={tone}>{tone === "ink" ? "Live" : "Test"}</Chip>
      </div>
      {b.balances.length === 0 ? (
        <p className="text-[13px] text-muted">No balance yet.</p>
      ) : (
        <ul className="space-y-3">
          {b.balances.map((x) => (
            <li key={x.currency}>
              <Amount minor={(x.available ?? 0) as number} currency={x.currency} size="md" />
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
                {Object.entries(x)
                  .filter(([k, v]) => k !== "currency" && k !== "available" && typeof v === "number")
                  .map(([k, v]) => (
                    <span key={k}>
                      {humanize(k)}: <Amount minor={v as number} currency={x.currency} size="sm" className="!text-[12.5px]" showCode={false} />
                    </span>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
