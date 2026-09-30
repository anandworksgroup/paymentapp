"use client";

import { useState } from "react";
import { useApi, qs } from "@/lib/merchant/hooks";
import type { Balance } from "@/lib/merchant/types";
import { Card, PageHeader, Skeleton } from "@/components/ui";
import { useMerchant } from "@/components/merchant/context";
import { FilterBar, FilterSelect, Loaded, NoAccess } from "@/components/merchant/common";
import { StatementView } from "@/components/merchant/finance/StatementView";
import type { Statement } from "@/components/merchant/finance/types";

function lastTwelveMonths() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return {
      value: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }) + (i === 0 ? " (to date)" : ""),
    };
  });
}

export default function StatementsPage() {
  const { can, org } = useMerchant();
  const allowed = can("reports.read");
  const [months] = useState(lastTwelveMonths);
  const [month, setMonth] = useState(() => months[0].value);
  const [currency, setCurrency] = useState(org.default_currency);
  const bal = useApi<Balance>(allowed && can("balance.read") ? "/v1/balance" : null);
  const res = useApi<Statement>(allowed ? `/v1/statements${qs({ month, currency })}` : null);

  if (!allowed) return <NoAccess what="statements" />;
  const currencies = Array.from(new Set([org.default_currency, ...(bal.data?.balances.map((b) => b.currency) ?? [])]));

  return (
    <>
      <PageHeader
        title="Statements"
        subtitle="A monthly summary of your balance: where you started, what moved and where you ended, straight from the ledger."
      />
      <FilterBar>
        <FilterSelect label="Month" value={month} onChange={setMonth} options={months} />
        <FilterSelect label="Currency" value={currency} onChange={setCurrency} options={currencies.map((c) => ({ value: c, label: c }))} />
      </FilterBar>
      <Loaded
        data={res.data}
        error={res.error}
        onRetry={res.reload}
        skeleton={
          <div className="space-y-4">
            <Skeleton className="h-16" />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3"><Skeleton className="h-48 rounded-card" /><Skeleton className="h-72 rounded-card" /><Skeleton className="h-48 rounded-card" /></div>
          </div>
        }
      >
        {(s) => <StatementView s={s} />}
      </Loaded>
      <Card className="mt-5" pad={false}>
        <p className="px-6 py-4 text-[12.5px] leading-relaxed text-muted">
          Balances include available, pending and reserved funds. Amounts are shown exactly as the ledger reports them; nothing on this page is recalculated in your browser.
        </p>
      </Card>
    </>
  );
}
