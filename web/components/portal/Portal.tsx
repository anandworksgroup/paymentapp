"use client";

import { useState } from "react";
import { api, API_URL } from "@/lib/api";
import { useApi } from "@/lib/merchant/hooks";
import type { Entitlement, Invoice, PaymentMethod, Subscription } from "@/lib/merchant/types";
import { Amount, Button, Card, CardHeader, Chip, Empty, ErrorNote, Modal, Skeleton, StatusChip } from "@/components/ui";
import { date, titleCase } from "@/lib/format";
import { CardFields, emptyCard, tokenizeCard, type CardValue } from "@/components/checkout/CardFields";

type PortalView = {
  merchant: { name: string; brand_color?: string | null; logo_url?: string | null; support_email?: string | null };
  customer: { id: string; name?: string | null; email?: string | null; country?: string | null; tax_id?: string | null };
  subscriptions: Subscription[];
  invoices: Invoice[];
  payment_methods: PaymentMethod[];
  entitlements: Entitlement[];
  credits: number;
};

export function Portal({ token }: { token: string }) {
  const base = `/v1/portal/${token}`;
  const res = useApi<PortalView>(base, { anonymous: true });
  const [note, setNote] = useState<string | null>(null);

  if (res.error && !res.data)
    return (
      <Shell>
        <Card className="mx-auto max-w-md text-center">
          <h1 className="mb-3 text-[24px] tracking-[-0.03em]">This link isn&apos;t valid anymore</h1>
          <ErrorNote error={res.error} />
          <p className="mt-4 text-[13px] text-muted">Portal links expire after an hour. Ask the merchant for a new one.</p>
        </Card>
      </Shell>
    );
  if (!res.data)
    return (
      <Shell>
        <div className="space-y-4" aria-busy="true" aria-label="Loading"><Skeleton className="h-24 rounded-card" /><Skeleton className="h-64 rounded-card" /></div>
      </Shell>
    );

  const v = res.data;
  return (
    <Shell merchant={v.merchant.name}>
      <header className="mb-7">
        <div className="text-[12px] uppercase tracking-[0.08em] text-muted">{v.merchant.name} · customer portal</div>
        <h1 className="mt-1 text-[34px] font-normal tracking-[-0.03em]">Hi{v.customer.name ? `, ${v.customer.name.split(" ")[0]}` : ""}</h1>
        <p className="mt-1 text-[14px] text-muted">Manage your subscriptions, invoices and payment details{v.customer.email ? ` for ${v.customer.email}` : ""}.</p>
      </header>
      <div aria-live="polite">{note && <p className="mb-4 rounded-inner bg-sage-100 px-4 py-3 text-[13px] text-sage-700">{note}</p>}</div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Subscriptions" />
            {v.subscriptions.length === 0 ? <Empty title="No subscriptions">You don&apos;t have any subscriptions with {v.merchant.name}.</Empty> : (
              <ul className="space-y-3">
                {v.subscriptions.map((s) => <SubscriptionRow key={s.id} s={s} base={base} onDone={(m) => { setNote(m); res.reload(); }} />)}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Invoices" />
            {v.invoices.length === 0 ? <Empty title="No invoices yet" /> : (
              <ul className="divide-y divide-line">
                {v.invoices.map((i) => <InvoiceRow key={i.id} inv={i} base={base} />)}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <PaymentMethods pms={v.payment_methods} base={base} onDone={(m) => { setNote(m); res.reload(); }} />
          <Card>
            <CardHeader title="Your access" subtitle="Products and features you currently have" />
            {v.entitlements.length === 0 ? <p className="text-[13px] text-muted">No active entitlements.</p> : (
              <ul className="space-y-2">
                {v.entitlements.map((e) => (
                  <li key={e.id} className="rounded-inner bg-surface-2 px-4 py-3 text-[13px]">
                    <div className="flex items-center justify-between gap-2"><span className="font-medium">{e.features_csv ? e.features_csv.split(",").map((f) => titleCase(f.trim())).join(", ") : "Access"}</span><StatusChip status={e.status} /></div>
                    <div className="mt-0.5 text-muted">{e.seats} seat{e.seats === 1 ? "" : "s"}{e.expires_at ? ` · until ${date(e.expires_at)}` : ""}</div>
                    {e.license_key && <div className="mt-1 font-mono text-[12px] text-text-2">{e.license_key}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {v.credits > 0 && (
            <Card>
              <CardHeader title="Credits" />
              <div className="numeral text-[34px] font-light">{v.credits.toLocaleString()}</div>
              <div className="text-[12.5px] text-muted">available</div>
            </Card>
          )}
          {v.merchant.support_email && <p className="text-center text-[12.5px] text-muted">Questions? Contact <a className="text-text underline-offset-4 hover:underline" href={`mailto:${v.merchant.support_email}`}>{v.merchant.support_email}</a></p>}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children, merchant }: { children: React.ReactNode; merchant?: string }) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      {merchant && <div className="sr-only">{merchant}</div>}
      {children}
    </main>
  );
}

function SubscriptionRow({ s, base, onDone }: { s: Subscription; base: string; onDone: (m: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const active = ["ACTIVE", "TRIALING", "PAST_DUE"].includes(s.status);
  const act = async (path: "cancel" | "resume") => {
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/subscriptions/${s.id}/${path}`, { method: "POST", anonymous: true });
      setConfirm(false);
      onDone(path === "cancel" ? "Your subscription will end at the close of the current period." : "Your subscription will continue to renew.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="rounded-inner bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={s.status} />
        {s.cancel_at_period_end && <Chip tone="peach">Ends {date(s.current_period_end)}</Chip>}
        <span className="ml-auto text-[12.5px] text-muted">{s.status === "TRIALING" && s.trial_end ? `Trial ends ${date(s.trial_end)}` : `Current period ends ${date(s.current_period_end)}`}</span>
      </div>
      <div className="mt-1 font-mono text-[11.5px] text-faint">{s.id}</div>
      {active && (
        <div className="mt-3">
          {s.cancel_at_period_end ? (
            <Button size="sm" variant="soft" loading={busy} onClick={() => act("resume")}>Keep my subscription</Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>Cancel subscription</Button>
          )}
        </div>
      )}
      {error && !confirm ? <div className="mt-2" aria-live="assertive"><ErrorNote error={error} /></div> : null}
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Cancel subscription?" footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Keep it</Button><Button variant="danger" loading={busy} onClick={() => act("cancel")}>Cancel at period end</Button></>}>
        <p className="text-[14px] text-text-2">You keep access until {date(s.current_period_end)}. You won&apos;t be charged again, and you can undo this before then.</p>
        <div className="mt-3" aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
      </Modal>
    </li>
  );
}

function InvoiceRow({ inv, base }: { inv: Invoice; base: string }) {
  const [error, setError] = useState<string | null>(null);
  const pdf = async () => {
    setError(null);
    try {
      // The portal token in the path is the credential; no merchant headers are sent.
      const r = await fetch(`${API_URL}${base}/invoices/${inv.id}/pdf`);
      if (!r.ok) throw new Error();
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${inv.number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Download failed. Try again.");
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] text-text">{inv.number}</div>
        <div className="text-[12px] text-muted">{date(inv.finalized_at ?? inv.created_at)}{inv.due_date && inv.status !== "PAID" ? ` · due ${date(inv.due_date)}` : ""}</div>
      </div>
      <Amount minor={inv.total} currency={inv.currency} size="sm" />
      <StatusChip status={inv.status} />
      <Button size="sm" variant="soft" onClick={pdf} aria-label={`Download invoice ${inv.number} as PDF`}>PDF</Button>
      {error && <span role="alert" className="w-full text-[12px] text-rose-ink">{error}</span>}
    </li>
  );
}

function PaymentMethods({ pms, base, onDone }: { pms: PaymentMethod[]; base: string; onDone: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<CardValue>(emptyCard);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = await tokenizeCard(card);
      await api(`${base}/payment_methods`, { anonymous: true, body: { token } });
      setOpen(false);
      setCard(emptyCard);
      onDone("Your new card is saved and will be used for upcoming payments.");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Payment method" action={<Button size="sm" variant="soft" onClick={() => setOpen(true)}>Update</Button>} />
      {pms.length === 0 ? <p className="text-[13px] text-muted">No saved payment method.</p> : (
        <ul className="space-y-2">
          {pms.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-inner sage-gradient px-4 py-4">
              <span className="text-[14px]">{p.type === "upi" ? "UPI" : titleCase(p.brand ?? "Card")} •••• {p.last4}</span>
              {p.exp_month && <span className="text-[12px] text-text-2">{String(p.exp_month).padStart(2, "0")}/{String(p.exp_year).slice(-2)}</span>}
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Update payment method">
        <form onSubmit={save} className="space-y-4">
          <CardFields value={card} onChange={setCard} idPrefix="portal-card" />
          <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>Save card</Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}
