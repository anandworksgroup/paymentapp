"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, Card, Chip, Empty, PageHeader, Stat, Table } from "@/components/ui";
import { qs, useAdminQuery } from "@/components/admin/data";
import { EntityLink, FilterBar, FilterInput, FilterSelect, IdTag, Loadable, Num, Person, Tabs, When } from "@/components/admin/kit";
import { PriorityChip, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, TicketStatusChip } from "@/components/admin/ops";
import type { TicketRow } from "@/components/admin/ops-types";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import type { ListResponse } from "@/components/admin/types";

type StatusTab = "" | "open" | "awaiting_merchant" | "resolved" | "closed";
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2 };

export default function SupportPage() {
  return (
    <Guard perm="admin.support">
      <SupportQueue />
    </Guard>
  );
}

function SupportQueue() {
  const router = useRouter();
  const params = useSearchParams();
  const { me } = useAdmin();
  const fromUrl = params.get("status") ?? "open";
  const [status, setStatus] = useState<StatusTab>(
    fromUrl === "all" ? "" : (TICKET_STATUSES.map((s) => s.value) as string[]).includes(fromUrl) ? (fromUrl as StatusTab) : "open",
  );
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [text, setText] = useState("");

  // All tickets for the counts; the list itself is filtered by status on the server.
  const all = useAdminQuery<ListResponse<TicketRow>>("/support/tickets");
  const list = useAdminQuery<ListResponse<TicketRow>>(`/support/tickets${qs({ status })}`);
  const counts = (s: string) => (all.data ? all.data.data.filter((r) => r.ticket.status === s).length : undefined);
  const unassigned = all.data?.data.filter((r) => !r.ticket.assigned_to && (r.ticket.status === "open" || r.ticket.status === "awaiting_merchant")).length;
  const urgent = all.data?.data.filter((r) => r.ticket.status === "open" && r.ticket.priority !== "normal").length;

  const select = (s: StatusTab) => {
    setStatus(s);
    router.replace(`/admin/support${qs({ status: s || "all" })}`, { scroll: false });
  };
  const reload = () => {
    all.reload();
    list.reload();
  };

  return (
    <>
      <PageHeader
        eyebrow="Merchant support"
        title="Support"
        subtitle="Tickets raised by merchants from their dashboard. Replies notify the merchant; internal notes stay with staff."
        actions={
          <Button variant="soft" size="sm" onClick={reload} loading={list.loading && !!list.data}>
            Refresh
          </Button>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open" chip={urgent ? <Chip tone="peach">{urgent} high or urgent</Chip> : undefined} onClick={() => select("open")}>
          <Num value={counts("open")} />
        </Stat>
        <Stat label="Awaiting merchant" onClick={() => select("awaiting_merchant")}>
          <Num value={counts("awaiting_merchant")} />
        </Stat>
        <Stat label="Unassigned (active)">
          <Num value={unassigned} />
        </Stat>
        <Stat label="Resolved" onClick={() => select("resolved")}>
          <Num value={counts("resolved")} />
        </Stat>
      </div>
      <Tabs
        value={status}
        onChange={select}
        tabs={[
          ...TICKET_STATUSES.map((s) => ({ value: s.value as StatusTab, label: s.label, count: counts(s.value) })),
          { value: "" as StatusTab, label: "All", count: all.data?.data.length },
        ]}
      />
      <Card>
        <FilterBar>
          <FilterSelect label="Priority" value={priority} onChange={setPriority} options={[{ value: "", label: "Any priority" }, ...TICKET_PRIORITIES.map((p) => ({ value: p.value, label: p.label }))]} />
          <FilterSelect
            label="Assignee"
            value={assignee}
            onChange={setAssignee}
            options={[
              { value: "", label: "Anyone" },
              { value: "me", label: "Assigned to me" },
              { value: "none", label: "Unassigned" },
            ]}
          />
          <FilterInput label="Filter" value={text} onChange={setText} placeholder="Subject, merchant or id" width="w-60" />
        </FilterBar>
        <Loadable q={list}>
          {(d) => {
            const needle = text.trim().toLowerCase();
            const rows = d.data
              .filter((r) => !priority || r.ticket.priority === priority)
              .filter((r) => (assignee === "me" ? r.ticket.assigned_to === me?.user.id : assignee === "none" ? !r.ticket.assigned_to : true))
              .filter(
                (r) =>
                  !needle ||
                  r.ticket.subject.toLowerCase().includes(needle) ||
                  (r.organization ?? "").toLowerCase().includes(needle) ||
                  r.ticket.id === text.trim() ||
                  r.ticket.org_id === text.trim(),
              )
              // Urgent first, then most recently updated (the API already orders by updated_at).
              .sort((a, b) => (PRIORITY_RANK[a.ticket.priority] ?? 3) - (PRIORITY_RANK[b.ticket.priority] ?? 3));
            return (
              <>
                <Table
                  rows={rows}
                  rowKey={(r) => r.ticket.id}
                  onRowClick={(r) => router.push(`/admin/support/${r.ticket.id}`)}
                  empty={
                    <Empty title={d.data.length ? "No tickets match these filters" : status ? "Nothing in this queue" : "No tickets yet"}>
                      {d.data.length ? "Try another priority or assignee filter." : "New merchant tickets appear here as soon as they are raised."}
                    </Empty>
                  }
                  columns={[
                    {
                      key: "subject",
                      header: "Ticket",
                      render: (r) => (
                        <div className="min-w-0 max-w-[420px]">
                          <div className="truncate font-medium text-text">{r.ticket.subject}</div>
                          <div className="mt-0.5 flex items-center gap-2">
                            <span className="text-[12px] text-muted">{TICKET_CATEGORIES[r.ticket.category] ?? r.ticket.category}</span>
                            <IdTag id={r.ticket.id} />
                          </div>
                        </div>
                      ),
                    },
                    { key: "org", header: "Merchant", render: (r) => <EntityLink type="org" id={r.ticket.org_id}>{r.organization ?? undefined}</EntityLink> },
                    { key: "priority", header: "Priority", render: (r) => <PriorityChip priority={r.ticket.priority} /> },
                    { key: "status", header: "Status", render: (r) => <TicketStatusChip status={r.ticket.status} /> },
                    { key: "assignee", header: "Assignee", render: (r) => <Person id={r.ticket.assigned_to} /> },
                    { key: "updated", header: "Last activity", render: (r) => <When at={r.ticket.updated_at} rel /> },
                  ]}
                />
                {d.data.length >= 200 && <p className="mt-3 text-[12px] text-muted">Showing the 200 most recently updated tickets in this queue.</p>}
              </>
            );
          }}
        </Loadable>
      </Card>
    </>
  );
}
