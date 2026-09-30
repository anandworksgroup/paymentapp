"use client";

import { Button, Card, CardHeader, Chip } from "@/components/ui";
import { date, money, titleCase } from "@/lib/format";
import { Icon } from "../icons";
import type { DisputeDetail } from "./types";

export type Suggestion = { type: string; text: string };

/**
 * What the platform already holds about the purchase (§37). Each block can be added to the response
 * with one click, which pre-fills an evidence item the merchant can still edit before sending.
 */
export function SuggestedEvidence({ s, onAdd, canAdd }: { s: DisputeDetail["suggested_evidence"]; onAdd: (x: Suggestion) => void; canAdd: boolean }) {
  const p = s.purchase;
  const method = p.card_brand ? `${titleCase(p.card_brand)}${p.last4 ? ` •••• ${p.last4}` : ""}` : "their payment method";
  const blocks: { key: string; title: string; body: React.ReactNode; suggestion: Suggestion | null }[] = [
    {
      key: "purchase",
      title: "Purchase details",
      body: <>{money(p.amount, p.currency, { code: true })} on {date(p.created_at, true)}{p.customer_email ? ` by ${p.customer_email}` : ""} with {method}. 3-D Secure: {p.three_ds_result ?? "not performed"}.</>,
      suggestion: {
        type: "receipt",
        text: `Payment ${p.id} of ${money(p.amount, p.currency, { code: true })} was made on ${date(p.created_at, true)}${p.customer_email ? ` by ${p.customer_email}` : ""} using ${method}. 3-D Secure result: ${p.three_ds_result ?? "not performed"}.`,
      },
    },
    {
      key: "terms",
      title: "Terms accepted",
      body: s.terms_accepted ? <>The customer accepted terms version <span className="font-mono text-[12px]">{s.terms_accepted}</span> at checkout.</> : "No terms acceptance was recorded for this purchase.",
      suggestion: s.terms_accepted ? { type: "terms_acceptance", text: `Before paying, the customer accepted our terms of service (version ${s.terms_accepted}) at checkout.` } : null,
    },
    {
      key: "ip",
      title: "IP address",
      body: s.ip ? <>The purchase was made from <span className="font-mono text-[12px]">{s.ip}</span>.</> : "No IP address was recorded.",
      suggestion: s.ip ? { type: "other", text: `The purchase was placed from IP address ${s.ip}.` } : null,
    },
    {
      key: "entitlements",
      title: "Access delivered",
      body: s.entitlements.length
        ? <>{s.entitlements.length} entitlement{s.entitlements.length === 1 ? "" : "s"} granted: {s.entitlements.map((e) => `${e.product_id} (${e.status}${e.license_key ? ", license key issued" : ""})`).join(", ")}.</>
        : "No entitlements are linked to this purchase.",
      suggestion: s.entitlements.length
        ? {
            type: "service_documentation",
            text: `Access was delivered immediately after payment: ${s.entitlements
              .map((e) => `product ${e.product_id} granted on ${date(e.created_at, true)}, status ${e.status}${e.features_csv ? `, features: ${e.features_csv}` : ""}${e.seats ? `, ${e.seats} seat${e.seats === 1 ? "" : "s"}` : ""}${e.license_key ? ", license key issued" : ""}`)
              .join("; ")}.`,
          }
        : null,
    },
    {
      key: "usage",
      title: "Usage",
      body: <>{s.usage_events} usage event{s.usage_events === 1 ? "" : "s"} recorded for this customer.</>,
      suggestion: s.usage_events > 0 ? { type: "usage_logs", text: `Our records show ${s.usage_events} usage event${s.usage_events === 1 ? "" : "s"} for this customer's account, showing the service was used.` } : null,
    },
  ];

  return (
    <Card className="sage-gradient">
      <CardHeader title="Evidence we already have" subtitle="Collected by the platform when the purchase happened. Add any of it to your response in one click." />
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {blocks.map((b) => {
          const sug = b.suggestion;
          return (
          <li key={b.key} className="flex flex-col rounded-inner bg-white/75 p-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[13.5px] font-medium text-text">{b.title}</span>
              {sug ? <Chip tone="sage">Available</Chip> : <Chip tone="neutral">Not recorded</Chip>}
            </div>
            <p className="text-[12.5px] leading-relaxed text-text-2">{b.body}</p>
            {canAdd && sug && (
              <div className="mt-3">
                <Button size="sm" variant="soft" icon={<Icon name="plus" size={14} />} onClick={() => onAdd(sug)}>
                  Add to response
                </Button>
              </div>
            )}
          </li>
          );
        })}
      </ul>
    </Card>
  );
}
