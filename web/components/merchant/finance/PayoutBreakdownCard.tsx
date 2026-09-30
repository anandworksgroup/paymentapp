"use client";

import { Amount, Card, CardHeader, cx } from "@/components/ui";
import { money } from "@/lib/format";
import type { PayoutBreakdown } from "./types";

const LINES: { key: keyof PayoutBreakdown; label: string }[] = [
  { key: "gross_collected", label: "Gross collected (net of tax)" },
  { key: "fees", label: "Fees" },
  { key: "refunds", label: "Refunds" },
  { key: "chargebacks", label: "Chargebacks" },
  { key: "reserve_withheld", label: "Reserve withheld" },
  { key: "reserve_released", label: "Reserve released" },
  { key: "adjustments", label: "Adjustments" },
];

/** The server's payout breakdown, shown line by line exactly as returned (nothing is added up here). */
export function PayoutBreakdownCard({ breakdown, currency }: { breakdown?: PayoutBreakdown | null; currency: string }) {
  return (
    <Card>
      <CardHeader title="Breakdown" subtitle="How this payout was put together, as calculated by the ledger" />
      {!breakdown ? (
        <p className="text-[13px] text-muted">No breakdown was recorded for this payout.</p>
      ) : (
        <>
          <dl className="divide-y divide-line">
            {LINES.map((l) => {
              const v = breakdown[l.key];
              if (typeof v !== "number") return null;
              return (
                <div key={l.key} className="flex items-baseline justify-between gap-4 py-2.5 text-[13.5px]">
                  <dt className="text-text-2">{l.label}</dt>
                  <dd className={cx("numeral whitespace-nowrap", v === 0 ? "text-muted" : "text-text")}>{money(v, currency)}</dd>
                </div>
              );
            })}
          </dl>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3 rounded-inner lemon-gradient p-4">
            <div>
              <div className="text-[12.5px] text-text-2">Net payout</div>
              <Amount minor={breakdown.net_payout} currency={currency} size="md" className="mt-1" />
            </div>
            {typeof breakdown.balance_transactions === "number" && (
              <span className="text-[12.5px] text-text-2">{breakdown.balance_transactions} balance transactions included</span>
            )}
          </div>
          {typeof breakdown.tax_collected_and_remitted_by_platform === "number" && (
            <div className="mt-3 rounded-inner bg-surface-2 px-4 py-3 text-[13px] text-text-2">
              <span className="numeral text-text">{money(breakdown.tax_collected_and_remitted_by_platform, currency, { code: true })}</span> of tax was collected on these
              payments and is filed and remitted by the platform as Merchant of Record. It is not part of your payout.
            </div>
          )}
          {breakdown.note && <p className="mt-3 text-[12.5px] leading-relaxed text-muted">{breakdown.note}</p>}
        </>
      )}
    </Card>
  );
}
