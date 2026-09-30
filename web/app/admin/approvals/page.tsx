"use client";

import { useState } from "react";
import { Button, Card, Chip, Empty, PageHeader, StatusChip, Table } from "@/components/ui";
import { adminApi, qs, usePagedList } from "@/components/admin/data";
import { EntityLink, FilterBar, FilterSelect, JsonBlock, Loadable, Notice, Pager, Person, ReasonDialog, When, humanize } from "@/components/admin/kit";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import type { Approval } from "@/components/admin/types";

/** Second-reviewer permission per action (mirrors ComplianceService.ApprovalPermission, §165). */
const APPROVAL_PERMISSION: Record<string, string> = {
  freeze_user: "admin.freeze",
  unfreeze_user: "admin.freeze",
  restrict_user: "admin.restrict",
  close_user: "admin.freeze",
  restrict_org: "admin.merchants.decide",
  suspend_org: "admin.merchants.decide",
  release_payout_hold: "admin.payouts.hold",
  ledger_adjustment: "admin.ledger.adjust",
  confirm_sanctions_match: "admin.sanctions.decide",
  release_transfer: "admin.aml.write",
  reject_transfer: "admin.aml.write",
  close_case: "admin.cases.decide",
  regulatory_report: "admin.regulatory.report",
};

const ACTION_LABEL: Record<string, string> = {
  freeze_user: "Freeze user",
  unfreeze_user: "Restore user access",
  restrict_user: "Restrict user",
  close_user: "Close user account",
  restrict_org: "Restrict merchant",
  suspend_org: "Suspend merchant",
  release_payout_hold: "Release payout hold",
  ledger_adjustment: "Ledger adjustment",
  confirm_sanctions_match: "Confirm screening match",
  release_transfer: "Release held transfer",
  reject_transfer: "Reject held transfer",
  close_case: "Close case",
  regulatory_report: "Prepare regulatory report",
};

export default function ApprovalsPage() {
  return (
    <Guard any={["admin.approve", "admin.aml.write", "admin.payouts.hold", "admin.ledger.adjust", "admin.merchants.decide", "admin.restrict", "admin.freeze", "admin.audit.read"]}>
      <Approvals />
    </Guard>
  );
}

function targetLink(a: Approval) {
  const type = a.target_type === "org" || a.target_type === "organization" ? "org" : a.target_type;
  return <EntityLink type={type} id={a.target_id} />;
}

function Approvals() {
  const { can, canAny, me, guard } = useAdmin();
  const [status, setStatus] = useState("pending");
  const [deciding, setDeciding] = useState<{ a: Approval; approve: boolean } | null>(null);
  const [result, setResult] = useState<Approval | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const list = usePagedList<Approval>(`/approvals${qs({ status })}`, 50);
  const myId = me?.user.id;

  const blocker = (a: Approval): string | null => {
    if (a.status !== "pending") return null;
    if (a.requested_by === myId) return "You requested this — a different reviewer must decide.";
    if (!can("admin.approve"))
      return canAny("admin.aml.write", "admin.payouts.hold", "admin.ledger.adjust", "admin.merchants.decide", "admin.restrict")
        ? "Your role can request but not approve."
        : "Read-only for your role.";
    const need = APPROVAL_PERMISSION[a.action];
    if (need && !can(need)) return `Approving needs ${need}.`;
    return null;
  };

  return (
    <>
      <PageHeader
        eyebrow="Four-eyes controls"
        title="Approvals"
        subtitle="Consequential actions are requested by one person and approved by another before anything changes."
      />
      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-inner bg-surface p-5 shadow-card">
          <div className="text-[13px] font-medium text-text">Requester ≠ approver</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">Nobody can approve their own request. The API refuses it even if attempted.</p>
        </div>
        <div className="rounded-inner bg-surface p-5 shadow-card">
          <div className="text-[13px] font-medium text-text">Right permission</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">Approvers need admin.approve plus the permission for that action (e.g. sanctions decisions).</p>
        </div>
        <div className="rounded-inner bg-surface p-5 shadow-card">
          <div className="text-[13px] font-medium text-text">Recent re-authentication</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">Deciding asks for your password if you haven&apos;t re-authenticated in the last 10 minutes.</p>
        </div>
      </div>

      {result && (
        <div className="mb-5">
          <Notice tone={result.status === "executed" ? "sage" : result.status === "failed" ? "peach" : "sky"}>
            <b>{ACTION_LABEL[result.action] ?? humanize(result.action)}</b> — {result.status}.
            {result.execution_result && <span className="ml-1">Result: {result.execution_result}</span>}
          </Notice>
        </div>
      )}

      <Card>
        <FilterBar>
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "pending", label: "Pending" },
              { value: "executed", label: "Executed" },
              { value: "approved", label: "Approved" },
              { value: "rejected", label: "Rejected" },
              { value: "failed", label: "Failed" },
              { value: "", label: "All" },
            ]}
          />
        </FilterBar>
        <Loadable q={list}>
          {() => (
            <>
              <Table
                rows={list.rows}
                rowKey={(r) => r.id}
                onRowClick={(r) => setOpen(open === r.id ? null : r.id)}
                empty={<Empty title={status === "pending" ? "Nothing waiting for approval" : "No requests"} />}
                columns={[
                  {
                    key: "a",
                    header: "Action",
                    className: "min-w-[170px]",
                    render: (r) => (
                      <div>
                        <div className="text-text">{ACTION_LABEL[r.action] ?? humanize(r.action)}</div>
                        <div className="text-[11.5px] text-muted">approver needs {APPROVAL_PERMISSION[r.action] ?? "—"}</div>
                      </div>
                    ),
                  },
                  { key: "t", header: "Target", render: (r) => targetLink(r) },
                  {
                    key: "req",
                    header: "Requested by",
                    render: (r) => (
                      <div className="flex flex-col">
                        <span className="inline-flex items-center gap-1.5">
                          <Person id={r.requested_by} />
                          {r.requested_by === myId && <Chip tone="lemon-soft">you</Chip>}
                        </span>
                        <span className="text-[11.5px] text-muted">
                          <When at={r.created_at} rel />
                        </span>
                      </div>
                    ),
                  },
                  {
                    key: "r",
                    header: "Reason",
                    className: "min-w-[240px] max-w-[340px]",
                    render: (r) => (
                      <div>
                        <p className="text-text-2">{r.reason}</p>
                        {open === r.id && (
                          <div className="mt-2 space-y-2">
                            <div className="text-[11.5px] text-muted">Payload</div>
                            <JsonBlock value={r.payload ?? {}} max="max-h-40" />
                            {r.decision_note && <p className="text-[12.5px] text-muted">Decision note: {r.decision_note}</p>}
                          </div>
                        )}
                      </div>
                    ),
                  },
                  { key: "c", header: "Case", render: (r) => (r.case_id ? <EntityLink type="case" id={r.case_id} /> : <span className="text-faint">—</span>) },
                  {
                    key: "s",
                    header: "Status",
                    render: (r) => (
                      <div className="flex flex-col items-start gap-1">
                        <StatusChip status={r.status} />
                        {r.decided_by && (
                          <span className="text-[11.5px] text-muted">
                            by <Person id={r.decided_by} />
                          </span>
                        )}
                        {r.execution_result && <span className="max-w-[220px] text-[11.5px] text-text-2">{r.execution_result}</span>}
                      </div>
                    ),
                  },
                  {
                    key: "act",
                    header: "",
                    align: "right",
                    render: (r) => {
                      if (r.status !== "pending") return null;
                      const why = blocker(r);
                      if (why)
                        return (
                          <span className="inline-block max-w-[200px] text-right text-[11.5px] text-muted" title={why}>
                            {why}
                          </span>
                        );
                      return (
                        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="danger" onClick={() => setDeciding({ a: r, approve: false })}>
                            Reject
                          </Button>
                          <Button size="sm" onClick={() => setDeciding({ a: r, approve: true })}>
                            Approve
                          </Button>
                        </div>
                      );
                    },
                  },
                ]}
              />
              <Pager page={list.page} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
            </>
          )}
        </Loadable>
      </Card>

      <ReasonDialog
        open={deciding !== null}
        onClose={() => setDeciding(null)}
        title={deciding ? `${deciding.approve ? "Approve" : "Reject"}: ${ACTION_LABEL[deciding.a.action] ?? humanize(deciding.a.action)}` : ""}
        tone={deciding?.approve ? "ink" : "danger"}
        confirmLabel={deciding?.approve ? "Approve and execute" : "Reject request"}
        label="Decision note"
        minLength={5}
        description={
          deciding && (
            <div className="space-y-2">
              <p>
                Requested by <Person id={deciding.a.requested_by} /> <When at={deciding.a.created_at} rel />: “{deciding.a.reason}”
              </p>
              <p>
                Target: {targetLink(deciding.a)}
                {deciding.a.case_id && (
                  <>
                    {" "}
                    · case <EntityLink type="case" id={deciding.a.case_id} />
                  </>
                )}
              </p>
              <p className="text-muted">
                {deciding.approve
                  ? "Approving executes the action immediately. You may be asked to re-enter your password."
                  : "Rejecting closes the request without changing anything."}
              </p>
            </div>
          )
        }
        onSubmit={async (note) => {
          if (!deciding) return;
          const r = await guard(() => adminApi<Approval>(`/approvals/${deciding.a.id}/decision`, { body: { approve: deciding.approve, note } }));
          setResult(r);
          list.reload();
        }}
      />
    </>
  );
}
