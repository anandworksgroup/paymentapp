"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { fixText } from "@/lib/merchant/text";
import { Button, ErrorNote, Field, Input, Segmented, Select, Skeleton, Spinner, cx } from "@/components/ui";
import { useCountries } from "@/components/merchant/useMeta";
import { CardFields, emptyCard, tokenizeCard, tokenizeUpi, type CardValue } from "./CardFields";
import { Receipt } from "./Receipt";
import { Summary } from "./Summary";
import { ThreeDSModal } from "./ThreeDSModal";
import type { Confirmation, PublicCheckout } from "./types";

type Phase = "form" | "paying" | "processing" | "success";

function guessCountry() {
  const region = (typeof navigator !== "undefined" ? navigator.language : "").split("-")[1];
  return region && region.length === 2 ? region.toUpperCase() : "";
}

/** Hosted checkout (URS §15-§16, §87-§90): buyer-facing, mobile-first, every amount quoted by the server. */
export function Checkout({ id }: { id: string }) {
  const countries = useCountries().filter((c) => c.checkout_enabled);
  const [s, setS] = useState<PublicCheckout | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [postal, setPostal] = useState("");
  const [business, setBusiness] = useState(false);
  const [taxId, setTaxId] = useState("");
  const [promo, setPromo] = useState("");
  const [promoError, setPromoError] = useState<string | null>(null);
  const [accept, setAccept] = useState(false);
  const [method, setMethod] = useState<"card" | "upi">("card");
  const [card, setCard] = useState<CardValue>(emptyCard);
  const [vpa, setVpa] = useState("");
  const [cardError, setCardError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<unknown>(null);
  const [phase, setPhase] = useState<Phase>("form");
  const [failure, setFailure] = useState<{ message: string; action?: string | null; code?: string | null } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Confirmation | null>(null);
  const [threeDS, setThreeDS] = useState(false);
  const [threeDSBusy, setThreeDSBusy] = useState<"pass" | "fail" | null>(null);
  const loaded = useRef(false);

  const quote = async (next: { country?: string; taxId?: string; coupon?: string | null }) => {
    const c = next.country ?? country;
    if (!c) return;
    setQuoting(true);
    setQuoteError(null);
    try {
      const t = next.taxId ?? (business ? taxId : "");
      const view = await api<PublicCheckout>(`/v1/public/checkout/${id}/quote`, {
        anonymous: true,
        body: { country: c, customer_type: t ? "b2b" : "b2c", tax_id: t || undefined, coupon: next.coupon ?? undefined },
      });
      setS(view);
      return view;
    } catch (e) {
      if (next.coupon) throw e;
      setQuoteError(e);
    } finally {
      setQuoting(false);
    }
  };

  // Initial load; guesses the buyer's country and asks the server for a tax-inclusive quote.
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    api<PublicCheckout>(`/v1/public/checkout/${id}`, { anonymous: true }).then(
      async (view) => {
        setS(view);
        setEmail(view.customer_email ?? "");
        const initial = view.country ?? guessCountry();
        if (initial) {
          setCountry(initial);
          if (!view.country && view.status === "open") {
            try {
              const q = await api<PublicCheckout>(`/v1/public/checkout/${id}/quote`, { anonymous: true, body: { country: initial, customer_type: "b2c" } });
              setS(q);
            } catch {
              setCountry("");
            }
          }
        }
        if (view.status === "complete") setPhase("success");
      },
      (e) => setLoadError(e),
    );
  }, [id]);

  // Async methods (e.g. UPI collect): poll until the session completes.
  useEffect(() => {
    if (phase !== "processing") return;
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      try {
        const view = await api<PublicCheckout>(`/v1/public/checkout/${id}`, { anonymous: true });
        if (view.status === "complete") {
          setS(view);
          setPhase("success");
        }
      } catch {
        /* keep waiting */
      }
      if (tries > 60) clearInterval(t);
    }, 3000);
    return () => clearInterval(t);
  }, [phase, id]);

  const handle = async (r: Confirmation) => {
    setResult(r);
    const status = r.payment_status ?? "";
    if (r.status === "complete" || status === "SUCCEEDED" || status === "no_payment_required") {
      const view = await api<PublicCheckout>(`/v1/public/checkout/${id}`, { anonymous: true }).catch(() => null);
      if (view) setS(view);
      setPhase("success");
      window.scrollTo({ top: 0 });
    } else if (status === "REQUIRES_ACTION") {
      setThreeDS(true);
    } else if (status === "FAILED") {
      setFailure({ message: r.failure_message ?? "Your payment could not be completed.", action: r.suggested_action, code: r.failure_code });
      setPhase("form");
    } else {
      setPhase("processing");
    }
  };

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!s) return;
    setError(null);
    setFailure(null);
    setCardError(null);
    setPhase("paying");
    let token: string | undefined;
    try {
      token = method === "upi" ? await tokenizeUpi(vpa) : await tokenizeCard(card);
    } catch (err) {
      setCardError(err instanceof ApiError ? err.message : "We couldn't read those card details.");
      setPhase("form");
      return;
    }
    try {
      const r = await api<Confirmation>(`/v1/public/checkout/${id}/confirm`, {
        anonymous: true,
        body: {
          email, name, country, postal_code: postal || undefined, tax_id: business && taxId ? taxId : undefined,
          customer_type: business && taxId ? "b2b" : "b2c", token, accept_terms: accept, coupon_code: s.coupon?.code ?? undefined,
        },
      });
      await handle(r);
    } catch (err) {
      setError(err);
      setPhase("form");
    }
  };

  const authenticate = async (res: "pass" | "fail") => {
    setThreeDSBusy(res);
    try {
      const r = await api<Confirmation>(`/v1/public/checkout/${id}/authenticate`, { anonymous: true, body: { result: res } });
      setThreeDS(false);
      await handle(r);
    } catch (err) {
      setThreeDS(false);
      setError(err);
      setPhase("form");
    } finally {
      setThreeDSBusy(null);
    }
  };

  const applyPromo = async () => {
    if (!promo.trim()) return;
    setPromoError(null);
    try {
      await quote({ coupon: promo.trim() });
      setPromo("");
    } catch (e) {
      setPromoError(e instanceof ApiError ? e.message : "That code can't be applied.");
    }
  };

  if (loadError)
    return <Frame><div className="card p-8"><h1 className="mb-3 text-[24px] tracking-[-0.03em]">This checkout isn&apos;t available</h1><ErrorNote error={loadError} /></div></Frame>;
  if (!s)
    return (
      <Frame>
        <div className="grid gap-5 lg:grid-cols-2" aria-busy="true" aria-label="Loading checkout"><Skeleton className="h-80 rounded-card" /><Skeleton className="h-[520px] rounded-card" /></div>
      </Frame>
    );

  if (s.status === "expired")
    return (
      <Frame>
        <div className="card mx-auto max-w-md p-8 text-center">
          <h1 className="text-[26px] tracking-[-0.03em]">This checkout has expired</h1>
          <p className="mt-2 text-[14px] text-muted">Checkout links are valid for 24 hours. Start again from {s.merchant.name}&apos;s site.</p>
          {s.cancel_url && <a href={s.cancel_url} className="mt-5 inline-flex h-11 items-center rounded-full bg-ink px-5 text-[14px] text-white">Back to {s.merchant.name}</a>}
        </div>
      </Frame>
    );

  const upi = s.payment_methods.includes("upi");
  const busy = phase === "paying";
  const payLabel = s.total === 0 ? (s.trial_days > 0 ? "Start free trial" : "Complete order") : `Pay ${money(s.total, s.currency)} ${s.currency}`;

  return (
    <Frame notice={s.test_mode_notice ? fixText(s.test_mode_notice) : null} onFillTest={phase === "form" && !s.livemode ? () => { setMethod("card"); setCard({ number: "4242 4242 4242 4242", expiry: "12 / 34", cvc: "123" }); } : undefined}>
      {phase === "success" ? (
        <div className="card mx-auto max-w-xl p-6 sm:p-9"><Receipt s={s} result={result} email={email} /></div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* Order summary */}
          <section aria-labelledby="summary-title" className="sage-gradient rounded-card p-6 sm:p-8">
            <div className="mb-6 flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-ink text-[14px] text-white" style={s.merchant.brand_color ? { background: s.merchant.brand_color } : undefined} aria-hidden>
                {s.merchant.name.slice(0, 1)}
              </span>
              <div>
                <div className="text-[15px] font-medium">{s.merchant.name}</div>
                {s.cancel_url && <a href={s.cancel_url} className="text-[12.5px] text-text-2 underline-offset-4 hover:underline">← Back</a>}
              </div>
            </div>
            <h2 id="summary-title" className="text-[13px] text-text-2">{s.mode === "subscription" ? "Subscribe to" : "Pay"} {s.merchant.name}</h2>
            <div className="mb-6 mt-1 flex items-baseline gap-2">
              <span className="numeral text-[44px] font-light leading-none tracking-[-0.03em]">{money(s.total, s.currency)}</span>
              <span className="text-[13px] text-muted">{s.currency}</span>
              {quoting && <Spinner className="ml-2 text-muted" />}
            </div>
            <Summary s={s} />
            <p className="mt-6 text-[12px] leading-relaxed text-text-2">
              Sold by <span className="font-medium">{s.seller_of_record}</span>, who handles payment, tax and refunds for {s.merchant.name}.
            </p>
          </section>

          {/* Payment form */}
          <form onSubmit={pay} className="card p-6 sm:p-8" aria-describedby="checkout-errors">
            <h1 className="mb-5 text-[24px] font-normal tracking-[-0.03em]">Checkout</h1>
            <div className="space-y-4">
              <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              <Field label="Full name"><Input autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                <Field label="Country or region" hint="Tax is calculated for this country">
                  <Select autoComplete="country" required value={country} onChange={(e) => { setCountry(e.target.value); quote({ country: e.target.value }); }}>
                    <option value="" disabled>Select…</option>
                    {countries.map((c) => <option key={c.country} value={c.country}>{c.name}</option>)}
                  </Select>
                </Field>
                <Field label="Postal code"><Input autoComplete="postal-code" value={postal} onChange={(e) => setPostal(e.target.value)} /></Field>
              </div>
              <label className="flex items-center gap-2.5 text-[13.5px] text-text-2">
                <input type="checkbox" className="h-4 w-4 accent-[var(--ink)]" checked={business} onChange={(e) => { setBusiness(e.target.checked); if (!e.target.checked && taxId) { setTaxId(""); quote({ taxId: "" }); } }} />
                I&apos;m purchasing as a business
              </label>
              {business && (
                <Field label="Business tax ID (optional)" hint="EU VAT numbers may qualify for reverse charge">
                  <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} onBlur={() => quote({ taxId })} placeholder="e.g. DE123456789" />
                </Field>
              )}
              <div aria-live="polite">{quoteError ? <ErrorNote error={quoteError} /> : null}</div>

              <Field label="Promotion code" error={promoError}>
                {s.coupon ? (
                  <div className="flex h-11 items-center justify-between rounded-field bg-lemon-soft px-3.5 text-[13.5px] text-lemon-ink">
                    <span><span className="font-medium">{s.coupon.code}</span> applied{s.coupon.name ? ` · ${s.coupon.name}` : ""}</span>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} placeholder="Add code" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyPromo(); } }} />
                    <Button type="button" variant="soft" onClick={applyPromo} disabled={!promo.trim() || !country}>Apply</Button>
                  </div>
                )}
              </Field>

              <fieldset className="space-y-3 pt-1">
                <legend className="mb-2 text-[12.5px] font-medium text-text-2">Payment method</legend>
                {upi && <Segmented<"card" | "upi"> value={method} onChange={setMethod} options={[{ value: "card", label: "Card" }, { value: "upi", label: "UPI" }]} />}
                {method === "card" ? (
                  <CardFields value={card} onChange={setCard} error={cardError} />
                ) : (
                  <Field label="UPI ID" hint="e.g. name@bank — you'll approve the payment in your UPI app" error={cardError}>
                    <Input autoComplete="off" required value={vpa} onChange={(e) => setVpa(e.target.value)} placeholder="name@upi" />
                  </Field>
                )}
              </fieldset>

              <label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-text-2">
                <input type="checkbox" required className="mt-0.5 h-4 w-4 accent-[var(--ink)]" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
                <span>
                  I agree to the {s.terms ? `${s.terms.title} (version ${s.terms.version})` : "buyer terms"} and understand {s.seller_of_record.replace(/ as Merchant of Record$/, "")} is the seller of record.
                  {s.mode === "subscription" && " I authorise recurring charges until I cancel."}
                </span>
              </label>

              <div id="checkout-errors" aria-live="assertive" className="space-y-2">
                {failure && (
                  <div className="rounded-inner bg-rose-soft px-4 py-3 text-[13px] text-rose-ink" role="alert">
                    <div className="font-medium">{failure.message}</div>
                    {failure.action && <div className="mt-0.5 opacity-85">{failure.action}</div>}
                    <div className="mt-1 opacity-70">You haven&apos;t been charged. Check the details or try another card.</div>
                  </div>
                )}
                {error ? <ErrorNote error={error} /> : null}
              </div>

              {phase === "processing" ? (
                <div className="flex items-center gap-3 rounded-inner bg-lemon-soft px-4 py-4 text-[13.5px] text-lemon-ink" role="status">
                  <Spinner />
                  <div><div className="font-medium">Waiting for confirmation</div><div className="opacity-80">Approve the request in your payment app. This page updates automatically.</div></div>
                </div>
              ) : (
                <Button type="submit" className="h-12 w-full text-[15px]" loading={busy} disabled={quoting || !country}>{payLabel}</Button>
              )}
              <p className="flex items-center justify-center gap-1.5 text-[11.5px] text-muted">
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M5 9h10v8H5zM7 9V6.5a3 3 0 0 1 6 0V9" /></svg>
                Card details go straight to the payment processor.
              </p>
            </div>
          </form>
        </div>
      )}
      <ThreeDSModal open={threeDS} merchant={s.merchant.name} total={s.total} currency={s.currency} busy={threeDSBusy} onResult={authenticate} />
    </Frame>
  );
}

function Frame({ children, notice, onFillTest }: { children: React.ReactNode; notice?: string | null; onFillTest?: () => void }) {
  return (
    <div className="min-h-screen">
      {notice && (
        <div className={cx("flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-lemon px-4 py-2 text-center text-[12.5px] text-lemon-ink")} role="note">
          <span className="font-semibold">Test mode</span>
          <span>{notice.replace(/^Test mode\s*[—-]\s*/, "")}</span>
          {onFillTest && <button type="button" onClick={onFillTest} className="rounded-full bg-white/60 px-2.5 py-0.5 font-medium hover:bg-white">Fill test card</button>}
        </div>
      )}
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-10">{children}</main>
    </div>
  );
}
