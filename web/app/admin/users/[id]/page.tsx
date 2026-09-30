"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Amount, Button, Card, Chip, Empty, Field, PageHeader, Select, ShareBars, StatusChip, Table } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { compactMoney } from "@/lib/format";
import { adminApi, useAdminQuery } from "@/components/admin/data";
import {
  ConfirmDialog,
  Country,
  EntityLink,
  Hash,
  IdTag,
  KV,
  Loadable,
  Notice,
  Num,
  PageSkeleton,
  Panel,
  Person,
  ReadOnlyNote,
  ReasonDialog,
  SlaChip,
  Tabs,
  When,
  humanize,
} from "@/components/admin/kit";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import { TransferTable } from "@/components/admin/transfer-table";
import { FundFlowTab, NetworkTab, TimelineTab } from "@/components/admin/user-tabs";
import type { Approval, UserDetail } from "@/components/admin/types";

type Tab = "profile" | "timeline" | "flow" | "network";

export default function UserDetailPage() {
  return (
    <Guard perm="admin.users.read">
      <UserBody />
    </Guard>
  );
}

function ninetyDaysAgo() {
  return new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

function UserBody() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { can } = useAdmin();
  const aml = can("admin.aml.read");
  const tabParam = params.get("tab") as Tab | null;
  const tab: Tab = tabParam && (tabParam === "profile" || tabParam === "timeline" || aml) ? tabParam : "profile";
  const [unmask, setUnmask] = useState(false);
  const [confirmUnmask, setConfirmUnmask] = useState(false);
  const [range] = useState(() => ({ from: ninetyDaysAgo(), to: today() }));
  const q = useAdminQuery<UserDetail>(`/users/${id}${unmask ? "?unmask=true" : ""}`);
  const setTab = (t: Tab) => router.replace(`/admin/users/${id}${t === "profile" ? "" : `?tab=${t}`}`, { scroll: false });

  return (
    <Loadable q={q} skeleton={<PageSkeleton />}>
      {(d) => (
        <>
          <Header
            d={d}
            unmasked={unmask}
            onUnmask={() => (unmask ? setUnmask(false) : setConfirmUnmask(true))}
            reload={q.reload}
          />
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "profile", label: "Profile" },
              { value: "timeline", label: "Timeline" },
              { value: "flow", label: "Fund flow", hidden: !aml },
              { value: "network", label: "Network", hidden: !aml },
            ]}
          />
          {tab === "profile" && <Profile d={d} unmasked={unmask} reload={q.reload} />}
          {tab === "timeline" && <TimelineTab userId={id} />}
          {tab === "flow" && (d.wallet ? <FundFlowTab userId={id} defaultFrom={range.from} defaultTo={range.to} /> : <Card><Empty title="No wallet">This account has no wallet, so there is no fund flow.</Empty></Card>)}
          {tab === "network" && <NetworkTab userId={id} />}
          <ConfirmDialog
            open={confirmUnmask}
            onClose={() => setConfirmUnmask(false)}
            title="Show unmasked personal data?"
            confirmLabel="Show unmasked"
            onConfirm={async () => setUnmask(true)}
          >
            <p>
              You&apos;ll see this person&apos;s full email, phone, date of birth and address. The view is recorded in the data access log with your name, time and IP.
              Only unmask when your task needs it.
            </p>
          </ConfirmDialog>
        </>
      )}
    </Loadable>
  );
}

const ACCOUNT_ACTIONS = [
  { value: "restrict_user", label: "Restrict transfers", payload: { status: "TRANSFERS_DISABLED" }, help: "Sending and withdrawing are disabled; the user can still sign in and receive." },
  { value: "freeze_user", label: "Freeze account", payload: {}, help: "All account features are paused while the review completes." },
  { value: "unfreeze_user", label: "Restore full access", payload: {}, help: "Returns the account to normal." },
  { value: "close_user", label: "Close account", payload: {}, help: "Closes the account and signs the user out everywhere." },
];

function Header({ d, unmasked, onUnmask, reload }: { d: UserDetail; unmasked: boolean; onUnmask: () => void; reload: () => void }) {
  const { can, guard } = useAdmin();
  const [actionOpen, setActionOpen] = useState(false);
  const [action, setAction] = useState(ACCOUNT_ACTIONS[0].value);
  const [created, setCreated] = useState<Approval | null>(null);
  const u = d.identity;
  const chosen = ACCOUNT_ACTIONS.find((a) => a.value === action)!;
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            {u.platform_role ? "Platform staff" : "User"} · <IdTag id={u.id} full />
          </span>
        }
        title={u.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusChip status={u.status} />
            <Chip tone={d.verification.kyc_status === "VERIFIED" ? "sage" : d.verification.kyc_status === "REVIEW" ? "lemon-soft" : "neutral"}>
              KYC {d.verification.kyc_status.replace(/_/g, " ").toLowerCase()} · level {d.verification.kyc_level}
            </Chip>
            <Chip tone={d.risk.risk_level === "high" ? "peach" : d.risk.risk_level === "medium" ? "lemon-soft" : "sage"}>Risk {d.risk.risk_level}</Chip>
            {u.platform_role && <Chip tone="ink">{u.platform_role.replace(/_/g, " ").toLowerCase()}</Chip>}
            <Country code={u.country} />
          </span>
        }
        actions={
          <>
            {can("admin.pii.unmask") && (
              <Button variant={unmasked ? "lemon" : "soft"} onClick={onUnmask}>
                {unmasked ? "Mask again" : "Unmask personal data"}
              </Button>
            )}
            {can("admin.restrict") && !u.platform_role && (
              <Button variant="soft" onClick={() => setActionOpen(true)}>
                Request account action
              </Button>
            )}
          </>
        }
      />
      {created && (
        <div className="mb-5">
          <Notice tone="sky">
            Approval request created for <b>{humanize(created.action)}</b>. A second reviewer must approve it in <EntityLink type="approval" id={created.id}>Approvals</EntityLink> before anything changes.
          </Notice>
        </div>
      )}
      <ReasonDialog
        open={actionOpen}
        onClose={() => setActionOpen(false)}
        title="Request an account action"
        confirmLabel="Request approval"
        description={
          <>
            Account restrictions are four-eyes controls: this creates a request that a <b>different</b> reviewer with the right permission must approve. The customer sees neutral
            wording only (&ldquo;Some account features are temporarily unavailable while we complete a review&rdquo;).
          </>
        }
        onSubmit={async (reason) => {
          const a = await guard(() => adminApi<Approval>("/approvals", { body: { action, target_type: "user", target_id: u.id, payload: chosen.payload, reason } }));
          setCreated(a);
          reload();
        }}
      >
        <Field label="Action" hint={chosen.help}>
          <Select value={action} onChange={(e) => setAction(e.target.value)}>
            {ACCOUNT_ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
      </ReasonDialog>
    </>
  );
}

function Profile({ d, unmasked, reload }: { d: UserDetail; unmasked: boolean; reload: () => void }) {
  const { can, guard } = useAdmin();
  const [kyc, setKyc] = useState<"approve" | "reject" | null>(null);
  const latestLevel = d.verification.checks[0]?.level_requested ?? Math.max(1, d.verification.kyc_level);
  const [level, setLevel] = useState(latestLevel);
  const [kycDone, setKycDone] = useState<string | null>(null);
  const u = d.identity;
  const mp = d.money_profile;
  const [showAll, setShowAll] = useState(false);
  const aml = can("admin.aml.read");

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Identity"
            subtitle={unmasked ? "Unmasked view — this access is recorded in the data access log." : "Masked. Roles with admin.pii.unmask can reveal it; the view is logged."}
            action={unmasked ? <Chip tone="peach">Unmasked · logged</Chip> : <Chip>Masked</Chip>}
          />
          <KV
            items={[
              ["Name", u.name],
              ["Email", u.email],
              ["Phone", u.phone],
              ["Date of birth", u.date_of_birth],
              ["Address", u.address],
              ["Country", <Country key="c" code={u.country} />],
              ["Nationality", <Country key="n" code={u.nationality} />],
              ["Joined", <When key="j" at={u.created_at} />],
              ["Last sign-in", <When key="l" at={u.last_login_at} />],
              ["Two-factor", u.mfa_enabled ? <Chip key="m" tone="sage">Enabled</Chip> : <Chip key="m">Off</Chip>],
            ]}
          />
        </Card>
        <Card>
          <CardHeader
            title="Verification"
            subtitle={d.verification.kyc_verified_at ? <>Verified <When at={d.verification.kyc_verified_at} /></> : "Not verified yet."}
            action={
              d.verification.kyc_status === "REVIEW" &&
              (can("admin.kyc.decide") ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="danger" onClick={() => setKyc("reject")}>
                    Reject
                  </Button>
                  <Button size="sm" onClick={() => setKyc("approve")}>
                    Approve
                  </Button>
                </div>
              ) : (
                <ReadOnlyNote>KYC decisions need admin.kyc.decide</ReadOnlyNote>
              ))
            }
          />
          {kycDone && (
            <div className="mb-3">
              <Notice>{kycDone}</Notice>
            </div>
          )}
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="rounded-inner bg-surface-2 p-4">
              <div className="text-[12px] text-muted">KYC level</div>
              <Num value={d.verification.kyc_level} className="mt-1.5 text-[26px]" />
            </div>
            <div className="rounded-inner bg-surface-2 p-4">
              <div className="text-[12px] text-muted">Status</div>
              <div className="mt-2.5">
                <StatusChip status={d.verification.kyc_status} />
              </div>
            </div>
            <div className="rounded-inner bg-surface-2 p-4">
              <div className="text-[12px] text-muted">Risk score</div>
              <Num value={d.risk.risk_score} className="mt-1.5 text-[26px]" suffix={d.risk.risk_level} />
            </div>
          </div>
          <Table
            rows={d.verification.checks}
            rowKey={(r) => r.id}
            empty={<Empty title="No KYC checks yet" />}
            columns={[
              { key: "l", header: "Level", render: (r) => `L${r.level_requested}` },
              { key: "doc", header: "Document", render: (r) => humanize(r.document_type) },
              { key: "p", header: "Provider", render: (r) => <span className="text-text-2">{humanize(r.provider)}</span> },
              { key: "r", header: "Result", render: (r) => <StatusChip status={r.result} /> },
              { key: "rev", header: "Reviewer", render: (r) => (r.reviewed_by ? <Person id={r.reviewed_by} /> : <span className="text-muted">Automated</span>) },
              { key: "at", header: "When", render: (r) => <When at={r.created_at} /> },
            ]}
          />
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Money profile"
          subtitle="From this wallet's transfers (latest 200). USD figures are converted at reference rates for comparison."
          action={
            d.wallet && (
              <span className="inline-flex items-center gap-2 text-[13px] text-text-2">
                Wallet <b className="font-medium text-text">{d.wallet.handle}</b> <StatusChip status={d.wallet.status} />
              </span>
            )
          }
        />
        {d.wallet ? (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-inner bg-surface-2 p-4">
                <div className="text-[12px] text-muted">Total in</div>
                <Amount minor={mp.total_incoming_usd} currency="USD" size="md" className="mt-2" />
              </div>
              <div className="rounded-inner bg-surface-2 p-4">
                <div className="text-[12px] text-muted">Total out</div>
                <Amount minor={mp.total_outgoing_usd} currency="USD" size="md" className="mt-2" />
              </div>
              <div className="rounded-inner bg-surface-2 p-4">
                <div className="text-[12px] text-muted">Average transfer</div>
                <Amount minor={mp.average_transaction_usd} currency="USD" size="md" className="mt-2" />
              </div>
              <div className="rounded-inner bg-surface-2 p-4">
                <div className="text-[12px] text-muted">Withdrawals</div>
                <Num value={mp.withdrawals} className="mt-2 text-[26px]" />
              </div>
              <div className="rounded-inner bg-surface-2 p-4">
                <div className="text-[12px] text-muted">Counterparties</div>
                <Num value={mp.counterparties} className="mt-2 text-[26px]" />
              </div>
              <div className="rounded-inner bg-surface-2 p-4">
                <div className="text-[12px] text-muted">Currencies · countries</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {mp.currencies.map((c) => (
                    <Chip key={c} tone="lemon-soft">
                      {c}
                    </Chip>
                  ))}
                  {mp.countries.map((c) => (
                    <Chip key={c}>
                      <Country code={c} />
                    </Chip>
                  ))}
                </div>
              </div>
            </div>
            <Panel title="Where money comes from">
              {mp.top_funding_sources.length === 0 ? (
                <p className="text-[13px] text-muted">No completed inflows.</p>
              ) : (
                <ShareBars
                  rows={mp.top_funding_sources.map((s) => ({ label: humanize(s.source), value: s.usd, sub: `${s.count}×` }))}
                  format={(v) => compactMoney(v, "USD")}
                />
              )}
            </Panel>
          </div>
        ) : (
          <Empty title="No wallet">This account doesn&apos;t hold a wallet.</Empty>
        )}
      </Card>

      {d.wallet && (
        <Card>
          <CardHeader
            title="Transfers"
            subtitle={`${d.transfers.length} most recent`}
            action={
              d.transfers.length > 10 && (
                <Button size="sm" variant="soft" onClick={() => setShowAll((s) => !s)}>
                  {showAll ? "Show fewer" : `Show all ${d.transfers.length}`}
                </Button>
              )
            }
          />
          <TransferTable rows={showAll ? d.transfers : d.transfers.slice(0, 10)} walletId={d.wallet.id} />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Bank accounts" subtitle="Only the last 4 digits are ever shown." />
          <Table
            rows={d.bank_accounts}
            rowKey={(r) => r.id}
            empty={<Empty title="No bank accounts" />}
            columns={[
              { key: "b", header: "Bank", render: (r) => <span className="text-text">{r.bank_name}</span> },
              { key: "n", header: "Account", render: (r) => <span className="font-mono text-[12.5px]">•••• {r.last4}</span> },
              { key: "c", header: "Country", render: (r) => <Country code={r.country} /> },
              { key: "v", header: "Verification", render: (r) => <StatusChip status={r.verification_status} /> },
              { key: "m", header: "Name match", render: (r) => (r.name_match ? <Chip tone="sage">Match</Chip> : <Chip tone="peach">No match</Chip>) },
              { key: "a", header: "Added", render: (r) => (r.removed_at ? <span className="text-muted">Removed <When at={r.removed_at} /></span> : <When at={r.created_at} />) },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Devices" />
          <Table
            rows={d.devices}
            rowKey={(r) => r.id}
            empty={<Empty title="No devices recorded" />}
            columns={[
              { key: "p", header: "Device", render: (r) => <span className="text-text">{humanize(r.platform) || "Unknown"}</span> },
              { key: "ua", header: "User agent", render: (r) => <span className="text-[12.5px] text-text-2">{r.user_agent ?? "—"}</span> },
              { key: "ip", header: "Last IP", render: (r) => <span className="font-mono text-[12px]">{r.last_ip ?? "—"}</span> },
              { key: "fp", header: "Fingerprint", render: (r) => <Hash value={r.fingerprint} n={8} /> },
              { key: "s", header: "Last seen", render: (r) => <When at={r.last_seen_at} rel /> },
            ]}
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Sessions" subtitle="Latest 20." />
          <Table
            rows={d.sessions}
            rowKey={(r) => r.id}
            empty={<Empty title="No sessions" />}
            columns={[
              { key: "c", header: "Started", render: (r) => <When at={r.created_at} /> },
              { key: "ip", header: "IP", render: (r) => <span className="font-mono text-[12px]">{r.ip ?? "—"}</span> },
              { key: "ua", header: "User agent", render: (r) => <span className="text-[12.5px] text-text-2">{r.user_agent ?? "—"}</span> },
              { key: "r", header: "State", render: (r) => (r.revoked_at ? <Chip>Revoked</Chip> : <Chip tone="sage">Active</Chip>) },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Memberships" subtitle="Merchant organizations this person belongs to." />
          <Table
            rows={d.memberships}
            rowKey={(r) => r.id}
            empty={<Empty title="No memberships" />}
            columns={[
              { key: "o", header: "Organization", render: (r) => <EntityLink type="org" id={r.org_id} /> },
              { key: "r", header: "Role", render: (r) => <Chip>{r.role}</Chip> },
              { key: "a", header: "Since", render: (r) => <When at={r.created_at} /> },
            ]}
          />
        </Card>
      </div>

      {aml && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader title="Alerts" subtitle="Signals raised for review. An alert is not a finding." />
            <Table
              rows={d.alerts}
              rowKey={(r) => r.id}
              empty={<Empty title="No alerts" />}
              columns={[
                { key: "s", header: "Summary", render: (r) => <EntityLink type="alert" id={r.id}>{r.summary}</EntityLink> },
                { key: "sv", header: "Severity", render: (r) => <StatusChip status={r.severity} /> },
                { key: "st", header: "Status", render: (r) => <StatusChip status={r.status} /> },
                { key: "at", header: "Raised", render: (r) => <When at={r.created_at} /> },
              ]}
            />
          </Card>
          <Card>
            <CardHeader title="Cases" />
            <Table
              rows={d.cases}
              rowKey={(r) => r.id}
              empty={<Empty title="No cases" />}
              columns={[
                { key: "t", header: "Case", render: (r) => <EntityLink type="case" id={r.id}>{r.title}</EntityLink> },
                { key: "s", header: "Status", render: (r) => <StatusChip status={r.status} /> },
                { key: "sla", header: "SLA", render: (r) => <SlaChip due={r.due_at} closed={r.status === "CLOSED"} /> },
              ]}
            />
          </Card>
        </div>
      )}

      <ReasonDialog
        open={kyc !== null}
        onClose={() => setKyc(null)}
        title={kyc === "approve" ? "Approve identity verification" : "Reject identity verification"}
        tone={kyc === "approve" ? "ink" : "danger"}
        confirmLabel={kyc === "approve" ? `Approve level ${level}` : "Reject"}
        description={
          kyc === "approve"
            ? "Approving raises the verified KYC level, which unlocks higher wallet limits. Confirm the documents and screening results support it."
            : "Rejecting keeps the account at its current level. The user will be asked to try again; use neutral wording."
        }
        onSubmit={async (reason) => {
          await guard(() => adminApi(`/users/${u.id}/kyc_decision`, { body: { approve: kyc === "approve", level, reason } }));
          setKycDone(kyc === "approve" ? `Verification approved at level ${level}.` : "Verification rejected.");
          reload();
        }}
      >
        {kyc === "approve" && (
          <Field label="Level to grant">
            <Select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
              {[1, 2, 3].map((l) => (
                <option key={l} value={l}>
                  Level {l}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </ReasonDialog>
    </div>
  );
}
