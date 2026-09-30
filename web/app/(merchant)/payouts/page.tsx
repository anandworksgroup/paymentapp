"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { date } from "@/lib/format";
import { useApi, useCursorList } from "@/lib/merchant/hooks";
import type { Balance, Payout } from "@/lib/merchant/types";
import { Amount, Button, Card, Chip, Empty, PageHeader, StatusChip, Table } from "@/components/ui";
import { useMerchant } from "@/components/merchant/context";
import { ListSkeleton, Loaded, NoAccess, Pager } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { CreatePayoutModal } from "@/components/merchant/finance/CreatePayoutModal";

export default function PayoutsPage() {
  const { can, org } = useMerchant();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const allowed = can("payouts.read");
  const list = useCursorList<Payout>(allowed ? "/v1/payouts" : null);
  const bal = useApi<Balance>(allowed && can("balance.read") ? "/v1/balance" : null);

  if (!allowed) return <NoAccess what="payouts" />;

  return (
    <>
      <PageHeader
        title="Payouts"
        subtitle="Money sent from your available balance to your bank account."
        actions={can("payouts.manage") && <Button icon={<Icon name="plus" size={16} />} onClick={() => setOpen(true)}>Create payout</Button>}
      />
      <Card>
        <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton />}>
          {() => (
            <>
              <Table
                rows={list.rows}
                rowKey={(p) => p.id}
                onRowClick={(p) => router.push(`/payouts/${p.id}`)}
                empty={
                  <Empty title="No payouts yet" icon={<Icon name="bank" />}>
                    Payouts are created automatically on your payout schedule, or manually from your available balance.
                  </Empty>
                }
                columns={[
                  { key: "amount", header: "Amount", render: (p) => <Amount minor={p.amount} currency={p.currency} size="sm" /> },
                  {
                    key: "status", header: "Status", render: (p) => (
                      <span className="flex flex-wrap items-center gap-1">
                        <StatusChip status={p.status} />
                        {p.hold_reason && <Chip tone="peach">{p.hold_reason}</Chip>}
                      </span>
                    ),
                  },
                  { key: "arrival", header: "Arrival", render: (p) => <span className="whitespace-nowrap text-text-2">{p.status === "PAID" && p.paid_at ? `Paid ${date(p.paid_at)}` : date(p.arrival_date)}</span> },
                  { key: "bank", header: "Bank", render: (p) => <span className="whitespace-nowrap text-text-2">{p.destination_last4 ? `•••• ${p.destination_last4}` : "—"}</span> },
                  { key: "type", header: "Type", render: (p) => <Chip tone={p.automatic ? "sky" : "neutral"}>{p.automatic ? "Automatic" : "Manual"}</Chip> },
                  { key: "created", header: "Created", align: "right", render: (p) => <span className="whitespace-nowrap text-muted">{date(p.created_at, true)}</span> },
                ]}
              />
              <Pager page={list.page} hasPrev={list.hasPrev} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
            </>
          )}
        </Loaded>
      </Card>
      {open && <CreatePayoutModal open onClose={() => setOpen(false)} onDone={list.reload} balances={bal.data?.balances} defaultCurrency={org.default_currency} />}
    </>
  );
}
