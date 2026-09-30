"use client";

import Link from "next/link";
import { titleCase } from "@/lib/format";

/** Where a ledger/balance source lives in the dashboard, when it has its own page. */
export function sourceHref(type?: string | null, id?: string | null): string | null {
  if (!type || !id) return null;
  switch (type) {
    case "payment":
      return `/payments/${id}`;
    case "payout":
      return `/payouts/${id}`;
    case "dispute":
      return `/disputes/${id}`;
    case "invoice":
      return `/invoices/${id}`;
    case "order":
      return `/orders/${id}`;
    default:
      return null;
  }
}

/** Source label with a link when the object has a page; ids without one are shown as plain mono text. */
export function SourceLink({ type, id, showType = true }: { type?: string | null; id?: string | null; showType?: boolean }) {
  if (!id) return <span className="text-faint">—</span>;
  const href = sourceHref(type, id);
  const label = (
    <>
      {showType && type ? <span className="mr-1.5 text-muted">{titleCase(type)}</span> : null}
      <span className="font-mono text-[12px]">{id}</span>
    </>
  );
  return href ? (
    <Link href={href} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap rounded-sm underline-offset-4 hover:underline">
      {label}
    </Link>
  ) : (
    <span className="whitespace-nowrap text-text-2">{label}</span>
  );
}
