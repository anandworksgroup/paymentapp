"use client";

import { useState } from "react";
import { download } from "@/lib/api";
import { titleCase } from "@/lib/format";
import { useApi, useCursorList, qs } from "@/lib/merchant/hooks";
import type { Balance, BalanceTransaction } from "@/lib/merchant/types";
import { Button, Card, CardHeader, Empty, ErrorNote, PageHeader, Skeleton } from "@/components/ui";
import { useMerchant, useToast } from "@/components/merchant/context";
import { FilterBar, FilterSelect, ListSkeleton, Loaded, NoAccess, Pager } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { BalanceHero } from "@/components/merchant/finance/BalanceHero";
import { BALANCE_TX_TYPES, BalanceTxTable } from "@/components/merchant/finance/BalanceTxTable";
import { BusinessWalletCard } from "@/components/merchant/finance/BusinessWallet";
import { CreatePayoutModal } from "@/components/merchant/finance/CreatePayoutModal";

export default function BalancePage() {
  const { can, org } = useMerchant();
  const toast = useToast();
  const [type, setType] = useState("");
  const [payoutOpen, setPayoutOpen] = useState(false);
  const allowed = can("balance.read");
  const bal = useApi<Balance>(allowed ? "/v1/balance" : null);
  const list = useCursorList<BalanceTransaction>(allowed ? `/v1/balance_transactions${qs({ type })}` : null);

  if (!allowed) return <NoAccess what="your balance" />;
  const reload = () => {
    bal.reload();
    list.reload();
  };

  return (
    <>
      <PageHeader
        title="Balance"
        subtitle="What you've earned, what's settling and what you can pay out. Every figure comes from the ledger."
        actions={
          <>
            {can("reports.read") && (
              <Button variant="soft" icon={<Icon name="download" size={16} />} onClick={() => download("/v1/reports/balance_transactions.csv", "balance_transactions.csv").catch(() => toast("Export failed", "error"))}>
                Export CSV
              </Button>
            )}
            {can("payouts.manage") && (
              <Button icon={<Icon name="bank" size={16} />} onClick={() => setPayoutOpen(true)} disabled={!bal.data}>Create payout</Button>
            )}
          </>
        }
      />

      <section aria-label="Balances by currency" className="mb-5 space-y-4">
        {bal.data ? (
          bal.data.balances.length ? (
            bal.data.balances.map((row) => <BalanceHero key={row.currency} row={row} />)
          ) : (
            <Card><Empty title="No balance yet" icon={<Icon name="wallet" />}>Your balance appears here after your first successful payment.</Empty></Card>
          )
        ) : bal.error ? (
          <div aria-live="assertive" className="space-y-3"><ErrorNote error={bal.error} /><Button size="sm" variant="soft" onClick={bal.reload}>Try again</Button></div>
        ) : (
          <Skeleton className="h-[200px] rounded-card" />
        )}
      </section>

      {can("wallet.read") && (
        <div className="mb-5">
          <BusinessWalletCard balances={bal.data?.balances} defaultCurrency={org.default_currency} onMoved={reload} />
        </div>
      )}

      <Card>
        <CardHeader title="Balance transactions" subtitle="Every movement of your balance: amount, fee, net and when it becomes available." />
        <FilterBar>
          <FilterSelect label="Type" value={type} onChange={setType} options={[{ value: "", label: "All types" }, ...BALANCE_TX_TYPES.map((t) => ({ value: t, label: titleCase(t) }))]} />
        </FilterBar>
        <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton />}>
          {() => (
            <>
              <BalanceTxTable
                rows={list.rows}
                empty={
                  <Empty title={type ? `No ${titleCase(type).toLowerCase()} transactions` : "No balance transactions yet"}>
                    {type ? "Try another type." : "Payments, refunds, disputes and payouts will show up here as they move your balance."}
                  </Empty>
                }
              />
              <Pager page={list.page} hasPrev={list.hasPrev} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
            </>
          )}
        </Loaded>
      </Card>

      {payoutOpen && (
        <CreatePayoutModal open onClose={() => setPayoutOpen(false)} onDone={reload} balances={bal.data?.balances} defaultCurrency={org.default_currency} />
      )}
    </>
  );
}
