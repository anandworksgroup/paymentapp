import { toMajorInput, toMinor } from "@/lib/merchant/money";
import type { Price } from "@/lib/merchant/types";

/**
 * Form state for creating a price or a new price version, and the conversion to the API body.
 * Amounts are typed in major units and converted with `toMinor`; the server validates the pricing
 * rules (tier order, interval bounds, min ≤ max …) and its messages are shown as-is.
 */
export type Scheme = "standard" | "per_unit" | "tiered" | "package";
export type Interval = "day" | "week" | "month" | "year";
export type TierRow = { key: number; upTo: string; unit: string; flat: string };
export type CountryRow = { key: number; country: string; amount: string };

export type PriceDraft = {
  nickname: string;
  currency: string;
  type: "one_time" | "recurring";
  interval: Interval;
  intervalCount: string;
  trialDays: string;
  scheme: Scheme;
  unitAmount: string;
  packageSize: string;
  tiersMode: "graduated" | "volume";
  tiers: TierRow[];
  usageType: "licensed" | "metered";
  meterId: string;
  creditsGranted: string;
  minimum: string;
  maximum: string;
  taxBehavior: "exclusive" | "inclusive";
  countries: CountryRow[];
};

let seq = 1;
export const rowKey = () => seq++;

export function draftFrom(p: Price | undefined, fallbackCurrency: string): PriceDraft {
  const cur = p?.currency ?? fallbackCurrency;
  const m = (v: number | null | undefined) => toMajorInput(v ?? null, cur);
  const tiers: TierRow[] = p?.tiers?.length
    ? p.tiers.map((t) => ({ key: rowKey(), upTo: t.up_to === null ? "" : String(t.up_to), unit: m(t.unit_amount), flat: t.flat_amount ? m(t.flat_amount) : "" }))
    : [
        { key: rowKey(), upTo: "1000", unit: "", flat: "" },
        { key: rowKey(), upTo: "", unit: "", flat: "" },
      ];
  return {
    nickname: p?.nickname ?? "",
    currency: cur,
    type: p?.type ?? "one_time",
    interval: (p?.interval as Interval | undefined) ?? "month",
    intervalCount: String(p?.interval_count ?? 1),
    trialDays: String(p?.trial_days ?? 0),
    scheme: (["standard", "per_unit", "tiered", "package"].includes(p?.scheme ?? "") ? p?.scheme : "standard") as Scheme,
    unitAmount: p && p.scheme !== "tiered" ? m(p.unit_amount) : "",
    packageSize: String(p?.package_size ?? 100),
    tiersMode: p?.tiers_mode === "volume" ? "volume" : "graduated",
    tiers,
    usageType: p?.usage_type === "metered" ? "metered" : "licensed",
    meterId: p?.meter_id ?? "",
    creditsGranted: p?.credits_granted ? String(p.credits_granted) : "",
    minimum: m(p?.minimum_amount),
    maximum: m(p?.maximum_amount),
    taxBehavior: p?.tax_behavior === "inclusive" ? "inclusive" : "exclusive",
    countries: Object.entries(p?.country_amounts ?? {}).map(([country, amount]) => ({ key: rowKey(), country, amount: m(amount) })),
  };
}

export type DraftErrors = Record<string, string>;

const AMOUNT = "Enter an amount like 12.50 (no more decimals than the currency allows).";

function whole(v: string, min: number): number | null {
  const s = v.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= min ? n : null;
}

/** Builds the POST body. Returns `body: null` when there are obvious input problems. */
export function buildPriceBody(d: PriceDraft, productId: string): { body: Record<string, unknown> | null; errors: DraftErrors } {
  const e: DraftErrors = {};
  const cur = d.currency;
  const money = (v: string, key: string, required = false): number | undefined => {
    if (!v.trim()) {
      if (required) e[key] = "Required.";
      return undefined;
    }
    const n = toMinor(v, cur);
    if (n === null) e[key] = AMOUNT;
    return n ?? undefined;
  };

  const body: Record<string, unknown> = {
    product_id: productId,
    currency: cur,
    type: d.type,
    scheme: d.scheme,
    tax_behavior: d.taxBehavior,
    nickname: d.nickname.trim() || undefined,
  };

  if (d.scheme === "tiered") {
    body.unit_amount = 0;
    body.tiers_mode = d.tiersMode;
    body.tiers = d.tiers.map((t, i) => {
      const last = i === d.tiers.length - 1;
      let upTo: number | null = null;
      if (!last) {
        upTo = whole(t.upTo, 1);
        if (upTo === null) e[`tier-${t.key}-upTo`] = "Whole number of units.";
      }
      return { up_to: upTo, unit_amount: money(t.unit, `tier-${t.key}-unit`, true) ?? 0, flat_amount: money(t.flat, `tier-${t.key}-flat`) ?? 0 };
    });
  } else {
    body.unit_amount = money(d.unitAmount, "unitAmount", true);
    if (d.scheme === "package") {
      const size = whole(d.packageSize, 1);
      if (size === null) e.packageSize = "Whole number of units, 1 or more.";
      body.package_size = size ?? undefined;
    }
    const seen = new Set<string>();
    const overrides: Record<string, number> = {};
    for (const c of d.countries) {
      const code = c.country.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) e[`country-${c.key}`] = "Choose a country.";
      else if (seen.has(code)) e[`country-${c.key}`] = `${code} is listed twice.`;
      seen.add(code);
      const amt = money(c.amount, `country-amount-${c.key}`, true);
      if (amt !== undefined && /^[A-Z]{2}$/.test(code)) overrides[code] = amt;
    }
    if (d.countries.length) body.country_amounts = overrides;
  }

  if (d.type === "recurring") {
    body.interval = d.interval;
    const count = whole(d.intervalCount, 1);
    if (count === null) e.intervalCount = "Whole number, 1 or more.";
    body.interval_count = count ?? undefined;
    const trial = whole(d.trialDays || "0", 0);
    if (trial === null) e.trialDays = "Whole number of days.";
    body.trial_days = trial ?? undefined;
    body.usage_type = d.usageType;
    if (d.usageType === "metered") {
      if (!d.meterId) e.meterId = "Choose the meter that measures usage.";
      body.meter_id = d.meterId || undefined;
    }
  } else {
    body.usage_type = "licensed";
  }

  if (d.creditsGranted.trim()) {
    const credits = whole(d.creditsGranted, 0);
    if (credits === null) e.creditsGranted = "Whole number of credits.";
    body.credits_granted = credits ?? undefined;
  }
  body.minimum_amount = money(d.minimum, "minimum");
  body.maximum_amount = money(d.maximum, "maximum");

  return { body: Object.keys(e).length ? null : body, errors: e };
}
