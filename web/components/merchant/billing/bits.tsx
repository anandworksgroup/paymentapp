"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { Invoice } from "@/lib/merchant/types";
import { Amount, Chip, StatusChip, Table, cx } from "@/components/ui";
import { date, titleCase } from "@/lib/format";
import type { SubscriptionFull } from "./types";

/** A Next link styled like the shared pill Button (navigation must stay a link, not a button). */
export function LinkButton({ href, children, variant = "soft", icon, className, newTab }: {
  href: string; children: ReactNode; variant?: "ink" | "soft" | "lemon"; icon?: ReactNode; className?: string; newTab?: boolean;
}) {
  const variants = { ink: "bg-ink text-white hover:bg-ink-2", soft: "bg-surface-2 text-text hover:bg-surface-3", lemon: "bg-lemon text-lemon-ink hover:brightness-95" } as const;
  const cls = cx("inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-[14px] font-medium transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sage-100", variants[variant], className);
  if (newTab)
    return <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{icon}{children}</a>;
  return <Link href={href} className={cls}>{icon}{children}</Link>;
}

/** Small pill link used in card headers ("View all"). */
export function PillLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="whitespace-nowrap rounded-full bg-surface-2 px-3.5 py-1.5 text-[12.5px] text-text-2 hover:bg-surface-3">{children}</Link>;
}

/** Inline text link. */
export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return <Link href={href} className={cx("underline-offset-4 hover:underline", className)}>{children}</Link>;
}

/** Grey inner panel with a label and a value (numbers that are not money, or money via Amount). */
export function MiniStat({ label, children, tone }: { label: ReactNode; children: ReactNode; tone?: "sage" | "lemon" | "peach" }) {
  return (
    <div className={cx("min-w-0 rounded-inner p-4", tone === "sage" ? "sage-gradient" : tone === "lemon" ? "lemon-gradient" : tone === "peach" ? "bg-peach-soft" : "bg-surface-2")}>
      <div className="text-[12.5px] text-text-2">{label}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** Large light count (usage, credits): same numeral style as money, with a small grey unit. */
export function Count({ value, unit, size = "md" }: { value: number; unit?: string | null; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "text-[17px]", md: "text-[26px]", lg: "text-[38px]" } as const;
  return (
    <span className={cx("numeral inline-flex items-baseline gap-1.5 text-text", sizes[size])}>
      <span>{value.toLocaleString("en-US")}</span>
      {unit && <span className="text-[12px] font-normal tracking-normal text-muted">{unit}</span>}
    </span>
  );
}

export function InvoiceTable({ rows, empty, showCustomer }: { rows: Invoice[]; empty: ReactNode; showCustomer?: boolean }) {
  const router = useRouter();
  return (
    <Table
      rows={rows}
      rowKey={(i) => i.id}
      onRowClick={(i) => router.push(`/invoices/${i.id}`)}
      empty={empty}
      columns={[
        { key: "num", header: "Number", render: (i) => <span className="whitespace-nowrap font-mono text-[12.5px] text-text">{i.number}</span> },
        { key: "total", header: "Total", render: (i) => <Amount minor={i.total} currency={i.currency} size="sm" /> },
        { key: "status", header: "Status", render: (i) => <StatusChip status={i.status} /> },
        ...(showCustomer
          ? [{ key: "cust", header: "Customer", render: (i: Invoice) => <span className="block max-w-[200px] truncate text-text-2">{i.customer_name ?? i.customer_email ?? i.customer_id ?? "—"}</span> }]
          : [{ key: "reason", header: "Reason", render: (i: Invoice) => <span className="whitespace-nowrap text-text-2">{titleCase(i.billing_reason)}</span> }]),
        { key: "due", header: "Amount due", render: (i) => <Amount minor={i.amount_due} currency={i.currency} size="sm" showCode={false} className="whitespace-nowrap" /> },
        { key: "date", header: "Due", align: "right", render: (i) => <span className="whitespace-nowrap text-muted">{date(i.due_date)}</span> },
      ]}
    />
  );
}

export function SubscriptionTable({ rows, empty, customerLabel }: { rows: SubscriptionFull[]; empty: ReactNode; customerLabel?: (s: SubscriptionFull) => ReactNode }) {
  const router = useRouter();
  return (
    <Table
      rows={rows}
      rowKey={(s) => s.id}
      onRowClick={(s) => router.push(`/subscriptions/${s.id}`)}
      empty={empty}
      columns={[
        { key: "id", header: "Subscription", render: (s) => <span className="whitespace-nowrap font-mono text-[12px] text-text-2">{s.id}</span> },
        { key: "status", header: "Status", render: (s) => (
          <span className="flex flex-wrap items-center gap-1">
            <StatusChip status={s.status} />
            {s.cancel_at_period_end && <Chip tone="peach">Cancels at period end</Chip>}
          </span>
        ) },
        ...(customerLabel ? [{ key: "cust", header: "Customer", render: customerLabel }] : []),
        { key: "collect", header: "Collection", render: (s) => <span className="whitespace-nowrap text-text-2">{s.collection_method === "send_invoice" ? "Send invoice" : "Charge automatically"}</span> },
        { key: "end", header: "Current period ends", align: "right", render: (s) => <span className="whitespace-nowrap text-muted">{date(s.current_period_end)}</span> },
      ]}
    />
  );
}
