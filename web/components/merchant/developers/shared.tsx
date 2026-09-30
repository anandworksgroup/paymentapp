"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button, Chip, Modal, cx, type Tone } from "@/components/ui";
import { CopyButton } from "../common";
import { Icon } from "../icons";

/**
 * Event types the platform emits (grep of `Emit("…")` in the backend). Endpoints can subscribe to an
 * exact type, a `resource.*` prefix, or `*` for everything.
 */
export const EVENT_GROUPS: { group: string; types: string[] }[] = [
  { group: "payment", types: ["payment.created", "payment.processing", "payment.requires_action", "payment.succeeded", "payment.failed", "payment.cancelled", "payment.refunded", "payment.review_approved"] },
  { group: "refund", types: ["refund.created", "refund.succeeded", "refund.failed"] },
  { group: "dispute", types: ["dispute.created", "dispute.updated", "dispute.won", "dispute.lost"] },
  { group: "checkout", types: ["checkout.session.created", "checkout.session.completed"] },
  { group: "order", types: ["order.paid", "order.updated"] },
  { group: "subscription", types: ["subscription.created", "subscription.updated", "subscription.renewed", "subscription.past_due", "subscription.trial_ended", "subscription.paused", "subscription.resumed", "subscription.cancelled"] },
  { group: "invoice", types: ["invoice.created", "invoice.finalized", "invoice.paid", "invoice.payment_failed", "invoice.payment_action_required", "invoice.voided", "invoice.marked_uncollectible"] },
  { group: "credit_note", types: ["credit_note.created"] },
  { group: "payout", types: ["payout.created", "payout.processing", "payout.completed", "payout.failed"] },
  { group: "customer", types: ["customer.created", "customer.updated"] },
  { group: "product", types: ["product.created", "product.updated"] },
  { group: "price", types: ["price.created", "price.updated"] },
  { group: "payment_link", types: ["payment_link.created"] },
  { group: "entitlement", types: ["entitlement.granted", "entitlement.updated", "entitlement.revoked"] },
  { group: "usage", types: ["usage.recorded"] },
  { group: "credits", types: ["credits.updated"] },
  { group: "merchant", types: ["merchant.updated"] },
  { group: "compliance", types: ["compliance.action_required"] },
];

export const ALL_EVENT_TYPES = EVENT_GROUPS.flatMap((g) => g.types);

/** Where an event's object lives in the dashboard (falls back to related ids inside the payload). */
export function objectHref(objectType: string, objectId: string, data?: unknown): string | null {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const map: Record<string, string> = {
    payment: `/payments/${objectId}`, order: `/orders/${objectId}`, customer: `/customers/${objectId}`, subscription: `/subscriptions/${objectId}`,
    invoice: `/invoices/${objectId}`, product: `/products/${objectId}`, dispute: `/disputes/${objectId}`, payout: `/payouts/${objectId}`,
    checkout_session: "/checkout-sessions", payment_link: "/payment-links", organization: "/settings", meter: "/meters", usage_event: "/usage",
  };
  if (map[objectType]) return map[objectType];
  if (typeof d.payment_id === "string") return `/payments/${d.payment_id}`;
  if (objectType === "price" && typeof d.product_id === "string") return `/products/${d.product_id}`;
  if (typeof d.customer_id === "string") return `/customers/${d.customer_id}`;
  return null;
}

export function statusTone(code: number): Tone {
  if (code >= 500) return "rose";
  if (code === 429) return "peach";
  if (code >= 400) return "peach";
  if (code >= 300) return "sky";
  return "sage";
}

export function HttpStatus({ code }: { code?: number | null }) {
  if (code === null || code === undefined) return <span className="text-faint">—</span>;
  return <Chip tone={statusTone(code)} className="font-mono">{code}</Chip>;
}

export function MethodPill({ method }: { method: string }) {
  const tones: Record<string, Tone> = { GET: "sky", POST: "sage", PATCH: "lemon-soft", DELETE: "rose", PUT: "lemon-soft" };
  return <Chip tone={tones[method] ?? "neutral"} className="w-14 justify-center font-mono">{method}</Chip>;
}

const DELIVERY_TONES: Record<string, Tone> = { succeeded: "sage", pending: "lemon-soft", retrying: "peach", dead: "rose", failed: "rose" };
export function DeliveryStatus({ status }: { status: string }) {
  return <Chip tone={DELIVERY_TONES[status] ?? "neutral"}>{status === "dead" ? "Gave up" : status.charAt(0).toUpperCase() + status.slice(1)}</Chip>;
}

const ENDPOINT_TONES: Record<string, Tone> = { enabled: "sage", failing: "peach", disabled: "neutral" };
export function EndpointStatus({ status }: { status: string }) {
  return <Chip tone={ENDPOINT_TONES[status] ?? "neutral"}>{status.charAt(0).toUpperCase() + status.slice(1)}</Chip>;
}

export function ModeChip({ livemode }: { livemode: boolean }) {
  return <Chip tone={livemode ? "ink" : "lemon"}>{livemode ? "Live" : "Test"}</Chip>;
}

/** A secret shown exactly once, with copy and a clear warning. */
export function SecretOnceModal({ open, title, secret, onClose, children }: { open: boolean; title: string; secret: string; onClose: () => void; children?: ReactNode }) {
  const [ack, setAck] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={<Button onClick={onClose} disabled={!ack}>Done</Button>}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-inner bg-lemon-soft px-4 py-3 text-[13px] text-lemon-ink" role="note">
          <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
          <span>Copy this now and store it somewhere safe, like your secrets manager. <strong className="font-medium">You won&apos;t see it again</strong> — if you lose it, create a new one.</span>
        </div>
        <div className="rounded-inner bg-surface-2 p-4">
          <code className="block break-all font-mono text-[13px] text-text">{secret}</code>
          <div className="mt-3"><CopyButton value={secret} label="Copy secret" /></div>
        </div>
        {children}
        <label className="flex items-center gap-2 text-[13px] text-text-2">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="h-4 w-4 accent-ink" />
          I&apos;ve copied and stored it
        </label>
      </div>
    </Modal>
  );
}

/** Code snippet with a copy button (quickstart). */
export function Snippet({ title, code, className }: { title: string; code: string; className?: string }) {
  return (
    <div className={cx("rounded-inner bg-surface-2", className)}>
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <span className="text-[12.5px] font-medium text-text-2">{title}</span>
        <CopyButton value={code} label="Copy" />
      </div>
      <pre className="overflow-x-auto px-4 pb-4 pt-2 font-mono text-[12px] leading-relaxed text-text-2">{code}</pre>
    </div>
  );
}

export function DevNav({ current }: { current: string }) {
  const items = [
    { href: "/developers", label: "Overview" },
    { href: "/developers/api-keys", label: "API keys" },
    { href: "/developers/webhooks", label: "Webhooks" },
    { href: "/developers/events", label: "Events" },
    { href: "/developers/logs", label: "Logs" },
  ];
  return (
    <nav aria-label="Developer sections" className="mb-5 flex gap-1 overflow-x-auto rounded-full bg-surface-2 p-1 sm:inline-flex">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.href === current ? "page" : undefined}
          className={cx("h-8 shrink-0 rounded-full px-3.5 text-[12.5px] font-medium leading-8 transition", i.href === current ? "bg-ink text-white" : "text-text-2 hover:text-text")}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
