"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { ErrorNote, Spinner } from "@/components/ui";

type LinkView = { id: string; status: string; merchant: { name: string }; product: { name: string; description?: string | null }; price: { unit_amount: number; currency: string; type: string; interval?: string | null } };

/** Payment link entry: loads the link, opens a checkout session for it, then hands off to /checkout. */
export default function PayLinkPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [link, setLink] = useState<LinkView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const l = await api<LinkView>(`/v1/public/links/${id}`, { anonymous: true });
        setLink(l);
        // Affiliate links look like /pay/{id}?ref=CODE; the code is attributed when the checkout is created.
        const ref = new URLSearchParams(window.location.search).get("ref")?.trim();
        const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
        const s = await api<{ checkout_session: string }>(`/v1/public/links/${id}${query}`, { method: "POST", anonymous: true });
        router.replace(`/checkout/${s.checkout_session}`);
      } catch (e) {
        setError(e);
      }
    })();
  }, [id, router]);

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="card w-full max-w-sm p-8 text-center" aria-live="polite">
        {error ? (
          <>
            <h1 className="mb-3 text-[22px] tracking-[-0.03em]">This link can&apos;t be used</h1>
            <ErrorNote error={error} />
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full sage-gradient text-sage-700"><Spinner /></div>
            {link ? (
              <>
                <div className="text-[13px] text-muted">{link.merchant.name}</div>
                <div className="mt-1 text-[18px]">{link.product.name}</div>
                <div className="numeral mt-1 text-[15px] text-text-2">
                  {money(link.price.unit_amount, link.price.currency, { code: true })}
                  {link.price.type === "recurring" && link.price.interval ? ` / ${link.price.interval}` : ""}
                </div>
                <p className="mt-4 text-[13px] text-muted">Opening secure checkout…</p>
              </>
            ) : (
              <p className="text-[13px] text-muted">Loading…</p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
