"use client";

import type { BalanceRow } from "@/lib/merchant/types";
import { Amount, Card, Chip } from "@/components/ui";
import { HeroCard } from "../charts";
import { InfoPopover } from "../common";

const BUCKETS: { key: keyof Omit<BalanceRow, "currency" | "available">; label: string; help: string }[] = [
  { key: "pending", label: "Pending", help: "Recent payments that are still settling. They move to available on their available-on date." },
  { key: "reserved", label: "Reserved", help: "A rolling reserve held back from settled funds and released automatically later." },
  { key: "held_for_review", label: "Held for review", help: "Payments that require additional review. They settle once approved." },
  { key: "in_transit_to_bank", label: "On the way to your bank", help: "Payouts that have been created and are being sent to your bank account." },
];

/** "Your current balance" in the reference style: available as the hero numeral, other buckets explained beside it. */
export function BalanceHero({ row }: { row: BalanceRow }) {
  return (
    <Card pad={false} className="p-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <HeroCard
          tone="sage"
          label="Your current balance"
          minor={row.available}
          currency={row.currency}
          chip={<Chip tone="lemon">{row.currency}</Chip>}
          info={<InfoPopover label="Available balance">Money that has settled and can be paid out to your bank or moved to your business wallet now.</InfoPopover>}
          footer="Available to pay out now"
        />
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {BUCKETS.map((b) => (
            <li key={b.key} className="rounded-inner bg-surface-2 p-4">
              <div className="text-[12.5px] text-muted">{b.label}</div>
              <Amount minor={row[b.key]} currency={row.currency} size="sm" className="mt-1" />
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{b.help}</p>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
