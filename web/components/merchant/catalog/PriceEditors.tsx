"use client";

import { Button, Select, inputClass, cx } from "@/components/ui";
import { flag } from "@/lib/format";
import { MoneyInput } from "../common";
import { useCountries } from "../useMeta";
import { Icon } from "../icons";
import { rowKey, type CountryRow, type DraftErrors, type TierRow } from "./priceDraft";

function Err({ msg }: { msg?: string }) {
  return msg ? <span role="alert" className="mt-1 block text-[11.5px] text-rose-ink">{msg}</span> : null;
}

/**
 * Tier rows: "up to" (the last row is always ∞), per-unit amount and an optional flat fee per tier.
 * New rows are inserted just above the ∞ row so the open-ended tier stays last.
 */
export function TierEditor({ tiers, onChange, currency, errors }: { tiers: TierRow[]; onChange: (t: TierRow[]) => void; currency: string; errors: DraftErrors }) {
  const set = (key: number, patch: Partial<TierRow>) => onChange(tiers.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  const add = () => {
    const prev = tiers.length > 1 ? Number(tiers[tiers.length - 2].upTo) : 0;
    const guess = Number.isFinite(prev) && prev > 0 ? String(prev * 10) : "";
    onChange([...tiers.slice(0, -1), { key: rowKey(), upTo: guess, unit: "", flat: "" }, tiers[tiers.length - 1]]);
  };
  const remove = (key: number) => onChange(tiers.filter((t) => t.key !== key));

  return (
    <div>
      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_36px] gap-2 px-1 pb-1.5 text-[12px] text-muted sm:grid">
        <span>Units up to</span>
        <span>Per unit</span>
        <span>Flat fee</span>
        <span className="sr-only">Remove</span>
      </div>
      <ol className="space-y-2">
        {tiers.map((t, i) => {
          const last = i === tiers.length - 1;
          const from = i === 0 ? 1 : Number(tiers[i - 1].upTo) + 1;
          return (
            <li key={t.key} className="grid grid-cols-1 gap-2 rounded-inner bg-surface-2 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_36px] sm:bg-transparent sm:p-0">
              <div>
                {last ? (
                  <div className={cx(inputClass, "flex items-center bg-surface-3 text-muted")}>
                    <span aria-hidden>∞</span>
                    <span className="sr-only">Tier {i + 1} has no upper limit</span>
                    {Number.isFinite(from) && from > 1 ? <span className="ml-1.5 text-[12px]">({from.toLocaleString()} and above)</span> : null}
                  </div>
                ) : (
                  <>
                    <label className="sr-only" htmlFor={`tier-up-${t.key}`}>Tier {i + 1} units up to</label>
                    <input id={`tier-up-${t.key}`} inputMode="numeric" value={t.upTo} onChange={(e) => set(t.key, { upTo: e.target.value })} placeholder="e.g. 1000" className={inputClass} />
                  </>
                )}
                <Err msg={errors[`tier-${t.key}-upTo`]} />
              </div>
              <div>
                <label className="sr-only" htmlFor={`tier-unit-${t.key}`}>Tier {i + 1} price per unit</label>
                <MoneyInput id={`tier-unit-${t.key}`} currency={currency} value={t.unit} onChange={(v) => set(t.key, { unit: v })} placeholder="0.00" />
                <Err msg={errors[`tier-${t.key}-unit`]} />
              </div>
              <div>
                <label className="sr-only" htmlFor={`tier-flat-${t.key}`}>Tier {i + 1} flat fee</label>
                <MoneyInput id={`tier-flat-${t.key}`} currency={currency} value={t.flat} onChange={(v) => set(t.key, { flat: v })} placeholder="0.00" />
                <Err msg={errors[`tier-${t.key}-flat`]} />
              </div>
              <button
                type="button"
                onClick={() => remove(t.key)}
                disabled={last || tiers.length <= 1}
                aria-label={`Remove tier ${i + 1}`}
                className="grid h-11 w-9 place-items-center rounded-full text-muted transition hover:bg-surface-3 hover:text-text disabled:invisible"
              >
                <Icon name="close" size={15} />
              </button>
            </li>
          );
        })}
      </ol>
      <Button type="button" size="sm" variant="soft" className="mt-3" icon={<Icon name="plus" size={14} />} onClick={add} disabled={tiers.length >= 20}>
        Add tier
      </Button>
    </div>
  );
}

/** Per-country unit amount overrides (country code → amount in the price's currency). */
export function CountryAmountsEditor({ rows, onChange, currency, errors }: { rows: CountryRow[]; onChange: (r: CountryRow[]) => void; currency: string; errors: DraftErrors }) {
  const countries = useCountries();
  const set = (key: number, patch: Partial<CountryRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div>
      {rows.length === 0 && <p className="text-[12.5px] text-muted">No overrides — every country pays the base amount.</p>}
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px] items-start gap-2">
            <div>
              <label className="sr-only" htmlFor={`co-c-${r.key}`}>Override {i + 1} country</label>
              <Select id={`co-c-${r.key}`} value={r.country} onChange={(e) => set(r.key, { country: e.target.value })}>
                <option value="">Country…</option>
                {r.country && !countries.some((c) => c.country === r.country) && <option value={r.country}>{r.country}</option>}
                {countries.map((c) => <option key={c.country} value={c.country}>{flag(c.country)} {c.name}</option>)}
              </Select>
              <Err msg={errors[`country-${r.key}`]} />
            </div>
            <div>
              <label className="sr-only" htmlFor={`co-a-${r.key}`}>Override {i + 1} amount</label>
              <MoneyInput id={`co-a-${r.key}`} currency={currency} value={r.amount} onChange={(v) => set(r.key, { amount: v })} placeholder="0.00" />
              <Err msg={errors[`country-amount-${r.key}`]} />
            </div>
            <button type="button" onClick={() => onChange(rows.filter((x) => x.key !== r.key))} aria-label={`Remove override ${i + 1}`} className="grid h-11 w-9 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-text">
              <Icon name="close" size={15} />
            </button>
          </li>
        ))}
      </ul>
      <Button type="button" size="sm" variant="soft" className="mt-3" icon={<Icon name="plus" size={14} />} onClick={() => onChange([...rows, { key: rowKey(), country: "", amount: "" }])}>
        Add country price
      </Button>
    </div>
  );
}
