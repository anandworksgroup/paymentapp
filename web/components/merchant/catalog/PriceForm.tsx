"use client";

import Link from "next/link";
import type { Meter } from "@/lib/merchant/types";
import { Field, Input, Segmented, Select } from "@/components/ui";
import { CURRENCIES } from "@/lib/merchant/money";
import { MoneyInput } from "../common";
import { FormSection } from "./fields";
import { CountryAmountsEditor, TierEditor } from "./PriceEditors";
import type { DraftErrors, Interval, PriceDraft, Scheme } from "./priceDraft";

const SCHEMES: { value: Scheme; label: string; help: string }[] = [
  { value: "standard", label: "Standard", help: "One fixed amount per unit." },
  { value: "per_unit", label: "Per unit", help: "Amount × quantity (seats, licences, units)." },
  { value: "tiered", label: "Tiered", help: "Different rates as quantity grows." },
  { value: "package", label: "Package", help: "Charged per bundle of units, rounded up." },
];

/** Every pricing option the API supports, grouped so a simple price stays a short form. */
export function PriceForm({ d, set, errors, meters, canReadMeters }: {
  d: PriceDraft;
  set: (patch: Partial<PriceDraft>) => void;
  errors: DraftErrors;
  meters: Meter[] | undefined;
  canReadMeters: boolean;
}) {
  const scheme = SCHEMES.find((s) => s.value === d.scheme);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
        <Field label="Nickname (optional)" hint="Internal label, e.g. “Pro monthly”.">
          <Input value={d.nickname} onChange={(e) => set({ nickname: e.target.value })} maxLength={100} />
        </Field>
        <Field label="Currency">
          <Select value={d.currency} onChange={(e) => set({ currency: e.target.value })}>
            {(CURRENCIES.includes(d.currency) ? CURRENCIES : [d.currency, ...CURRENCIES]).map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
      </div>

      <FormSection title="Billing">
        <Segmented<PriceDraft["type"]>
          value={d.type}
          onChange={(type) => set({ type, usageType: type === "one_time" ? "licensed" : d.usageType })}
          options={[{ value: "one_time", label: "One-time" }, { value: "recurring", label: "Recurring" }]}
        />
        {d.type === "recurring" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Bill every" error={errors.intervalCount}>
              <Input inputMode="numeric" value={d.intervalCount} onChange={(e) => set({ intervalCount: e.target.value })} />
            </Field>
            <Field label="Interval">
              <Select value={d.interval} onChange={(e) => set({ interval: e.target.value as Interval })}>
                <option value="day">Day(s)</option>
                <option value="week">Week(s)</option>
                <option value="month">Month(s)</option>
                <option value="year">Year(s)</option>
              </Select>
            </Field>
            <Field label="Free trial days" error={errors.trialDays}>
              <Input inputMode="numeric" value={d.trialDays} onChange={(e) => set({ trialDays: e.target.value })} />
            </Field>
          </div>
        )}
      </FormSection>

      <FormSection title="Pricing scheme">
        <div className="overflow-x-auto">
          <Segmented<Scheme> value={d.scheme} onChange={(scheme) => set({ scheme })} options={SCHEMES.map((s) => ({ value: s.value, label: s.label }))} />
        </div>
        <p className="text-[12.5px] text-muted">{scheme?.help}</p>
        {d.scheme === "tiered" ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Segmented<PriceDraft["tiersMode"]>
                value={d.tiersMode}
                onChange={(tiersMode) => set({ tiersMode })}
                options={[{ value: "graduated", label: "Graduated" }, { value: "volume", label: "Volume" }]}
              />
              <span className="text-[12.5px] text-muted">
                {d.tiersMode === "graduated" ? "Each tier's units are charged at that tier's rate." : "All units are charged at the rate of the tier the total lands in."}
              </span>
            </div>
            <TierEditor tiers={d.tiers} onChange={(tiers) => set({ tiers })} currency={d.currency} errors={errors} />
          </>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={d.scheme === "package" ? "Price per package" : "Amount"} error={errors.unitAmount}>
              <MoneyInput currency={d.currency} value={d.unitAmount} onChange={(unitAmount) => set({ unitAmount })} placeholder="29.00" />
            </Field>
            {d.scheme === "package" && (
              <Field label="Units per package" error={errors.packageSize} hint="e.g. 100 → 250 units bill as 3 packages.">
                <Input inputMode="numeric" value={d.packageSize} onChange={(e) => set({ packageSize: e.target.value })} />
              </Field>
            )}
          </div>
        )}
      </FormSection>

      {d.type === "recurring" && (
        <FormSection title="Usage">
          <Segmented<PriceDraft["usageType"]>
            value={d.usageType}
            onChange={(usageType) => set({ usageType })}
            options={[{ value: "licensed", label: "Licensed (quantity set up front)" }, { value: "metered", label: "Metered (billed on usage)" }]}
          />
          {d.usageType === "metered" && (
            <Field
              label="Meter"
              error={errors.meterId}
              hint={canReadMeters ? (meters && meters.length === 0 ? <>No meters yet — <Link href="/meters" className="underline underline-offset-4">create one</Link> first.</> : "Usage events for this meter are summed into each invoice.") : "Your role can't list meters; ask an admin to set this price up."}
            >
              <Select value={d.meterId} onChange={(e) => set({ meterId: e.target.value })} disabled={!meters}>
                <option value="">{meters ? "Choose a meter" : canReadMeters ? "Loading meters…" : "Unavailable"}</option>
                {meters?.map((m) => <option key={m.id} value={m.id}>{m.display_name} · {m.event_name} ({m.aggregation})</option>)}
              </Select>
            </Field>
          )}
        </FormSection>
      )}

      <FormSection title="Limits, credits & tax">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Minimum charge (optional)" error={errors.minimum} hint="Per billing period or purchase.">
            <MoneyInput currency={d.currency} value={d.minimum} onChange={(minimum) => set({ minimum })} />
          </Field>
          <Field label="Maximum charge (optional)" error={errors.maximum} hint="Caps the amount, e.g. usage spend.">
            <MoneyInput currency={d.currency} value={d.maximum} onChange={(maximum) => set({ maximum })} />
          </Field>
          <Field label="Credits granted (optional)" error={errors.creditsGranted} hint="Added to the customer's credit balance on purchase or renewal.">
            <Input inputMode="numeric" value={d.creditsGranted} onChange={(e) => set({ creditsGranted: e.target.value })} placeholder="0" />
          </Field>
          <Field label="Tax behaviour">
            <Select value={d.taxBehavior} onChange={(e) => set({ taxBehavior: e.target.value as PriceDraft["taxBehavior"] })}>
              <option value="exclusive">Exclusive — tax is added on top</option>
              <option value="inclusive">Inclusive — the amount already contains tax</option>
            </Select>
          </Field>
        </div>
      </FormSection>

      {d.scheme !== "tiered" && (
        <FormSection title="Country prices">
          <CountryAmountsEditor rows={d.countries} onChange={(countries) => set({ countries })} currency={d.currency} errors={errors} />
        </FormSection>
      )}
    </div>
  );
}
