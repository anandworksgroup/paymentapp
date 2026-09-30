"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { date, titleCase } from "@/lib/format";
import { useCursorList, qs } from "@/lib/merchant/hooks";
import type { Dispute } from "@/lib/merchant/types";
import { Amount, Card, Empty, PageHeader, Segmented, StatusChip, Table } from "@/components/ui";
import { useMerchant } from "@/components/merchant/context";
import { ListSkeleton, Loaded, NoAccess, Pager } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { DueChip } from "@/components/merchant/finance/DueChip";

type Status = "" | "needs_response" | "under_review" | "won" | "lost";
const STATUSES: { value: Status; label: string }[] = [
  { value: "", label: "All" },
  { value: "needs_response", label: "Needs response" },
  { value: "under_review", label: "Under review" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

export default function DisputesPage() {
  const { can } = useMerchant();
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get("status") ?? "";
  const [status, setStatus] = useState<Status>(STATUSES.some((s) => s.value === initial) ? (initial as Status) : "");
  const [now] = useState(() => Date.now());
  const allowed = can("disputes.read");
  const list = useCursorList<Dispute>(allowed ? `/v1/disputes${qs({ status })}` : null);

  if (!allowed) return <NoAccess what="disputes" />;
  const change = (s: Status) => {
    setStatus(s);
    router.replace(`/disputes${s ? `?status=${s}` : ""}`, { scroll: false });
  };

  return (
    <>
      <PageHeader
        title="Disputes"
        subtitle="When a customer's bank questions a payment. Respond with evidence before the deadline."
        actions={<Segmented<Status> value={status} onChange={change} options={STATUSES} />}
      />
      <Card>
        <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton />}>
          {() => (
            <>
              <Table
                rows={list.rows}
                rowKey={(d) => d.id}
                onRowClick={(d) => router.push(`/disputes/${d.id}`)}
                empty={
                  <Empty title={status ? `No ${titleCase(status).toLowerCase()} disputes` : "No disputes"} icon={<Icon name="scale" />}>
                    {status ? "Try another status." : "Nothing has been disputed. If a customer's bank opens a dispute, it will appear here with a deadline to respond."}
                  </Empty>
                }
                columns={[
                  { key: "amount", header: "Amount", render: (d) => <Amount minor={d.amount} currency={d.currency} size="sm" /> },
                  { key: "status", header: "Status", render: (d) => <StatusChip status={d.status} /> },
                  { key: "reason", header: "Reason", render: (d) => <span className="whitespace-nowrap text-text-2">{titleCase(d.reason)}</span> },
                  { key: "due", header: "Evidence due", render: (d) => <DueChip due={d.evidence_due_by} status={d.status} now={now} /> },
                  {
                    key: "payment", header: "Payment", render: (d) => (
                      <Link href={`/payments/${d.payment_id}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap font-mono text-[12px] underline-offset-4 hover:underline">
                        {d.payment_id}
                      </Link>
                    ),
                  },
                  { key: "opened", header: "Opened", align: "right", render: (d) => <span className="whitespace-nowrap text-muted">{date(d.created_at)}</span> },
                ]}
              />
              <Pager page={list.page} hasPrev={list.hasPrev} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
            </>
          )}
        </Loaded>
      </Card>
    </>
  );
}
