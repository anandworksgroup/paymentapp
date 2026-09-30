"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ReactNode, useState } from "react";
import { Amount, Button, Card, Chip, Field, PageHeader, Select, StatusChip } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { adminApi, useAdminQuery } from "@/components/admin/data";
import { Country, EntityLink, IdTag, KV, Loadable, Mono, Notice, PageSkeleton, Panel, Person, ReadOnlyNote, ReasonDialog, When, WalletRef, humanize } from "@/components/admin/kit";
import { OpenCaseDialog } from "@/components/admin/open-case";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import type { Alert, AlertDetail, AlertReason, Approval, ListResponse, ScreeningEntry, ScreeningList } from "@/components/admin/types";

const OPEN = ["NEW", "QUEUED", "IN_REVIEW", "ESCALATED"];

/** The alert endpoint returns the subject's full date of birth; the console shows the year only. */
function maskDob(v?: string | null) {
  return v ? `${v.slice(0, 4)}-**-**` : "—";
}

export default function AlertDetailPage() {
  return (
    <Guard perm="admin.aml.read">
      <AlertBody />
    </Guard>
  );
}

function AlertBody() {
  const { id } = useParams<{ id: string }>();
  const q = useAdminQuery<AlertDetail>(`/alerts/${id}`);
  return (
    <Loadable q={q} skeleton={<PageSkeleton />}>
      {(d) => <AlertView d={d} reload={q.reload} />}
    </Loadable>
  );
}

function AlertView({ d, reload }: { d: AlertDetail; reload: () => void }) {
  const { can, me, guard } = useAdmin();
  const a = d.alert;
  const [conclude, setConclude] = useState(false);
  const [conclusion, setConclusion] = useState("FALSE_POSITIVE");
  const [caseOpen, setCaseOpen] = useState(false);
  const [outcome, setOutcome] = useState<{ tone: "sage" | "sky"; text: ReactNode } | null>(null);
  const [busy, setBusy] = useState(false);
  const write = can("admin.aml.write");
  const isOpen = OPEN.includes(a.status);
  const screeningType = a.type === "sanctions" || a.type === "pep";
  const mine = a.assigned_to === me?.user.id;
  const ruleParams = a.related?.rule?.params ?? {};
  const currentParams = d.rule?.params ?? {};
  const ruleChanged = d.rule && d.rule.version !== a.rule_version && a.rule_version > 0;
  const check = d.screening[0];
  const listed = useListedEntry(check?.matched_entry_id ?? (a.related?.entry as string | undefined) ?? null);

  const assign = async () => {
    setBusy(true);
    try {
      await guard(() => adminApi(`/alerts/${a.id}/assign`, { body: { assigned_to: null } }));
      setOutcome({ tone: "sage", text: "Assigned to you and moved to In review." });
      reload();
    } catch (e) {
      setOutcome({ tone: "sky", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            {screeningType ? "Screening alert" : "Monitoring alert"} · <IdTag id={a.id} full />
          </span>
        }
        title={a.summary}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusChip status={a.severity} />
            <StatusChip status={a.status} />
            <Chip>{a.type === "aml" ? "transaction monitoring" : a.type}</Chip>
            <span className="text-muted">
              Raised <When at={a.created_at} /> · assignee <Person id={a.assigned_to} />
            </span>
          </span>
        }
        actions={
          write ? (
            <>
              {isOpen && !mine && (
                <Button variant="soft" onClick={assign} loading={busy}>
                  Assign to me
                </Button>
              )}
              {!a.case_id && isOpen && (
                <Button variant="soft" onClick={() => setCaseOpen(true)}>
                  Open case
                </Button>
              )}
              {isOpen && <Button onClick={() => setConclude(true)}>Conclude</Button>}
            </>
          ) : (
            <ReadOnlyNote>Read-only: working alerts needs admin.aml.write</ReadOnlyNote>
          )
        }
      />
      {outcome && (
        <div className="mb-5">
          <Notice tone={outcome.tone}>{outcome.text}</Notice>
        </div>
      )}
      {a.case_id && (
        <div className="mb-5">
          <Notice tone="sky">
            Part of case <EntityLink type="case" id={a.case_id} />. Decisions for linked alerts are usually taken on the case.
          </Notice>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Triggered because" subtitle="What the rule observed compared with its threshold at the time the alert was raised." />
            {(a.reasons ?? []).length === 0 ? (
              <p className="text-[13px] text-muted">No reasons recorded.</p>
            ) : (
              <ul className="space-y-3">
                {(a.reasons ?? []).map((r, i) => (
                  <Reason key={i} r={r} alert={a} />
                ))}
              </ul>
            )}
          </Card>

          {check && (
            <Card>
              <CardHeader title="Screening match" subtitle="Synthetic sandbox list data. A name resemblance needs human review before any conclusion." />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Panel title="Screened">
                  <KV
                    cols={1}
                    items={[
                      ["Name", check.screened_name],
                      ["Context", humanize(check.context)],
                      ["Year of birth (subject)", maskDob(d.subject?.date_of_birth as string | null)],
                      ["Country (subject)", <Country key="c" code={(d.subject?.country as string) ?? null} />],
                    ]}
                  />
                </Panel>
                <Panel title="Listed entry">
                  <KV
                    cols={1}
                    items={[
                      ["Matched name", check.matched_name],
                      ["Listed date of birth", listed?.date_of_birth ?? "—"],
                      ["Listed country", <Country key="lc" code={listed?.country ?? null} />],
                      ["Score", <span key="s" className="numeral text-[20px]">{check.score}</span>],
                      ["Program", String(a.related?.program ?? "—")],
                      ["List version", <span key="l" className="text-[12.5px]">{check.list_version}</span>],
                    ]}
                  />
                </Panel>
              </div>
              <div className="mt-3 text-[12px] text-muted">
                Match logic: <Mono>{check.match_logic}</Mono> · result <StatusChip status={check.result} />
                {check.reviewed_by && (
                  <>
                    {" "}
                    · reviewed by <Person id={check.reviewed_by} />
                  </>
                )}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Related activity" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Panel title="Transfers">
                {d.transfer || (a.related?.transfers ?? []).length ? (
                  <ul className="space-y-2 text-[13px]">
                    {d.transfer && (
                      <li className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <EntityLink type="transfer" id={d.transfer.id} /> <span className="text-muted">(triggering)</span>
                        </span>
                        <Amount minor={d.transfer.source_amount} currency={d.transfer.source_currency} size="sm" />
                      </li>
                    )}
                    {(a.related?.transfers ?? [])
                      .filter((t) => t !== d.transfer?.id)
                      .map((t) => (
                        <li key={t}>
                          <EntityLink type="transfer" id={t} />
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-muted">None.</p>
                )}
              </Panel>
              <Panel title="Counterparties">
                {(a.related?.counterparties ?? []).length ? (
                  <ul className="space-y-2 text-[13px]">
                    {(a.related?.counterparties ?? []).map((w) => (
                      <li key={w}>
                        <WalletRef id={w} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-muted">None recorded.</p>
                )}
              </Panel>
            </div>
            {d.transfer && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-inner bg-surface-2 px-4 py-3">
                <span className="text-[13px] text-text-2">
                  {humanize(d.transfer.type)} · <StatusChip status={d.transfer.status} /> · <Country code={d.transfer.sender_country} /> → <Country code={d.transfer.recipient_country} /> ·{" "}
                  <When at={d.transfer.created_at} />
                </span>
                <Link href={`/admin/transactions/${d.transfer.id}/trace`} className="inline-flex h-8 items-center rounded-full bg-lemon px-3.5 text-[12.5px] font-medium text-lemon-ink hover:brightness-95">
                  Trace funds
                </Link>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Subject" subtitle="Current profile summary. Date of birth is masked to the year; unmask on the profile if needed." />
            {d.subject ? (
              <>
                <KV
                  cols={1}
                  items={Object.entries(d.subject)
                    .filter(([k, v]) => !["object", "id"].includes(k) && (typeof v !== "object" || v === null))
                    .slice(0, 10)
                    .map(([k, v]) => [
                      humanize(k),
                      k === "country" ? (
                        <Country key={k} code={v as string} />
                      ) : k === "status" ? (
                        <StatusChip key={k} status={String(v)} />
                      ) : k === "date_of_birth" ? (
                        maskDob(v as string | null)
                      ) : (
                        String(v ?? "—")
                      ),
                    ])}
                />
                <div className="mt-4">
                  <EntityLink type={a.subject_type} id={a.subject_id}>
                    Open {a.subject_type === "user" ? "user profile" : "merchant"}
                  </EntityLink>
                </div>
              </>
            ) : (
              <p className="text-[13px] text-muted">Subject not found.</p>
            )}
          </Card>
          <Card>
            <CardHeader title="Rule" subtitle={d.rule ? d.rule.description : a.type === "aml" ? "" : "Raised by screening, not a monitoring rule."} />
            <KV
              cols={2}
              items={[
                ["Rule", <Mono key="k">{a.rule_key}</Mono>],
                ["Version at alert", a.rule_version || "—"],
                ["Current version", d.rule?.version ?? "—"],
                ["Action", d.rule ? <Chip key="a" tone={d.rule.action === "hold" ? "peach" : "neutral"}>{d.rule.action}</Chip> : null],
              ]}
            />
            {Object.keys(ruleParams).length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-[12px] text-muted">Parameters at alert time{ruleChanged ? " (rule has changed since)" : ""}</div>
                <ul className="space-y-1 text-[13px]">
                  {Object.entries(ruleParams).map(([k, v]) => (
                    <li key={k} className="flex justify-between gap-3">
                      <Mono>{k}</Mono>
                      <span className="numeral text-text">
                        {v.toLocaleString()}
                        {currentParams[k] !== undefined && currentParams[k] !== v && <span className="ml-2 text-[11.5px] text-peach-ink">now {currentParams[k].toLocaleString()}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
          {a.conclusion && (
            <Card>
              <CardHeader title="Conclusion" />
              <KV
                cols={1}
                items={[
                  ["Outcome", <StatusChip key="o" status={a.conclusion} />],
                  ["Reasoning", a.conclusion_note],
                  ["By", <Person key="p" id={a.resolved_by} />],
                  ["When", <When key="w" at={a.resolved_at} />],
                ]}
              />
            </Card>
          )}
        </div>
      </div>

      <ReasonDialog
        open={conclude}
        onClose={() => setConclude(false)}
        title="Conclude this alert"
        label="Reasoning"
        placeholder="What you reviewed and why you reached this conclusion (at least 10 characters)."
        confirmLabel={conclusion === "TRUE_MATCH" && screeningType ? "Request confirmation" : "Record conclusion"}
        description={
          conclusion === "TRUE_MATCH" && screeningType ? (
            <>
              Confirming a sanctions or PEP match is a four-eyes decision: this creates an approval request. Once a <b>different</b> reviewer approves, the account is frozen and any held
              funds are blocked per policy.
            </>
          ) : conclusion === "FALSE_POSITIVE" ? (
            "The alert is closed as a false positive; a linked screening check is marked reviewed."
          ) : conclusion === "TRUE_MATCH" ? (
            "The pattern is confirmed as genuinely unusual and the alert is escalated. Consider opening a case to decide on next steps."
          ) : (
            "The alert is resolved without a firm conclusion. Use this when evidence is insufficient either way."
          )
        }
        onSubmit={async (note) => {
          const r = await guard(() => adminApi<Alert | Approval>(`/alerts/${a.id}/conclude`, { body: { conclusion, note } }));
          if (r.object === "approval_request") {
            setOutcome({
              tone: "sky",
              text: (
                <>
                  Approval request created. The match is confirmed only after a different reviewer approves it in <Link className="underline" href="/admin/approvals">Approvals</Link>.
                </>
              ),
            });
          } else setOutcome({ tone: "sage", text: `Recorded: ${humanize(conclusion)}.` });
          reload();
        }}
      >
        <Field label="Conclusion">
          <Select value={conclusion} onChange={(e) => setConclusion(e.target.value)}>
            <option value="FALSE_POSITIVE">False positive — explained, no concern</option>
            <option value="TRUE_MATCH">{screeningType ? "True match — request confirmation" : "True match — pattern confirmed"}</option>
            <option value="INCONCLUSIVE">Inconclusive</option>
          </Select>
        </Field>
      </ReasonDialog>
      <OpenCaseDialog alerts={[a]} open={caseOpen} onClose={() => setCaseOpen(false)} />
    </>
  );
}

/** Looks up the matched list entry so reviewers can compare date of birth and country side by side. */
function useListedEntry(entryId: string | null) {
  const lists = useAdminQuery<ListResponse<ScreeningList>>(entryId ? "/screening/lists" : null);
  const listId = lists.data?.data[0]?.id ?? null;
  const entries = useAdminQuery<ListResponse<ScreeningEntry>>(entryId && listId ? `/screening/lists/${listId}/entries` : null);
  return entries.data?.data.find((e) => e.id === entryId) ?? null;
}

function Reason({ r, alert }: { r: AlertReason; alert: Alert }) {
  const hasNumbers = typeof r.observed === "number" && typeof r.threshold === "number";
  const money = r.code === "amount" || r.code === "pass_through";
  const fmt = (v: number) => (money && alert.currency ? <Amount minor={v} currency={alert.currency} size="sm" /> : <span className="numeral text-[17px]">{v.toLocaleString()}</span>);
  const extras = Object.entries(r).filter(([k]) => !["code", "text", "observed", "threshold"].includes(k));
  return (
    <li className="rounded-inner bg-surface-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-[14px] text-text">{r.text}</p>
        <Chip>{humanize(r.code)}</Chip>
      </div>
      {hasNumbers && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-[14px] bg-surface px-3.5 py-2.5">
            <div className="text-[11.5px] text-muted">Observed</div>
            {fmt(r.observed as number)}
          </div>
          <div className="rounded-[14px] bg-surface px-3.5 py-2.5">
            <div className="text-[11.5px] text-muted">Threshold</div>
            {fmt(r.threshold as number)}
          </div>
        </div>
      )}
      {extras.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
          {extras.map(([k, v]) => (
            <span key={k}>
              {humanize(k)}: <span className="text-text-2">{String(v)}</span>
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
