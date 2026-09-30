"use client";

import { Chip } from "@/components/ui";
import { date } from "@/lib/format";

const DAY = 86_400_000;

/** Evidence deadline: peach when overdue, lemon when due within 3 days. Only relevant while a response is needed. */
export function DueChip({ due, status, now }: { due: string; status: string; now: number }) {
  if (status !== "needs_response") return <span className="whitespace-nowrap text-muted">{date(due)}</span>;
  const left = new Date(due).getTime() - now;
  if (left < 0) return <Chip tone="peach">Overdue · {date(due)}</Chip>;
  if (left < 3 * DAY) {
    const days = Math.max(0, Math.floor(left / DAY));
    return <Chip tone="lemon">{days === 0 ? "Due today" : `Due in ${days}d`} · {date(due)}</Chip>;
  }
  return <span className="whitespace-nowrap text-text-2">{date(due)}</span>;
}
