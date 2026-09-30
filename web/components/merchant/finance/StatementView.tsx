"use client";

import { Amount, Card, Chip, cx } from "@/components/ui";
import { date, money } from "@/lib/format";
import { Icon } from "../icons";
import type { Statement } from "./types";

const MOVEMENTS: { key: keyof Statement; label: string; help: string }[] = [
  { key: "payments_net_of_tax", label: "Payments", help: "Net of tax, which the platform remits" },
  { key: "refunds", label: "Refunds", help: "Returned to customers" },
  { key: "disputes", label: "Disputes", help: "Disputed amounts and reversals" },
  { key: "fees", label: "Fees", help: "Platform and processing fees" },
  { key: "adjustments", label: "Adjustments", help: "Manual corrections" },
  { key: "payouts", label: "Payouts", help: "Sent to your bank, minus returned payouts" },
  { key: "transfers_to_wallet", label: "Transfers to wallet", help: "Moved to your business wallet" },
];

/** Monthly statement laid out as opening → movements → closing, with the server's reconciliation flag. */
export function StatementView({ s }: { s: Statement }) {
  const endInclusive = new Date(new Date(s.period_end).getTime() - 1).toISOString();
  return (
    <div className="space-y-5">
      <div
        role="status"
        className={cx("flex flex-wrap items-center gap-3 rounded-inner px-5 py-4 text-[13.5px]", s.reconciles ? "bg-sage-100 text-sage-700" : "bg-peach-soft text-peach-ink")}
      >
        <Icon name={s.reconciles ? "check" : "info"} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{s.reconciles ? "Reconciles" : "Doesn't reconcile yet"}</div>
          <div className="opacity-85">
            {s.reconciles
              ? "Opening balance plus this month's movements equals the closing balance in the ledger."
              : "Opening balance plus movements differs from the ledger's closing balance. This can happen while funds are settling across month boundaries; contact support if it persists."}
          </div>
        </div>
        <Chip tone={s.reconciles ? "sage" : "peach"}>{s.reconciles ? "Reconciles" : "Needs a look"}</Chip>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="flex flex-col">
          <div className="text-[13px] text-text-2">Opening balance</div>
          <div className="text-[12px] text-muted">{date(s.period_start)}</div>
          <div className="mt-auto pt-6"><Amount minor={s.opening_balance} currency={s.currency} size="lg" /></div>
        </Card>

        <Card>
          <div className="mb-2 text-[13px] text-text-2">Movements this month</div>
          <dl className="divide-y divide-line">
            {MOVEMENTS.map((m) => {
              const v = s[m.key] as number;
              return (
                <div key={m.key} className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="min-w-0">
                    <span className="block text-[13.5px] text-text">{m.label}</span>
                    <span className="block text-[12px] text-muted">{m.help}</span>
                  </dt>
                  <dd className={cx("numeral whitespace-nowrap text-[15px]", v === 0 ? "text-muted" : "text-text")}>
                    {v > 0 ? "+" : ""}{money(v, s.currency)}
                  </dd>
                </div>
              );
            })}
          </dl>
        </Card>

        <Card className="sage-gradient flex flex-col">
          <div className="text-[13px] text-text-2">Closing balance</div>
          <div className="text-[12px] text-muted">{date(endInclusive)}</div>
          <div className="mt-auto pt-6"><Amount minor={s.closing_balance} currency={s.currency} size="lg" /></div>
        </Card>
      </div>

      <Card className="lemon-gradient">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 max-w-xl">
            <div className="text-[13px] text-text-2">Tax collected and remitted by the platform</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-text-2">
              As Merchant of Record, the platform collects this tax from your customers and files and remits it. It is not part of your balance and is not included above.
            </p>
          </div>
          <Amount minor={s.tax_collected_and_remitted_by_platform} currency={s.currency} size="md" />
        </div>
      </Card>
    </div>
  );
}
