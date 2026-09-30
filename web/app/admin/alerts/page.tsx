"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Amount, Button, Card, Chip, Empty, PageHeader, StatusChip, Table } from "@/components/ui";
import { qs, usePagedList } from "@/components/admin/data";
import { EntityLink, FilterBar, FilterSelect, Loadable, Mono, Pager, Person, ReadOnlyNote, When, humanize } from "@/components/admin/kit";
import { OpenCaseDialog } from "@/components/admin/open-case";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import type { Alert } from "@/components/admin/types";

const STATUS = [
  { value: "open", label: "Open (new, queued, in review, escalated)" },
  { value: "", label: "All statuses" },
  { value: "NEW", label: "New" },
  { value: "IN_REVIEW", label: "In review" },
  { value: "ESCALATED", label: "Escalated" },
  { value: "FALSE_POSITIVE", label: "False positive" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
  { value: "REPORTED", label: "Reported" },
];

export default function AlertsPage() {
  return (
    <Guard perm="admin.aml.read">
      <Alerts />
    </Guard>
  );
}

function Alerts() {
  const router = useRouter();
  const params = useSearchParams();
  const { can, me } = useAdmin();
  const [status, setStatus] = useState(params.get("status") ?? "open");
  const [type, setType] = useState(params.get("type") ?? "");
  const [severity, setSeverity] = useState(params.get("severity") ?? "");
  const [mine, setMine] = useState("");
  const [selected, setSelected] = useState<Record<string, Alert>>({});
  const [caseOpen, setCaseOpen] = useState(false);
  const list = usePagedList<Alert>(`/alerts${qs({ status, type, severity })}`, 50);
  const myId = me?.user.id;
  const rows = list.rows.filter((a) => !mine || (mine === "me" ? a.assigned_to === myId : !a.assigned_to));
  const picked = Object.values(selected);
  const write = can("admin.aml.write");

  return (
    <>
      <PageHeader
        eyebrow="Financial crime · investigation queue"
        title="Alerts"
        subtitle="Signals from transaction monitoring and screening. Each one is a prompt for review — not a finding about the customer."
        actions={
          write ? (
            <Button onClick={() => setCaseOpen(true)} disabled={picked.length === 0}>
              Open case from {picked.length || ""} selected
            </Button>
          ) : (
            <ReadOnlyNote>Read-only: working alerts needs admin.aml.write</ReadOnlyNote>
          )
        }
      />
      <Card>
        <FilterBar>
          <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS} />
          <FilterSelect
            label="Type"
            value={type}
            onChange={setType}
            options={[
              { value: "", label: "All types" },
              { value: "aml", label: "Transaction monitoring" },
              { value: "sanctions", label: "Sanctions screening" },
              { value: "pep", label: "PEP screening" },
              { value: "fraud", label: "Fraud" },
            ]}
          />
          <FilterSelect
            label="Severity"
            value={severity}
            onChange={setSeverity}
            options={[{ value: "", label: "Any severity" }, ...["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => ({ value: s, label: humanize(s) }))]}
          />
          <FilterSelect
            label="Assignee"
            value={mine}
            onChange={setMine}
            options={[
              { value: "", label: "Anyone" },
              { value: "me", label: "Assigned to me" },
              { value: "none", label: "Unassigned" },
            ]}
          />
        </FilterBar>
        <Loadable q={list}>
          {() => (
            <>
              <Table
                rows={rows}
                rowKey={(r) => r.id}
                onRowClick={(r) => router.push(`/admin/alerts/${r.id}`)}
                empty={<Empty title="Queue is clear">No alerts match these filters.</Empty>}
                columns={[
                  ...(write
                    ? [
                        {
                          key: "sel",
                          header: "",
                          render: (r: Alert) => (
                            <input
                              type="checkbox"
                              aria-label="Select alert"
                              className="h-4 w-4 accent-[var(--ink)]"
                              checked={!!selected[r.id]}
                              disabled={!!r.case_id}
                              title={r.case_id ? "Already linked to a case" : "Select to open a case"}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                setSelected((s) => {
                                  const n = { ...s };
                                  if (e.target.checked) n[r.id] = r;
                                  else delete n[r.id];
                                  return n;
                                })
                              }
                            />
                          ),
                        },
                      ]
                    : []),
                  {
                    key: "type",
                    header: "Type",
                    className: "min-w-[240px]",
                    render: (r) => (
                      <div>
                        <div className="text-text">{r.summary}</div>
                        <Chip tone={r.type === "sanctions" || r.type === "pep" ? "rose" : "neutral"} className="mt-1">
                          {r.type === "aml" ? "monitoring" : r.type}
                        </Chip>
                      </div>
                    ),
                  },
                  { key: "sev", header: "Severity", render: (r) => <StatusChip status={r.severity} /> },
                  { key: "subj", header: "Subject", render: (r) => (r.subject_type === "user" ? <Person id={r.subject_id} /> : <EntityLink type={r.subject_type} id={r.subject_id} />) },
                  { key: "amt", header: "Amount", align: "right", render: (r) => (r.amount != null && r.currency ? <Amount minor={r.amount} currency={r.currency} size="sm" /> : <span className="text-faint">—</span>) },
                  { key: "rule", header: "Rule", render: (r) => <Mono>{r.rule_key}{r.rule_version ? ` v${r.rule_version}` : ""}</Mono> },
                  { key: "at", header: "Created", render: (r) => <When at={r.created_at} /> },
                  { key: "asg", header: "Assignee", render: (r) => <Person id={r.assigned_to} /> },
                  {
                    key: "st",
                    header: "Status",
                    render: (r) => (
                      <span className="inline-flex flex-col items-start gap-1">
                        <StatusChip status={r.status} />
                        {r.case_id && <EntityLink type="case" id={r.case_id} className="text-[11.5px]">in case</EntityLink>}
                      </span>
                    ),
                  },
                ]}
              />
              <Pager page={list.page} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
            </>
          )}
        </Loadable>
      </Card>
      <OpenCaseDialog alerts={picked} open={caseOpen} onClose={() => setCaseOpen(false)} />
    </>
  );
}
