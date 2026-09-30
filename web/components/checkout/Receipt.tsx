import { Amount, Chip } from "@/components/ui";
import type { Confirmation, PublicCheckout } from "./types";
import { Summary } from "./Summary";

export function Receipt({ s, result, email }: { s: PublicCheckout; result: Confirmation | null; email?: string | null }) {
  const paymentId = result?.payment ?? s.payment_id;
  const successUrl = result?.success_url ?? s.success_url;
  const noCharge = result?.payment_status === "no_payment_required" || s.total === 0;
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <div className="text-center">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full sage-gradient text-sage-700" aria-hidden>
          <svg width="28" height="28" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10.5 8 14.5 16 5.5" /></svg>
        </div>
        <h1 className="text-[28px] font-normal tracking-[-0.03em]">{s.mode === "subscription" ? "You're subscribed" : "Payment successful"}</h1>
        <p className="mt-1 text-[14px] text-muted">
          {noCharge ? "Nothing was charged today." : <>Thanks for your purchase from {s.merchant.name}.</>}
          {(email ?? s.customer_email) && <> A receipt is on its way to <span className="text-text">{email ?? s.customer_email}</span>.</>}
        </p>
      </div>

      <div className="rounded-inner bg-surface-2 p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <span className="text-[13px] text-muted">{noCharge ? "Due today" : "Amount paid"}</span>
          <Amount minor={s.total} currency={s.currency} size="md" />
        </div>
        <Summary s={s} />
      </div>

      <dl className="grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-2">
        {result?.order && <Ref label="Order" value={result.order} />}
        {paymentId && <Ref label="Payment" value={paymentId} />}
        {result?.subscription && <Ref label="Subscription" value={result.subscription} />}
      </dl>

      <p className="text-center text-[12.5px] text-muted">{s.seller_of_record}. Charges appear on your statement from the platform on behalf of {s.merchant.name}.</p>
      {!s.livemode && <p className="text-center"><Chip tone="lemon">Test mode — no real money moved</Chip></p>}
      {successUrl && (
        <a href={successUrl} className="flex h-11 items-center justify-center rounded-full bg-ink text-[14px] font-medium text-white">Return to {s.merchant.name}</a>
      )}
    </div>
  );
}

function Ref({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-line px-3.5 py-2.5">
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd className="truncate font-mono text-[12px] text-text-2">{value}</dd>
    </div>
  );
}
