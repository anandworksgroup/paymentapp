import { Amount } from "@/components/ui";
import { money } from "@/lib/format";
import type { PublicCheckout } from "./types";

/** Order summary: every figure is the server's quote (line amounts, discount, tax and total). */
export function Summary({ s }: { s: PublicCheckout }) {
  return (
    <div>
      <ul className="space-y-4">
        {s.line_items.map((l) => (
          <li key={l.price_id} className="flex items-start gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[16px] bg-white/80 text-[18px] text-sage-700" aria-hidden>
              {(l.product?.name ?? l.description ?? "•").slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] text-text">{l.product?.name ?? l.description}</div>
              {l.product?.description && <div className="text-[12.5px] text-muted">{l.product.description}</div>}
              {l.quantity > 1 && <div className="text-[12.5px] text-muted">Qty {l.quantity} × {money(l.unit_amount, s.currency)}</div>}
            </div>
            <div className="text-right text-[14px] numeral">{money(l.amount, s.currency)}</div>
          </li>
        ))}
      </ul>

      {(s.trial_days > 0 || s.recurring) && (
        <div className="mt-5 rounded-inner bg-white/70 px-4 py-3 text-[13px] text-text-2">
          {s.trial_days > 0 && <div className="font-medium text-text">{s.trial_days}-day free trial</div>}
          {s.recurring && <div>{s.trial_days > 0 ? "Then " : "Renews "}{s.recurring}. Cancel anytime from your customer portal.</div>}
        </div>
      )}

      <dl className="mt-5 space-y-2 border-t border-black/5 pt-4 text-[13.5px]">
        <Row label="Subtotal" value={money(s.subtotal, s.currency)} />
        {s.discount > 0 && <Row label={s.coupon ? `Discount (${s.coupon.code})` : "Discount"} value={`−${money(s.discount, s.currency)}`} />}
        <Row
          label={s.tax_label ?? "Tax"}
          value={s.country ? money(s.tax, s.currency) : "Calculated after you choose a country"}
          muted={!s.country}
        />
        {s.line_items.some((l) => l.tax_type === "reverse_charge") && (
          <p className="text-[12px] text-muted">Reverse charge: VAT to be accounted for by the recipient.</p>
        )}
      </dl>
      <div className="mt-4 flex items-baseline justify-between border-t border-black/5 pt-4">
        <span className="text-[14px] text-text-2">{s.trial_days > 0 && s.total === 0 ? "Due today" : "Total"}</span>
        <Amount minor={s.total} currency={s.currency} size="md" />
      </div>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={muted ? "text-right text-[12.5px] text-muted" : "numeral text-text"}>{value}</dd>
    </div>
  );
}
