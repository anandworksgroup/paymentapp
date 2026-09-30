"use client";

import Link from "next/link";
import { useState } from "react";
import { api, download } from "@/lib/api";
import { money } from "@/lib/format";
import type { Payment } from "@/lib/merchant/types";
import { Amount, Button, ErrorNote, Modal, StatusChip } from "@/components/ui";
import { ConfirmModal } from "../common";
import { useMerchant, useStepUp, useToast } from "../context";
import { Icon } from "../icons";
import type { InvoiceFull } from "./types";

type Action = "finalize" | "pay" | "void" | "mark_uncollectible";

const COPY: Record<Action, { title: string; label: string; body: (i: InvoiceFull) => string; danger?: boolean }> = {
  finalize: {
    title: "Finalize invoice?",
    label: "Finalize",
    body: () => "The invoice becomes open and payable. Its lines and amounts can no longer be edited.",
  },
  pay: {
    title: "Charge this invoice now?",
    label: "Charge now",
    body: (i) => `We'll charge ${money(i.amount_due, i.currency, { code: true })} to the customer's saved payment method. If none is saved, the invoice stays open.`,
  },
  void: {
    title: "Void invoice?",
    label: "Void invoice",
    danger: true,
    body: () => "A voided invoice is kept for your records but can no longer be paid. Use this for invoices issued by mistake.",
  },
  mark_uncollectible: {
    title: "Mark as uncollectible?",
    label: "Mark uncollectible",
    danger: true,
    body: () => "Use this when you don't expect to be paid. The invoice stays on record as a bad debt and stops being collected.",
  },
};

export function InvoiceActions({ invoice, onDone }: { invoice: InvoiceFull; onDone: () => void }) {
  const { can } = useMerchant();
  const withStepUp = useStepUp();
  const toast = useToast();
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [payResult, setPayResult] = useState<{ invoice: InvoiceFull; payment: Payment | null } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const s = invoice.status;
  const write = can("invoices.write");

  const run = async () => {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      if (action === "pay") {
        const r = await withStepUp(() => api<{ invoice: InvoiceFull; payment: Payment | null }>(`/v1/invoices/${invoice.id}/pay`, { method: "POST" }));
        setPayResult(r);
      } else {
        await api(`/v1/invoices/${invoice.id}/${action}`, { method: "POST" });
        toast(action === "finalize" ? "Invoice finalized" : action === "void" ? "Invoice voided" : "Invoice marked uncollectible");
      }
      setAction(null);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const pdf = async () => {
    setDownloading(true);
    try {
      await download(`/v1/invoices/${invoice.id}/pdf`, `${invoice.number}.pdf`);
    } catch {
      toast("Couldn't download the PDF", "error");
    } finally {
      setDownloading(false);
    }
  };

  const open = (a: Action) => {
    setError(null);
    setAction(a);
  };

  return (
    <>
      <Button variant="soft" icon={<Icon name="download" size={16} />} loading={downloading} onClick={pdf}>Download PDF</Button>
      {write && s === "DRAFT" && <Button onClick={() => open("finalize")}>Finalize</Button>}
      {write && (s === "OPEN" || s === "PAST_DUE") && <Button onClick={() => open("pay")} icon={<Icon name="card" size={16} />}>Charge now</Button>}
      {write && (s === "OPEN" || s === "PAST_DUE" || s === "PARTIALLY_PAID") && <Button variant="soft" onClick={() => open("mark_uncollectible")}>Mark uncollectible</Button>}
      {write && !["PAID", "VOID"].includes(s) && <Button variant="danger" onClick={() => open("void")}>Void</Button>}

      {action && (
        <ConfirmModal
          open
          onClose={() => setAction(null)}
          title={COPY[action].title}
          confirmLabel={COPY[action].label}
          danger={COPY[action].danger}
          busy={busy}
          error={error}
          onConfirm={run}
        >
          <p>{COPY[action].body(invoice)}</p>
        </ConfirmModal>
      )}

      {payResult && (
        <Modal open onClose={() => setPayResult(null)} title="Charge result" footer={<Button onClick={() => setPayResult(null)}>Done</Button>}>
          {payResult.payment ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline gap-3">
                <Amount minor={payResult.payment.amount} currency={payResult.payment.currency} size="md" />
                <StatusChip status={payResult.payment.status} />
              </div>
              {payResult.payment.failure_message && <ErrorNote error={{ message: payResult.payment.failure_message }} />}
              <p className="text-[13.5px] text-muted">Invoice is now <span className="text-text">{payResult.invoice.status.toLowerCase().replace(/_/g, " ")}</span>.</p>
              <Link href={`/payments/${payResult.payment.id}`} className="inline-flex items-center gap-1 text-[13.5px] text-text underline-offset-4 hover:underline">
                View payment {payResult.payment.id} <Icon name="right" size={14} />
              </Link>
            </div>
          ) : (
            <p className="text-[13.5px] text-text-2">
              {payResult.invoice.status === "PAID"
                ? "Nothing was due, so the invoice was marked paid without a charge."
                : "The customer has no saved payment method, so nothing was charged. The invoice stays open; share a portal link so they can pay."}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
