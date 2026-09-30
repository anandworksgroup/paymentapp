"use client";

import type { ReactNode } from "react";
import { cx } from "@/components/ui";

export const PRODUCT_TYPES = ["saas", "digital", "subscription", "api", "membership", "course", "download", "service", "license", "credit_package", "usage"];
export const TAX_CATEGORIES = [
  { value: "digital_service", label: "Digital service" },
  { value: "saas", label: "SaaS" },
  { value: "ebook", label: "E-book" },
  { value: "general", label: "General goods" },
];
export const DELIVERY_TYPES = [
  { value: "access", label: "Access (account or feature unlock)" },
  { value: "download", label: "Download" },
  { value: "license_key", label: "License key" },
  { value: "credits", label: "Credits" },
  { value: "manual", label: "Delivered manually" },
];

/** Labelled checkbox with an optional hint line, keyboard operable with a visible focus ring. */
export function CheckField({ label, hint, checked, onChange, disabled }: { label: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cx("flex cursor-pointer items-start gap-3 rounded-inner bg-surface-2 px-4 py-3", disabled && "cursor-not-allowed opacity-60")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[var(--ink)] outline-none focus-visible:ring-4 focus-visible:ring-sage-100"
      />
      <span className="min-w-0">
        <span className="block text-[13.5px] text-text">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** A small grey sub-heading inside forms. */
export function FormSection({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-inner border border-line p-4">
      <legend className="flex items-center gap-2 px-1 text-[12px] uppercase tracking-[0.08em] text-muted">
        {title}
        {aside}
      </legend>
      {children}
    </fieldset>
  );
}
