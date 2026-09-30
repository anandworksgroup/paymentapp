"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { List } from "@/lib/api";
import { relative, titleCase } from "@/lib/format";
import { useApi } from "@/lib/merchant/hooks";
import { Button, Card, Chip, Empty, PageHeader, Segmented, Table } from "@/components/ui";
import { Help, ListSkeleton, Loaded } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { NewTicketModal } from "@/components/merchant/ops/NewTicketModal";
import { TicketStatusChip } from "@/components/merchant/ops/shared";
import { TICKET_CATEGORIES, type SupportTicket } from "@/components/merchant/ops/types";

type Show = "active" | "awaiting_merchant" | "done" | "all";
const CATEGORY = Object.fromEntries(TICKET_CATEGORIES.map((c) => [c.value, c.label])) as Record<string, string>;

export default function SupportPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const list = useApi<List<SupportTicket>>("/v1/support/tickets");
  const [show, setShow] = useState<Show>("active");
  // ?new=1&related=pay_… opens the form prefilled (links from payment or invoice pages).
  const [creating, setCreating] = useState(params.get("new") === "1");
  const related = params.get("related") ?? undefined;

  const closeForm = () => {
    setCreating(false);
    if (params.get("new")) router.replace(pathname, { scroll: false });
  };

  const filter = (t: SupportTicket) =>
    show === "all" ? true : show === "active" ? t.status === "open" || t.status === "awaiting_merchant" : show === "done" ? t.status === "resolved" || t.status === "closed" : t.status === show;

  return (
    <>
      <PageHeader
        title="Support"
        subtitle="Ask our team about payments, tax, checkout or your account. Replies arrive here and in your notifications."
        actions={<Button icon={<Icon name="plus" size={16} />} onClick={() => setCreating(true)}>New ticket</Button>}
      />
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Segmented<Show>
            value={show}
            onChange={setShow}
            options={[
              { value: "active", label: "Open" },
              { value: "awaiting_merchant", label: "Awaiting you" },
              { value: "done", label: "Resolved & closed" },
              { value: "all", label: "All" },
            ]}
          />
          {list.data && list.data.data.some((t) => t.status === "awaiting_merchant") && (
            <Chip tone="peach">{list.data.data.filter((t) => t.status === "awaiting_merchant").length} waiting for your reply</Chip>
          )}
        </div>
        <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton rows={4} />}>
          {(l) => (
            <Table
              rows={l.data.filter(filter)}
              rowKey={(t) => t.id}
              onRowClick={(t) => router.push(`/support/${t.id}`)}
              empty={
                l.data.length ? (
                  <Empty title="Nothing here" icon={<Icon name="check" />}>No tickets match this filter.</Empty>
                ) : (
                  <Empty title="No support tickets" icon={<Icon name="help" />} action={<Button onClick={() => setCreating(true)}>Contact support</Button>}>
                    If something isn&apos;t working, open a ticket and our team will reply here.
                  </Empty>
                )
              }
              columns={[
                {
                  key: "subject", header: "Subject",
                  render: (t) => (
                    <span className="flex min-w-[220px] flex-col">
                      <span className="text-text">{t.subject}</span>
                      <span className="text-[12px] text-muted">{CATEGORY[t.category] ?? titleCase(t.category)}{t.related_object_id ? ` · ${t.related_object_id}` : ""}</span>
                    </span>
                  ),
                },
                { key: "priority", header: "Priority", render: (t) => (t.priority === "normal" ? <span className="text-muted">Normal</span> : <Chip tone={t.priority === "urgent" ? "rose" : "peach"}>{titleCase(t.priority)}</Chip>) },
                { key: "status", header: "Status", render: (t) => <TicketStatusChip status={t.status} /> },
                { key: "updated", header: "Last activity", align: "right", render: (t) => <span className="whitespace-nowrap text-muted">{relative(t.updated_at)}</span> },
              ]}
            />
          )}
        </Loaded>
        <div className="mt-4"><Help>Everyone in your organization can see and reply to these tickets. Support staff never ask for your password or full card numbers.</Help></div>
      </Card>
      {creating && (
        <NewTicketModal
          related={related}
          onClose={closeForm}
          onCreated={(t) => {
            setCreating(false);
            router.push(`/support/${t.id}`);
          }}
        />
      )}
    </>
  );
}
