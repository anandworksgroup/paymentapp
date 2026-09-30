"use client";

import Link from "next/link";
import { useState } from "react";
import { api, type List } from "@/lib/api";
import { money } from "@/lib/format";
import { useAction, useApi } from "@/lib/merchant/hooks";
import type { Coupon } from "@/lib/merchant/types";
import { Button, Card, CardHeader, Chip, ErrorNote, Field, Select, Skeleton } from "@/components/ui";
import { useMerchant, useToast } from "../context";
import { Help } from "../common";
import { CheckField } from "../catalog/fields";
import type { OrganizationSettings } from "./types";

/** How the portal words a discount offer (mirrors CommerceEndpoints cancel_options). */
function offerText(c: Coupon) {
  if (c.percent_off_bps) {
    const pct = `${(c.percent_off_bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}% off`;
    return c.duration === "repeating" ? `${pct} for ${c.duration_in_months} months` : c.duration === "forever" ? `${pct} for as long as they stay` : `${pct} on the next invoice`;
  }
  return c.amount_off && c.currency ? `${money(c.amount_off, c.currency, { code: true })} off` : c.code;
}

/**
 * Cancellation save offer (§257). When a customer cancels in the portal they pick a reason, then see
 * the offers configured here (a retention coupon and/or pausing), and only then cancel at period end.
 * Stored on the organization: PATCH /v1/organization { retention_coupon, retention_offer_pause }.
 */
export function RetentionCard() {
  const { can } = useMerchant();
  const toast = useToast();
  const org = useApi<OrganizationSettings>(can("team.read") ? "/v1/organization" : null);
  const coupons = useApi<List<Coupon>>(can("products.read") ? "/v1/coupons?limit=100" : null);
  const save = useAction();
  const [draft, setDraft] = useState<{ coupon: string; pause: boolean } | null>(null);

  if (!can("team.read")) return null;
  const canEdit = can("org.manage");
  const all = coupons.data?.data ?? [];
  const currentCoupon = all.find((c) => c.id === org.data?.retention_coupon_id);
  const saved = { coupon: currentCoupon?.code ?? "", pause: org.data?.retention_offer_pause ?? true };
  const value = draft ?? saved;
  const dirty = !!draft && (draft.coupon !== saved.coupon || draft.pause !== saved.pause);
  const options = all.filter((c) => c.active || c.id === org.data?.retention_coupon_id);
  const chosen = all.find((c) => c.code === value.coupon);

  const submit = async () => {
    const r = await save.run(() => api<OrganizationSettings>("/v1/organization", { method: "PATCH", body: {
      // Only send what changed: the API re-validates a coupon code it receives, so an unchanged inactive coupon would be rejected.
      retention_coupon: value.coupon !== saved.coupon ? value.coupon : undefined,
      retention_offer_pause: value.pause !== saved.pause ? value.pause : undefined,
    } }));
    if (r) {
      toast("Cancellation offer saved");
      setDraft(null);
      org.reload();
    }
  };

  return (
    <Card>
      <CardHeader
        title="Cancellation save offer"
        subtitle="What customers see when they cancel a subscription in the customer portal"
        action={canEdit && dirty && (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setDraft(null); save.setError(null); }}>Discard</Button>
            <Button size="sm" loading={save.busy} onClick={submit}>Save</Button>
          </div>
        )}
      />
      {org.error ? (
        <ErrorNote error={org.error} />
      ) : !org.data || (can("products.read") && !coupons.data && !coupons.error) ? (
        <Skeleton className="h-32" />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <Field label="Discount offer" hint={value.coupon ? "Not offered on subscriptions that already use this coupon." : "Pick an active coupon to offer customers who are about to cancel."}>
              <Select value={value.coupon} disabled={!canEdit || !can("products.read")} onChange={(e) => setDraft({ ...value, coupon: e.target.value })}>
                <option value="">No discount offer</option>
                {options.map((c) => <option key={c.id} value={c.code}>{c.code} · {offerText(c)}{c.active ? "" : " (inactive)"}</option>)}
              </Select>
            </Field>
            {!options.length && can("coupons.write") && (
              <Help>No active coupons yet. <Link href="/coupons?new=1" className="text-text underline underline-offset-4">Create a coupon</Link> to offer a discount.</Help>
            )}
            <CheckField
              label="Offer to pause instead"
              hint="Active subscriptions can pause with no charges until the customer resumes."
              checked={value.pause}
              disabled={!canEdit}
              onChange={(v) => setDraft({ ...value, pause: v })}
            />
            {!canEdit && <Help>Only owners and admins can change this.</Help>}
            <div aria-live="assertive">{save.error ? <ErrorNote error={save.error} /> : null}</div>
          </div>

          <div className="rounded-inner bg-surface-2 p-5">
            <div className="mb-3 text-[12.5px] font-medium text-text-2">Customer sees, after choosing a reason</div>
            <ol className="space-y-2 text-[13px]">
              {chosen && (
                <li className="flex items-center justify-between gap-2 rounded-[14px] bg-lemon-soft px-4 py-3 text-lemon-ink">
                  <span>Stay and get {offerText(chosen)}</span>
                  <Chip tone="lemon">Discount</Chip>
                </li>
              )}
              {value.pause && (
                <li className="flex items-center justify-between gap-2 rounded-[14px] bg-sky-soft px-4 py-3 text-sky-ink">
                  <span>Pause instead: no charges until you resume</span>
                  <Chip tone="sky">Pause</Chip>
                </li>
              )}
              <li className="rounded-[14px] bg-surface px-4 py-3 text-text-2">Cancel at the end of the current period</li>
            </ol>
            {!chosen && !value.pause && <p className="mt-3 text-[12px] text-muted">With no offers, customers go straight from the reason to cancelling.</p>}
          </div>
        </div>
      )}
    </Card>
  );
}
