"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { PublicCheckout } from "@/components/checkout/types";

/**
 * Embedded checkout (`/checkout/{id}?embed=1&parent_origin=…`, opened by /embed.js in a modal iframe).
 *
 * - Trims the page chrome (canvas washes, outer spacing) so the checkout sits flush in the modal.
 * - Tells the embedding page what happened with `postMessage`, only ever to the one origin that
 *   embedded us: `parent_origin` must be a bare http(s) origin AND match what the browser reports
 *   about our embedder (`location.ancestorOrigins`, else the referrer, which embed.js pins to its
 *   origin). If it can't be verified, nothing is posted — the checkout still works as a normal page.
 * - Links that would navigate the iframe away (back to the merchant, "Return to …") become messages.
 *
 * Messages: { source: "paymentapp-checkout", version: 1, type, session, ... } with type one of
 * ready | completed | canceled | expired | close_requested.
 */
export function EmbedBridge({ id }: { id: string }) {
  const params = useSearchParams();
  const embed = params.get("embed") === "1";
  const requested = params.get("parent_origin");

  useEffect(() => {
    if (!embed) return;
    const root = document.documentElement;
    root.dataset.paEmbed = "1";
    const parentOrigin = verifiedParentOrigin(requested);
    const post = (type: string, extra: Record<string, unknown> = {}) => {
      if (!parentOrigin) return;
      window.parent.postMessage({ source: "paymentapp-checkout", version: 1, type, session: id, ...extra }, parentOrigin);
    };

    let finished = false;
    let urls: { cancel?: string | null; success?: string | null } = {};
    const check = async () => {
      if (finished) return;
      const view = await api<PublicCheckout>(`/v1/public/checkout/${id}`, { anonymous: true }).catch(() => null);
      if (!view || finished) return;
      urls = { cancel: view.cancel_url, success: view.success_url };
      if (view.status === "complete") {
        finished = true;
        post("completed", { status: "complete", payment: view.payment_id ?? null, livemode: view.livemode });
      } else if (view.status === "expired") {
        finished = true;
        post("expired");
      }
    };

    // Poll only after the buyer submits the payment form (covers 3-D Secure and async methods like UPI).
    let poll: ReturnType<typeof setInterval> | null = null;
    let polls = 0;
    const onSubmit = () => {
      if (poll || finished) return;
      poll = setInterval(() => {
        polls++;
        if (finished || polls > 300) {
          if (poll) clearInterval(poll);
          return;
        }
        if (document.visibilityState === "visible") void check();
      }, 2000);
    };

    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || e.defaultPrevented || a.target === "_blank") return;
      const href = a.href;
      const same = (u?: string | null) => !!u && safeHref(u) === href;
      if (same(urls.cancel) && !finished) {
        e.preventDefault();
        post("canceled");
      } else if (same(urls.success) || (same(urls.cancel) && finished)) {
        e.preventDefault();
        post("close_requested", { reason: "done" });
      } else if (new URL(href).origin !== window.location.origin) {
        // Never navigate the embedded frame to another site; open it beside the checkout instead.
        e.preventDefault();
        window.open(href, "_blank", "noopener,noreferrer");
      }
    };

    const onKey = (e: KeyboardEvent) => {
      // Escape closes the modal unless a dialog inside the checkout (3-D Secure) is open.
      if (e.key === "Escape" && !document.querySelector('[role="dialog"][aria-modal="true"]')) post("close_requested", { reason: "escape" });
    };

    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey);
    void check().then(() => post("ready"));

    return () => {
      delete root.dataset.paEmbed;
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey);
      if (poll) clearInterval(poll);
      finished = true;
    };
  }, [embed, requested, id]);

  if (!embed) return null;
  return (
    <style>{`
      html[data-pa-embed] body { background: var(--bg); }
      html[data-pa-embed] main { max-width: none; padding-top: 12px; padding-bottom: 20px; }
      @media (min-width: 640px) { html[data-pa-embed] main { padding: 20px 24px 28px; } }
    `}</style>
  );
}

function safeHref(u: string) {
  try {
    return new URL(u, window.location.href).href;
  } catch {
    return null;
  }
}

/** The exact origin to post to, or null when it can't be verified. */
function verifiedParentOrigin(requested: string | null): string | null {
  if (!requested || window.parent === window) return null;
  let url: URL;
  try {
    url = new URL(requested);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.origin !== requested) return null;
  const ancestors = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  if (ancestors && ancestors.length > 0) return ancestors[0] === url.origin ? url.origin : null;
  if (!document.referrer) return null;
  try {
    return new URL(document.referrer).origin === url.origin ? url.origin : null;
  } catch {
    return null;
  }
}
