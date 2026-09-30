"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

/** Origin of the buyer-facing pages (hosted checkout and payment links). */
export const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
export const payUrl = (id: string) => `${APP_ORIGIN}/pay/${id}`;
export const checkoutUrl = (id: string) => `${APP_ORIGIN}/checkout/${id}`;

/**
 * `?new=1` opens a page's create modal — also when the query changes while the page is already open
 * (command palette, dashboard links). Closing drops the query so a reload doesn't reopen it.
 */
export function useNewParam() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const wants = params.get("new") === "1";
  const [open, setOpen] = useState(wants);
  const [prev, setPrev] = useState(wants);
  if (prev !== wants) {
    setPrev(wants);
    if (wants) setOpen(true);
  }
  const close = () => {
    setOpen(false);
    if (params.get("new") !== null) {
      const next = new URLSearchParams(params.toString());
      next.delete("new");
      next.delete("price");
      router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
    }
  };
  return { open, setOpen: () => setOpen(true), close, params };
}

/** `<input type="datetime-local">` value → ISO string (or undefined when blank / invalid). */
export function localToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Positive whole number from a text field, or null. */
export function parseCount(v: string, min = 1): number | null {
  const s = v.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= min ? n : null;
}
