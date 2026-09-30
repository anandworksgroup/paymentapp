"use client";

import Link from "next/link";
import { date, flag, money, titleCase } from "@/lib/format";
import type { TaxRecord } from "@/lib/merchant/types";
import { Amount, Chip, Empty, Table } from "@/components/ui";
import type { TaxJurisdiction } from "./types";

/** Rate in basis points → "20%" / "8.25%" (display only). */
export function rateLabel(bps: number) {
  const s = (bps / 100).toFixed(2).replace(/\.?0+$/, "");
  return `${s}%`;
}

export function JurisdictionTable({ rows, registrations }: { rows: TaxJurisdiction[]; registrations: string[] }) {
  return (
    <Table
      rows={rows}
      rowKey={(r) => `${r.country}-${r.tax_type}-${r.currency}`}
      empty={<Empty title="No tax recorded in this period">Tax records appear as soon as a customer pays for a taxable sale.</Empty>}
      columns={[
        {
          key: "country", header: "Jurisdiction", render: (r) => (
            <span className="flex items-center gap-2 whitespace-nowrap">
              <span aria-hidden className="text-[18px]">{flag(r.country)}</span>
              <span className="text-text">{r.country}</span>
              {registrations.includes(r.country) && <Chip tone="sage">Registered</Chip>}
            </span>
          ),
        },
        { key: "type", header: "Tax", render: (r) => <Chip tone={r.tax_type === "refund" ? "peach" : "neutral"}>{r.tax_type === "refund" ? "Refund adjustment" : r.tax_type.replace(/_/g, " ")}</Chip> },
        { key: "taxable", header: "Taxable sales", align: "right", render: (r) => <span className="numeral whitespace-nowrap">{money(r.taxable_sales, r.currency)}</span> },
        { key: "tax", header: "Tax collected", align: "right", render: (r) => <Amount minor={r.tax_collected} currency={r.currency} size="sm" /> },
        {
          key: "rc", header: "Reverse charge", align: "right", render: (r) =>
            r.reverse_charge_sales ? <span className="numeral whitespace-nowrap">{money(r.reverse_charge_sales, r.currency)}</span> : <span className="text-faint">—</span>,
        },
        { key: "n", header: "Records", align: "right", render: (r) => <span className="text-muted">{r.records}</span> },
      ]}
    />
  );
}

export function TaxRecordsTable({ rows }: { rows: TaxRecord[] }) {
  return (
    <Table
      rows={rows}
      rowKey={(r) => r.id}
      empty={<Empty title="No tax records yet">Each taxable sale, invoice and refund creates a record you can trace here.</Empty>}
      columns={[
        { key: "date", header: "Date", render: (r) => <span className="whitespace-nowrap text-muted">{date(r.created_at, true)}</span> },
        {
          key: "source", header: "Source", render: (r) => {
            const href = r.invoice_id ? `/invoices/${r.invoice_id}` : r.order_id ? `/orders/${r.order_id}` : null;
            const label = <><span className="mr-1.5 text-muted">{titleCase(r.source_type)}</span><span className="font-mono text-[12px]">{r.invoice_id ?? r.order_id ?? r.source_id}</span></>;
            return href ? <Link href={href} className="whitespace-nowrap underline-offset-4 hover:underline">{label}</Link> : <span className="whitespace-nowrap">{label}</span>;
          },
        },
        { key: "country", header: "Country", render: (r) => <span className="whitespace-nowrap">{flag(r.country)} {r.country}</span> },
        { key: "type", header: "Type", render: (r) => <span className="whitespace-nowrap text-text-2">{r.tax_type.replace(/_/g, " ")}</span> },
        { key: "rate", header: "Rate", align: "right", render: (r) => <span className="numeral">{rateLabel(r.rate_bps)}</span> },
        { key: "taxable", header: "Taxable", align: "right", render: (r) => <span className="numeral whitespace-nowrap">{money(r.taxable_amount, r.currency)}</span> },
        { key: "tax", header: "Tax", align: "right", render: (r) => <span className="numeral whitespace-nowrap text-text">{money(r.tax_amount, r.currency)}</span> },
        {
          key: "flags", header: "", render: (r) => (
            <span className="flex flex-wrap gap-1">
              {r.reverse_charge && <Chip tone="sky">Reverse charge</Chip>}
              {r.exempt && <Chip tone="lemon-soft">Exempt</Chip>}
            </span>
          ),
        },
      ]}
    />
  );
}
