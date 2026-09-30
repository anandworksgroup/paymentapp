"use client";

import { Amount, Card, Chip, Empty, Table } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { useAdminQuery } from "@/components/admin/data";
import { Country, humanize, Loadable, SkeletonRows, When } from "@/components/admin/kit";
import type { FxRate, ListResponse, WalletLimit } from "@/components/admin/types";
import { flag } from "@/lib/format";

export function LimitsTab() {
  const q = useAdminQuery<ListResponse<WalletLimit>>("/config/limits");
  return (
    <Card>
      <CardHeader title="Wallet limits" subtitle="Per-transaction, daily, monthly and balance limits by country and verification level, in USD. Read-only here." />
      <Loadable q={q} skeleton={<SkeletonRows rows={3} />}>
        {(d) => {
          const rows = [...d.data].sort((a, b) => a.country.localeCompare(b.country) || a.kyc_level - b.kyc_level || a.transfer_type.localeCompare(b.transfer_type));
          return (
            <Table
              rows={rows}
              rowKey={(r) => r.id}
              empty={<Empty title="No wallet limits configured" />}
              columns={[
                { key: "country", header: "Country", render: (r) => (r.country === "*" ? <span className="text-text-2">All countries</span> : <Country code={r.country} />) },
                { key: "kyc", header: "KYC level", render: (r) => <Chip tone="lemon-soft">Level {r.kyc_level}</Chip> },
                { key: "type", header: "Transfer type", render: (r) => (r.transfer_type === "*" ? <span className="text-text-2">All types</span> : humanize(r.transfer_type)) },
                { key: "per", header: "Per transaction", align: "right", render: (r) => <Amount minor={r.per_transaction_usd} currency="USD" size="sm" /> },
                { key: "daily", header: "Daily", align: "right", render: (r) => <Amount minor={r.daily_usd} currency="USD" size="sm" /> },
                { key: "monthly", header: "Monthly", align: "right", render: (r) => <Amount minor={r.monthly_usd} currency="USD" size="sm" /> },
                { key: "bal", header: "Max balance", align: "right", render: (r) => <Amount minor={r.max_balance_usd} currency="USD" size="sm" /> },
              ]}
            />
          );
        }}
      </Loadable>
    </Card>
  );
}

export function FxTab() {
  const q = useAdminQuery<ListResponse<FxRate>>("/config/fx_rates");
  return (
    <Card>
      <CardHeader title="FX reference rates" subtitle="The latest 100 stored reference rates (1 base = rate × quote). Read-only here." />
      <Loadable q={q} skeleton={<SkeletonRows rows={5} />}>
        {(d) => {
          const rows = [...d.data].sort((a, b) => a.base.localeCompare(b.base) || a.quote.localeCompare(b.quote) || b.as_of.localeCompare(a.as_of));
          return (
            <Table
              rows={rows}
              rowKey={(r) => r.id}
              empty={<Empty title="No FX rates stored" />}
              columns={[
                {
                  key: "pair",
                  header: "Pair",
                  render: (r) => (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-text">
                      <span aria-hidden>{flag(r.base.slice(0, 2))}</span>
                      {r.base}
                      <span className="text-muted">→</span>
                      <span aria-hidden>{flag(r.quote.slice(0, 2))}</span>
                      {r.quote}
                    </span>
                  ),
                },
                { key: "rate", header: "Rate", align: "right", render: (r) => <span className="numeral text-[16px] text-text">{(r.rate_e9 / 1e9).toFixed(6)}</span> },
                { key: "inv", header: "Inverse", align: "right", render: (r) => <span className="numeral text-text-2">{r.rate_e9 ? (1e9 / r.rate_e9).toFixed(6) : "—"}</span> },
                {
                  key: "source",
                  header: "Source",
                  render: (r) => <Chip tone={/sandbox|test|synthetic/i.test(r.source) ? "lemon" : "neutral"}>{humanize(r.source)}</Chip>,
                },
                { key: "asof", header: "As of", render: (r) => <When at={r.as_of} /> },
              ]}
            />
          );
        }}
      </Loadable>
    </Card>
  );
}
