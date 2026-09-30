"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { date } from "@/lib/format";
import { useAction } from "@/lib/merchant/hooks";
import type { Customer } from "@/lib/merchant/types";
import { Button, ErrorNote, Modal } from "@/components/ui";
import { ConfirmModal, CopyButton } from "../common";
import { useToast } from "../context";
import { Icon } from "../icons";

type PortalSession = { object: "portal_session"; url: string; expires_at: string };

/**
 * Issues a one-hour customer portal link (POST /v1/customers/{id}/portal_sessions). The API returns a
 * path; the full URL is the web app's origin plus that path.
 */
export function PortalSessionButton({ customer }: { customer: Customer }) {
  const [session, setSession] = useState<{ full: string; expires_at: string } | null>(null);
  const act = useAction();
  const [open, setOpen] = useState(false);

  const create = async () => {
    setOpen(true);
    const r = await act.run(() => api<PortalSession>(`/v1/customers/${customer.id}/portal_sessions`, { method: "POST" }));
    if (r) setSession({ full: `${window.location.origin}${r.url}`, expires_at: r.expires_at });
  };

  return (
    <>
      <Button variant="soft" icon={<Icon name="external" size={16} />} loading={act.busy && !open} onClick={create}>Open portal session</Button>
      <Modal
        open={open}
        onClose={() => { setOpen(false); setSession(null); act.setError(null); }}
        title="Customer portal link"
        footer={<Button variant="ghost" onClick={() => { setOpen(false); setSession(null); }}>Done</Button>}
      >
        <p className="text-[13.5px] text-muted">
          Share this link with {customer.name ?? customer.email ?? "the customer"} so they can manage subscriptions, payment methods and invoices. Anyone with the link can act as this customer until it expires.
        </p>
        <div aria-live="assertive" className="mt-4">
          {act.error ? <ErrorNote error={act.error} /> : null}
        </div>
        {act.busy && <p className="mt-4 text-[13px] text-muted" aria-busy="true">Creating a link…</p>}
        {session && (
          <div className="mt-4 space-y-3">
            <div className="break-all rounded-inner bg-surface-2 p-4 font-mono text-[12.5px] text-text-2">{session.full}</div>
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton value={session.full} label="Copy link" />
              <a href={session.full} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1 rounded-full bg-ink px-3 text-[11.5px] text-white hover:bg-ink-2">
                <Icon name="external" size={13} /> Open in new tab
              </a>
              <span className="text-[12.5px] text-muted">Expires {date(session.expires_at, true)}</span>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

/** Privacy deletion (POST /v1/customers/{id}/anonymize): personal data removed, financial records kept. */
export function AnonymizeButton({ customer, onDone }: { customer: Customer; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const act = useAction();
  const toast = useToast();
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>Anonymize</Button>
      <ConfirmModal
        open={open}
        onClose={() => { setOpen(false); act.setError(null); }}
        title="Anonymize this customer?"
        confirmLabel="Anonymize permanently"
        danger
        busy={act.busy}
        error={act.error}
        onConfirm={async () => {
          const r = await act.run(() => api(`/v1/customers/${customer.id}/anonymize`, { method: "POST" }));
          if (r) {
            toast("Customer anonymized");
            setOpen(false);
            onDone();
          }
        }}
      >
        <p>This handles a privacy (erasure) request for <span className="text-text">{customer.name ?? customer.email ?? customer.id}</span>.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Removed: name, email, phone, address, postal code and metadata, plus the email on their payments and invoices.</li>
          <li>Kept: payments, invoices, refunds, tax records and ledger entries, which the law requires you to retain.</li>
        </ul>
        <p>This can&apos;t be undone.</p>
      </ConfirmModal>
    </>
  );
}
