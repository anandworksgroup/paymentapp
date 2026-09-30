"use client";

import { useState } from "react";
import type { List } from "@/lib/api";
import { useApi } from "@/lib/merchant/hooks";
import type { PayoutDestination } from "@/lib/merchant/types";
import { Button, Card, CardHeader, Chip, Empty, PageHeader, StatusChip } from "@/components/ui";
import { date } from "@/lib/format";
import { useMerchant } from "@/components/merchant/context";
import { FlagAvatar, Help, ListSkeleton, Loaded, NoAccess } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { AddDestinationModal } from "@/components/merchant/settings/AddDestinationModal";
import { SettingsNav } from "@/components/merchant/settings/shared";

export default function PayoutAccountsPage() {
  const { can } = useMerchant();
  const allowed = can("payouts.read");
  const canAdd = can("payouts.destination");
  const list = useApi<List<PayoutDestination>>(allowed ? "/v1/payout_destinations" : null);
  const [adding, setAdding] = useState(false);

  if (!allowed) return <NoAccess what="payout accounts" />;

  return (
    <>
      <PageHeader
        title="Payout accounts"
        subtitle="Bank accounts your balance is paid out to, one default per currency."
        actions={canAdd && <Button icon={<Icon name="plus" size={16} />} onClick={() => setAdding(true)}>Add bank account</Button>}
      />
      <SettingsNav current="/settings/payout-accounts" />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader title="Bank accounts" />
          <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton rows={3} />}>
            {(l) =>
              l.data.length ? (
                <ul className="space-y-2">
                  {l.data.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-4 rounded-inner bg-surface-2 px-4 py-4">
                      <FlagAvatar country={d.bank_country} size={40} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[15px] text-text">{d.bank_name ?? "Bank account"}</span>
                          <span className="font-mono text-[13px] text-text-2">••••{d.last4}</span>
                          {d.is_default && <Chip tone="lemon">Default · {d.currency}</Chip>}
                        </div>
                        <div className="mt-0.5 text-[12.5px] text-muted">
                          {d.account_holder} · {d.currency} · {d.bank_country}
                          {d.routing_number ? ` · routing ${d.routing_number}` : ""}
                          {d.swift ? ` · ${d.swift}` : ""}
                          {` · added ${date(d.created_at)}`}
                        </div>
                      </div>
                      <StatusChip status={d.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty title="No bank account yet" icon={<Icon name="bank" />} action={canAdd ? <Button onClick={() => setAdding(true)}>Add bank account</Button> : undefined}>
                  Add the account you want your earnings paid into. It&apos;s one of the steps before you can go live.
                </Empty>
              )
            }
          </Loaded>
        </Card>
        <Card className="lemon-gradient">
          <CardHeader title="Keeping payouts safe" />
          <ul className="space-y-3 text-[13px] text-text-2">
            <li className="flex gap-2"><Icon name="lock" size={16} className="mt-0.5 shrink-0" /> Only the account owner can add a bank account, and must confirm their password first.</li>
            <li className="flex gap-2"><Icon name="shield" size={16} className="mt-0.5 shrink-0" /> Every change is written to the audit log and recorded as a security event.</li>
            <li className="flex gap-2"><Icon name="bank" size={16} className="mt-0.5 shrink-0" /> Account numbers are stored encrypted; only the last four digits are ever shown.</li>
          </ul>
          {!canAdd && <div className="mt-4"><Help>Your role can view payout accounts but not change them. Ask the organization owner.</Help></div>}
        </Card>
      </div>
      {adding && <AddDestinationModal onClose={() => setAdding(false)} onDone={list.reload} />}
    </>
  );
}
