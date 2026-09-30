"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, Chip, Empty, PageHeader, StatusChip, Table } from "@/components/ui";
import { qs, usePagedList } from "@/components/admin/data";
import { EntityLink, FilterBar, FilterSelect, Loadable, Pager, Person, SlaChip, When, humanize } from "@/components/admin/kit";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import type { ComplianceCase } from "@/components/admin/types";

export default function CasesPage() {
  return (
    <Guard perm="admin.aml.read">
      <Cases />
    </Guard>
  );
}

function Cases() {
  const router = useRouter();
  const { me } = useAdmin();
  const [status, setStatus] = useState("open");
  const [mine, setMine] = useState("");
  const list = usePagedList<ComplianceCase>(`/cases${qs({ status, assigned_to: mine === "me" ? me?.user.id : "" })}`, 50);

  return (
    <>
      <PageHeader
        eyebrow="Financial crime"
        title="Cases"
        subtitle="Investigations with their evidence, notes and decisions. SLA due dates follow priority: critical 1 day, high 3, medium 7, low 14."
      />
      <Card>
        <FilterBar>
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "open", label: "Open (not closed)" },
              { value: "", label: "All" },
              { value: "OPEN", label: "New" },
              { value: "IN_REVIEW", label: "In review" },
              { value: "ACTION_REQUIRED", label: "Waiting for information" },
              { value: "ESCALATED", label: "Escalated" },
              { value: "CLOSED", label: "Closed" },
            ]}
          />
          <FilterSelect
            label="Assignee"
            value={mine}
            onChange={setMine}
            options={[
              { value: "", label: "Anyone" },
              { value: "me", label: "Assigned to me" },
            ]}
          />
        </FilterBar>
        <Loadable q={list}>
          {() => (
            <>
              <Table
                rows={list.rows}
                rowKey={(r) => r.id}
                onRowClick={(r) => router.push(`/admin/cases/${r.id}`)}
                empty={<Empty title="No cases">Nothing matches these filters.</Empty>}
                columns={[
                  {
                    key: "t",
                    header: "Case",
                    render: (r) => (
                      <div>
                        <div className="text-text">{r.title}</div>
                        <div className="mt-1 flex items-center gap-1.5">
                          <Chip>{humanize(r.type)}</Chip>
                          {r.legal_hold && <Chip tone="sky">Legal hold</Chip>}
                          {r.confidential && <Chip tone="neutral">Confidential</Chip>}
                        </div>
                      </div>
                    ),
                  },
                  { key: "s", header: "Subject", render: (r) => (r.subject_type === "user" ? <Person id={r.subject_id} /> : <EntityLink type={r.subject_type} id={r.subject_id} />) },
                  { key: "p", header: "Priority", render: (r) => <StatusChip status={r.priority} /> },
                  { key: "st", header: "Status", render: (r) => <StatusChip status={r.status} /> },
                  { key: "sla", header: "SLA", render: (r) => <SlaChip due={r.due_at} closed={r.status === "CLOSED"} /> },
                  { key: "a", header: "Assignee", render: (r) => <Person id={r.assigned_to} /> },
                  { key: "u", header: "Updated", render: (r) => <When at={r.updated_at} rel /> },
                ]}
              />
              <Pager page={list.page} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
            </>
          )}
        </Loadable>
      </Card>
    </>
  );
}
