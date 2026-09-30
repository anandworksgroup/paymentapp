"use client";

import type { List } from "@/lib/api";
import { date, flag, money, titleCase } from "@/lib/format";
import { useApi } from "@/lib/merchant/hooks";
import type { Customer, Entitlement, Meter, PaymentMethod, Product } from "@/lib/merchant/types";
import { Card, CardHeader, Chip, StatusChip } from "@/components/ui";
import { KV, Mono } from "../common";
import { useMerchant } from "../context";
import { Count, MiniStat, PillLink } from "../billing/bits";
import type { CustomerDetail } from "../billing/types";

export function ProfileCard({ c }: { c: Customer }) {
  const { org } = useMerchant();
  return (
    <Card>
      <CardHeader title="Profile" subtitle={c.anonymized_at ? `Personal data removed ${date(c.anonymized_at)}` : undefined} />
      <KV rows={[
        ["Name", c.name],
        ["Email", c.email],
        ["Phone", c.phone],
        ["Type", c.customer_type === "b2b" ? "Business (B2B)" : "Individual (B2C)"],
        ["Country", c.country ? <>{flag(c.country)} {c.country}</> : null],
        ["Address", c.address_line || c.postal_code ? [c.address_line, c.postal_code].filter(Boolean).join(", ") : null],
        ["Tax ID", c.tax_id ? <span className="font-mono text-[12.5px]">{c.tax_id}</span> : null],
        ["Tax status", titleCase(c.tax_status)],
        ["Payment terms", c.payment_terms_days ? `Net ${c.payment_terms_days} days` : "Due on receipt"],
        ["Credit limit", c.credit_limit != null ? money(c.credit_limit, org.default_currency, { code: true }) : "No limit"],
        ["Account credit", c.credit_balance ? money(c.credit_balance, c.credit_currency ?? "USD", { code: true }) : null],
        ["External id", c.external_id ? <Mono>{c.external_id}</Mono> : null],
        ["Created", date(c.created_at, true)],
      ]} />
    </Card>
  );
}

export function CreditsCard({ customerId, credits }: { customerId: string; credits: CustomerDetail["credits"] }) {
  const { can } = useMerchant();
  return (
    <Card>
      <CardHeader title="Credits" subtitle="Prepaid units in the default credit type" action={can("credits.read") && <PillLink href={`/credits?customer=${customerId}`}>Ledger</PillLink>} />
      <div className="grid grid-cols-2 gap-3">
        <MiniStat label="Available" tone="sage"><Count value={credits.available} unit="credits" /></MiniStat>
        <MiniStat label="Reserved"><Count value={credits.reserved} unit="credits" /></MiniStat>
      </div>
    </Card>
  );
}

export function PaymentMethodsCard({ methods, defaultId }: { methods: PaymentMethod[]; defaultId?: string | null }) {
  return (
    <Card>
      <CardHeader title="Payment methods" />
      {methods.length ? (
        <ul className="space-y-2">
          {methods.map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-inner bg-surface-2 px-4 py-3 text-[13.5px]">
              <span aria-hidden>{flag(m.country)}</span>
              <span className="min-w-0 flex-1 truncate">
                {m.type === "upi" ? "UPI" : titleCase(m.brand ?? m.type)}
                {m.last4 ? ` •••• ${m.last4}` : ""}
                {m.exp_month && m.exp_year ? <span className="text-muted"> · {String(m.exp_month).padStart(2, "0")}/{m.exp_year}</span> : null}
              </span>
              {m.id === defaultId && <Chip tone="sage">Default</Chip>}
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-muted">No saved payment methods. The customer can add one from the portal.</p>}
    </Card>
  );
}

export function EntitlementsCard({ items }: { items: Entitlement[] }) {
  const { can } = useMerchant();
  const products = useApi<List<Product>>(items.length && can("products.read") ? "/v1/products?limit=100" : null);
  const names = new Map((products.data?.data ?? []).map((p) => [p.id, p.name]));
  return (
    <Card>
      <CardHeader title="Entitlements" subtitle="What this customer can use right now" />
      {items.length ? (
        <ul className="space-y-2">
          {items.map((e) => (
            <li key={e.id} className="rounded-inner bg-surface-2 px-4 py-3 text-[13px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-text">{names.get(e.product_id) ?? e.product_id}</span>
                <StatusChip status={e.status} />
              </div>
              <div className="mt-1 text-muted">
                {e.seats} {e.seats === 1 ? "seat" : "seats"} · from {titleCase(e.source_type)} · {e.expires_at ? `expires ${date(e.expires_at)}` : "no expiry"}
              </div>
              {e.features_csv && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {e.features_csv.split(",").filter(Boolean).map((f) => <Chip key={f} tone="lemon-soft">{titleCase(f)}</Chip>)}
                </div>
              )}
              {e.license_key && <div className="mt-2"><Mono>{e.license_key}</Mono></div>}
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-muted">No entitlements. They are granted when an order is paid or a subscription starts.</p>}
    </Card>
  );
}

export function UsageCard({ usage, customerId }: { usage: CustomerDetail["usage"]; customerId: string }) {
  const { can } = useMerchant();
  const meters = useApi<List<Meter>>(usage.length && can("usage.read") ? "/v1/meters?limit=100" : null);
  const byEvent = new Map((meters.data?.data ?? []).map((m) => [m.event_name, m]));
  return (
    <Card>
      <CardHeader title="Usage" subtitle="All recorded events, per meter" action={can("usage.read") && <PillLink href={`/usage?customer=${customerId}`}>Details</PillLink>} />
      {usage.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {usage.map((u) => {
            const m = byEvent.get(u.event_name);
            return (
              <MiniStat key={u.event_name} label={m?.display_name ?? u.event_name}>
                <Count value={u.quantity} unit={m?.unit} />
                <div className="mt-1 text-[12px] text-muted">{u.events.toLocaleString("en-US")} events</div>
              </MiniStat>
            );
          })}
        </div>
      ) : <p className="text-[13px] text-muted">No usage reported for this customer.</p>}
    </Card>
  );
}
