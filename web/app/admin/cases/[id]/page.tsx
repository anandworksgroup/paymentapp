"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ReactNode, useState } from "react";
import { Button, Card, Chip, Empty, ErrorNote, Field, Input, PageHeader, Select, StatusChip, Table, Textarea } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { AuditTable } from "@/components/admin/audit-table";
import { adminApi, adminDownload, useAdminQuery } from "@/components/admin/data";
import { EntityLink, Hash, IdTag, JsonBlock, KV, Loadable, Mono, Notice, PageSkeleton, Panel, Person, ReadOnlyNote, ReasonDialog, SlaChip, When, humanize } from "@/components/admin/kit";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import type { Approval, CaseDetail, CaseEvidence, CaseNote, ComplianceCase } from "@/components/admin/types";

const NOTE_KINDS = [
  { value: "observation", label: "Observation" },
  { value: "analysis", label: "Analysis" },
  { value: "customer_contact", label: "Customer contact" },
  { value: "request_for_information", label: "Request for information" },
  { value: "decision_rationale", label: "Decision rationale" },
];

const EVIDENCE_TYPES = ["transfer", "payment", "user", "bank_account", "alert", "screening_check", "organization", "kyc_check", "ledger_transaction", "device"];

const DECISIONS: { value: string; label: string; approval: boolean; help: string }[] = [
  { value: "FALSE_POSITIVE", label: "False positive", approval: false, help: "Closes the case and its alerts as false positives." },
  { value: "NO_FURTHER_ACTION", label: "No further action", approval: false, help: "Closes the case; alerts are closed as inconclusive." },
  { value: "CONTINUE_MONITORING", label: "Continue monitoring", approval: false, help: "Closes the case; the customer stays under normal monitoring." },
  { value: "REQUEST_INFORMATION", label: "Request information", approval: false, help: "Moves the case to Waiting for information." },
  { value: "ESCALATE", label: "Escalate", approval: false, help: "Marks the case escalated and raises priority to at least high." },
  { value: "RESTRICT", label: "Restrict account", approval: true, help: "Creates an approval request to disable transfers for the subject." },
  { value: "FREEZE", label: "Freeze account", approval: true, help: "Creates an approval request to freeze the subject's account." },
  { value: "REPORT_WHERE_REQUIRED", label: "Report where required", approval: true, help: "Creates an approval request to prepare a regulatory report package and place the case on legal hold." },
  { value: "CLOSE", label: "Close case", approval: true, help: "Creates an approval request to close the case." },
];

export default function CaseDetailPage() {
  return (
    <Guard perm="admin.aml.read">
      <CaseBody />
    </Guard>
  );
}

function CaseBody() {
  const { id } = useParams<{ id: string }>();
  const q = useAdminQuery<CaseDetail>(`/cases/${id}`);
  return (
    <Loadable q={q} skeleton={<PageSkeleton />}>
      {(d) => <CaseView d={d} reload={q.reload} />}
    </Loadable>
  );
}

function Lock() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-label="Finalized" role="img">
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

function CaseView({ d, reload }: { d: CaseDetail; reload: () => void }) {
  const { can, me, guard } = useAdmin();
  const c = d.case;
  const closed = c.status === "CLOSED";
  const write = can("admin.aml.write") && !closed;
  const [notice, setNotice] = useState<{ tone: "sage" | "sky" | "lemon"; text: ReactNode } | null>(null);
  const [exportError, setExportError] = useState<unknown>(null);
  const [exporting, setExporting] = useState(false);

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            {humanize(c.type)} case · <IdTag id={c.id} full />
          </span>
        }
        title={c.title}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusChip status={c.status} />
            <StatusChip status={c.priority} />
            <SlaChip due={d.sla.due_at} closed={closed} />
            {c.legal_hold && <Chip tone="sky">Legal hold</Chip>}
            {c.confidential && <Chip>Confidential — do not disclose to the customer</Chip>}
          </span>
        }
        actions={
          <>
            {can("admin.aml.write") && !closed && c.assigned_to !== me?.user.id && (
              <Button
                variant="soft"
                onClick={async () => {
                  try {
                    await guard(() => adminApi(`/cases/${c.id}/assign`, { body: { assigned_to: null } }));
                    setNotice({ tone: "sage", text: "Case assigned to you." });
                    reload();
                  } catch (e) {
                    setNotice({ tone: "lemon", text: (e as Error).message });
                  }
                }}
              >
                Assign to me
              </Button>
            )}
            {can("admin.export") && (
              <Button
                variant="lemon"
                loading={exporting}
                onClick={async () => {
                  setExporting(true);
                  setExportError(null);
                  try {
                    await adminDownload(`/cases/${c.id}/report`, `case-report-${c.id}.json`);
                    setNotice({ tone: "sage", text: "Report package downloaded. The export and its SHA-256 are recorded in the case history." });
                    reload();
                  } catch (e) {
                    setExportError(e);
                  } finally {
                    setExporting(false);
                  }
                }}
              >
                Export report package
              </Button>
            )}
          </>
        }
      />
      {(notice || exportError) && (
        <div className="mb-5 space-y-2">
          {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
          <ErrorNote error={exportError} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Alerts in this case" />
            <Table
              rows={d.alerts}
              rowKey={(r) => r.id}
              empty={<Empty title="No alerts linked" />}
              columns={[
                { key: "s", header: "Alert", render: (r) => <EntityLink type="alert" id={r.id}>{r.summary}</EntityLink> },
                { key: "rule", header: "Rule", render: (r) => <Mono>{r.rule_key}</Mono> },
                { key: "sv", header: "Severity", render: (r) => <StatusChip status={r.severity} /> },
                { key: "st", header: "Status", render: (r) => <StatusChip status={r.status} /> },
                {
                  key: "tr",
                  header: "Transfer",
                  render: (r) =>
                    r.transfer_id ? (
                      <span className="inline-flex items-center gap-2">
                        <EntityLink type="transfer" id={r.transfer_id} />
                        <Link href={`/admin/transactions/${r.transfer_id}/trace`} className="text-[12px] text-sage-700 underline underline-offset-4">
                          trace
                        </Link>
                      </span>
                    ) : (
                      <span className="text-faint">—</span>
                    ),
                },
              ]}
            />
          </Card>
          <Notes caseId={c.id} notes={d.notes} write={write} reload={reload} />
          <Evidence caseId={c.id} evidence={d.evidence} write={write} reload={reload} />
          <Card>
            <CardHeader title="History" subtitle="Every action on this case, from the tamper-evident audit log. Click a row for before/after." />
            <AuditTable rows={d.history} />
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Case details" />
            <KV
              items={[
                ["Subject", c.subject_type === "user" ? <Person key="s" id={c.subject_id} /> : <EntityLink key="s" type={c.subject_type} id={c.subject_id} />],
                ["Subject type", humanize(c.subject_type)],
                ["Assignee", <Person key="a" id={c.assigned_to} />],
                ["Opened by", <Person key="o" id={c.created_by} />],
                ["Opened", <When key="w" at={c.created_at} />],
                ["SLA due", <When key="d" at={d.sla.due_at} />],
                ["Last update", <When key="u" at={c.updated_at} />],
                ["Closed", c.closed_at ? <When key="c" at={c.closed_at} /> : null],
              ]}
            />
            {c.decision && (
              <div className="mt-4 rounded-inner bg-surface-2 p-4">
                <div className="text-[12px] text-muted">Decision</div>
                <div className="mt-1 flex items-center gap-2">
                  <StatusChip status={c.decision} /> <span className="text-[12.5px] text-muted">by</span> <Person id={c.decided_by} />
                </div>
                <p className="mt-2 text-[13px] text-text-2">{c.decision_reason}</p>
              </div>
            )}
          </Card>
          <DecisionPanel c={c} canDecide={write} onDone={(t) => {
              setNotice(t);
              reload();
            }} />
          <Card>
            <CardHeader title="Approvals" subtitle="Four-eyes requests raised from this case." />
            {d.approvals.length === 0 ? (
              <p className="text-[13px] text-muted">No approval requests yet.</p>
            ) : (
              <ul className="space-y-3">
                {d.approvals.map((a) => (
                  <li key={a.id} className="rounded-inner bg-surface-2 p-4 text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-text">{humanize(a.action)}</span>
                      <StatusChip status={a.status} />
                    </div>
                    <div className="mt-1.5 text-text-2">“{a.reason}”</div>
                    <div className="mt-2 text-[12px] text-muted">
                      Requested by <Person id={a.requested_by} /> <When at={a.created_at} rel />
                      {a.decided_by && (
                        <>
                          {" "}
                          · decided by <Person id={a.decided_by} />
                        </>
                      )}
                    </div>
                    {a.execution_result && <div className="mt-2 rounded-[12px] bg-surface px-3 py-2 text-[12.5px] text-text-2">{a.execution_result}</div>}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 text-[12.5px]">
              <Link href="/admin/approvals" className="text-text underline decoration-line-strong underline-offset-4">
                Open the approvals queue
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function DecisionPanel({ c, canDecide, onDone }: { c: ComplianceCase; canDecide: boolean; onDone: (n: { tone: "sage" | "sky"; text: ReactNode }) => void }) {
  const { guard, can } = useAdmin();
  const [decision, setDecision] = useState("NO_FURTHER_ACTION");
  const [open, setOpen] = useState(false);
  const chosen = DECISIONS.find((x) => x.value === decision)!;
  const closed = c.status === "CLOSED";
  return (
    <Card>
      <CardHeader title="Decision" subtitle="Outcomes without customer impact apply now. Restrictive, reporting and closing outcomes need a second approver." />
      {closed ? (
        <ReadOnlyNote>This case is closed and read-only.</ReadOnlyNote>
      ) : !canDecide ? (
        <ReadOnlyNote>{can("admin.aml.read") ? "Deciding needs admin.aml.write." : "Read-only."}</ReadOnlyNote>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-1.5">
            {DECISIONS.map((x) => (
              <li key={x.value}>
                <label className={`flex cursor-pointer items-start gap-3 rounded-[14px] px-3 py-2.5 transition ${decision === x.value ? "bg-surface-2" : "hover:bg-surface-2"}`}>
                  <input type="radio" name="decision" className="mt-1 accent-[var(--ink)]" checked={decision === x.value} onChange={() => setDecision(x.value)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[13.5px] text-text">
                      {x.label}
                      {x.approval ? <Chip tone="lemon-soft">needs approval</Chip> : <Chip tone="sage">applies now</Chip>}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-muted">{x.help}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <Button className="w-full" onClick={() => setOpen(true)}>
            {chosen.approval ? "Request approval" : "Record decision"}
          </Button>
        </div>
      )}
      <ReasonDialog
        open={open}
        onClose={() => setOpen(false)}
        title={chosen.approval ? `Request: ${chosen.label}` : `Decide: ${chosen.label}`}
        confirmLabel={chosen.approval ? "Submit for approval" : "Record decision"}
        tone={decision === "FREEZE" || decision === "RESTRICT" ? "danger" : "ink"}
        label="Decision rationale"
        description={
          chosen.approval ? (
            <>
              {chosen.help} It takes effect only after a <b>different</b> reviewer approves it. Your rationale is stored with the request and in the case history.
            </>
          ) : (
            <>{chosen.help} Your rationale is stored with the decision and in the case history.</>
          )
        }
        onSubmit={async (reason) => {
          const r = await guard(() => adminApi<ComplianceCase | Approval>(`/cases/${c.id}/decision`, { body: { decision, reason } }));
          if (r.object === "approval_request") {
            onDone({
              tone: "sky",
              text: (
                <>
                  Approval request created for <b>{humanize((r as Approval).action)}</b>. Nothing changes until a different reviewer approves it in{" "}
                  <Link className="underline" href="/admin/approvals">
                    Approvals
                  </Link>
                  .
                </>
              ),
            });
          } else onDone({ tone: "sage", text: `Decision recorded: ${chosen.label}.` });
        }}
      />
    </Card>
  );
}

function Notes({ caseId, notes, write, reload }: { caseId: string; notes: CaseNote[]; write: boolean; reload: () => void }) {
  const { me, guard } = useAdmin();
  const [kind, setKind] = useState("observation");
  const [body, setBody] = useState("");
  const [finalize, setFinalize] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await guard(() => adminApi(`/cases/${caseId}/notes`, { body: { kind, body: body.trim(), finalize } }));
      setBody("");
      setFinalize(false);
      reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Notes" subtitle="Drafts can be finalized by their author. Finalized notes are locked and included in the report package." />
      {notes.length === 0 ? (
        <p className="mb-4 text-[13px] text-muted">No notes yet.</p>
      ) : (
        <ul className="mb-5 space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-inner bg-surface-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2">
                  <Chip>{humanize(n.kind)}</Chip>
                  {n.finalized ? (
                    <span className="inline-flex items-center gap-1 text-[12px] text-sage-700" title={`Finalized ${n.finalized_at ?? ""}`}>
                      <Lock /> Finalized
                    </span>
                  ) : (
                    <Chip tone="lemon-soft">Draft</Chip>
                  )}
                </span>
                <span className="text-[12px] text-muted">
                  <Person id={n.author_id} /> · <When at={n.created_at} />
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-text">{n.body}</p>
              {!n.finalized && write && n.author_id === me?.user.id && (
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="soft"
                    onClick={async () => {
                      try {
                        await guard(() => adminApi(`/case_notes/${n.id}/finalize`, { method: "POST" }));
                        reload();
                      } catch (e) {
                        setError(e);
                      }
                    }}
                  >
                    Finalize (locks the note)
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {write ? (
        <Panel title="Add a note">
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[200px_1fr]">
              <Field label="Kind">
                <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                  {NOTE_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Note" hint="Stick to facts you observed. Avoid conclusions about intent.">
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="What you reviewed and what you found." />
              </Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-[13px] text-text-2">
                <input type="checkbox" checked={finalize} onChange={(e) => setFinalize(e.target.checked)} className="accent-[var(--ink)]" />
                Finalize now (can&apos;t be edited afterwards)
              </label>
              <Button onClick={add} loading={busy} disabled={!body.trim()}>
                Add note
              </Button>
            </div>
            <ErrorNote error={error} />
          </div>
        </Panel>
      ) : (
        <ErrorNote error={error} />
      )}
    </Card>
  );
}

function Evidence({ caseId, evidence, write, reload }: { caseId: string; evidence: CaseEvidence[]; write: boolean; reload: () => void }) {
  const { guard } = useAdmin();
  const [refType, setRefType] = useState("transfer");
  const [refId, setRefId] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await guard(() => adminApi(`/cases/${caseId}/evidence`, { body: { ref_type: refType, ref_id: refId.trim(), description: desc.trim() } }));
      setRefId("");
      setDesc("");
      reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Evidence" subtitle="Point-in-time snapshots of platform records. The SHA-256 of each snapshot, who captured it and when form the chain of custody." />
      {evidence.length === 0 ? (
        <p className="mb-4 text-[13px] text-muted">No evidence captured yet.</p>
      ) : (
        <ul className="mb-5 space-y-3">
          {evidence.map((e) => (
            <li key={e.id} className="rounded-inner bg-surface-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2">
                  <Chip tone="sky">{humanize(e.ref_type ?? e.type)}</Chip>
                  <EntityLink type={e.ref_type} id={e.ref_id} />
                </span>
                <Button size="sm" variant="ghost" onClick={() => setOpen(open === e.id ? null : e.id)}>
                  {open === e.id ? "Hide snapshot" : "View snapshot"}
                </Button>
              </div>
              <p className="mt-1.5 text-[13.5px] text-text">{e.description}</p>
              <div className="mt-2 grid grid-cols-1 gap-1 text-[12px] text-muted sm:grid-cols-3">
                <span>
                  SHA-256 <Hash value={e.sha256} n={12} />
                </span>
                <span>
                  Captured by <Person id={e.captured_by} />
                </span>
                <span>
                  <When at={e.created_at} /> · {humanize(e.source)}
                </span>
              </div>
              {open === e.id && (
                <div className="mt-3">
                  <JsonBlock value={e.snapshot} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {write && (
        <Panel title="Capture evidence">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr]">
            <Field label="Record type">
              <Select value={refType} onChange={(e) => setRefType(e.target.value)}>
                {EVIDENCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {humanize(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Record id">
              <Input value={refId} onChange={(e) => setRefId(e.target.value)} placeholder="e.g. tr_…, usr_…, alt_…" />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Why it matters">
              <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Short description for the evidence index" />
            </Field>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[12px] text-muted">The platform snapshots the record now and hashes it; later changes to the record don&apos;t alter the evidence.</span>
            <Button onClick={add} loading={busy} disabled={!refId.trim() || !desc.trim()}>
              Capture
            </Button>
          </div>
          <div className="mt-3">
            <ErrorNote error={error} />
          </div>
        </Panel>
      )}
    </Card>
  );
}
