"use client";

import { useState } from "react";
import { date, flag } from "@/lib/format";
import { useApi, useCursorList, qs } from "@/lib/merchant/hooks";
import { fixText } from "@/lib/merchant/text";
import type { TaxRecord } from "@/lib/merchant/types";
import { Card, CardHeader, Chip, PageHeader, Segmented, Skeleton } from "@/components/ui";
import { useMerchant } from "@/components/merchant/context";
import { ListSkeleton, Loaded, NoAccess, Pager } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { JurisdictionTable, TaxRecordsTable } from "@/components/merchant/finance/TaxViews";
import type { TaxSummary } from "@/components/merchant/finance/types";

type Period = "month" | "last_month" | "quarter" | "ytd" | "all";

function rangeFor(p: Period): { period: Period; from?: string; to?: string } {
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const utc = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 1)).toISOString();
  switch (p) {
    case "month": return { period: p, from: utc(y, m) };
    case "last_month": return { period: p, from: utc(y, m - 1), to: utc(y, m) };
    case "quarter": return { period: p, from: utc(y, m - (m % 3)) };
    case "ytd": return { period: p, from: utc(y, 0) };
    default: return { period: p };
  }
}

export default function TaxPage() {
  const { can } = useMerchant();
  const allowed = can("tax.read");
  const [range, setRange] = useState(() => rangeFor("quarter"));
  const summary = useApi<TaxSummary>(allowed ? `/v1/tax/summary${qs({ from: range.from, to: range.to })}` : null);
  const records = useCursorList<TaxRecord>(allowed ? "/v1/tax/records" : null);

  if (!allowed) return <NoAccess what="tax reports" />;
  const periodText = range.from ? `${date(range.from)} – ${range.to ? date(new Date(new Date(range.to).getTime() - 1).toISOString()) : "today"}` : "All time";

  return (
    <>
      <PageHeader
        title="Tax"
        subtitle="Sales tax, VAT and GST collected on your sales."
        actions={
          <Segmented<Period>
            value={range.period}
            onChange={(p) => setRange(rangeFor(p))}
            options={[
              { value: "month", label: "This month" },
              { value: "last_month", label: "Last month" },
              { value: "quarter", label: "Quarter" },
              { value: "ytd", label: "Year" },
              { value: "all", label: "All" },
            ]}
          />
        }
      />

      <div className="mb-5 flex items-start gap-4 rounded-card lemon-gradient p-6 shadow-card">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/70 text-lemon-ink"><Icon name="shield" /></span>
        <div className="min-w-0">
          <h2 className="text-[17px] font-normal text-text">The platform files and remits these taxes for you</h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-text-2">
            {summary.data ? fixText(summary.data.note) : "As Merchant of Record, the platform is the seller to your customers, so it calculates, collects, files and remits the tax."}
          </p>
          <p className="mt-1 text-[12.5px] text-muted">You don&apos;t need to register or file in these jurisdictions for sales made through the platform. Tax is never part of your balance or payouts.</p>
        </div>
      </div>

      <Card className="mb-5">
        <CardHeader title="By jurisdiction" subtitle={periodText} />
        <Loaded data={summary.data} error={summary.error} onRetry={summary.reload} skeleton={<ListSkeleton rows={5} />}>
          {(s) => (
            <>
              <JurisdictionTable rows={s.by_jurisdiction} registrations={s.registrations} />
              {s.registrations.length > 0 && (
                <div className="mt-5">
                  <div className="mb-2 text-[12.5px] text-muted">Platform tax registrations</div>
                  <div className="flex flex-wrap gap-1.5">
                    {s.registrations.map((c) => <Chip key={c} tone="neutral"><span aria-hidden>{flag(c)}</span> {c}</Chip>)}
                  </div>
                </div>
              )}
            </>
          )}
        </Loaded>
      </Card>

      <Card>
        <CardHeader title="Tax records" subtitle="Every taxable sale, invoice and refund, newest first, traceable to its invoice or order" />
        <Loaded data={records.data} error={records.error} onRetry={records.reload} skeleton={summary.data ? <ListSkeleton /> : <Skeleton className="h-64" />}>
          {() => (
            <>
              <TaxRecordsTable rows={records.rows} />
              <Pager page={records.page} hasPrev={records.hasPrev} hasMore={records.hasMore} onPrev={records.prev} onNext={records.next} loading={records.loading} />
            </>
          )}
        </Loaded>
      </Card>
    </>
  );
}
