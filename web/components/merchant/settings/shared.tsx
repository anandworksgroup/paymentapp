"use client";

import Link from "next/link";
import { cx } from "@/components/ui";
import { useMerchant } from "../context";

const ITEMS = [
  { href: "/settings", label: "Organization", perm: "team.read" },
  { href: "/settings/team", label: "Team", perm: "team.read" },
  { href: "/settings/verification", label: "Verification", perm: "compliance.read" },
  { href: "/settings/payout-accounts", label: "Payout accounts", perm: "payouts.read" },
  { href: "/settings/security", label: "Security" },
  { href: "/settings/go-live", label: "Go live", perm: "team.read" },
  { href: "/settings/domains", label: "Domains", perm: "org.manage" },
  { href: "/settings/files", label: "Files", perm: "compliance.read" },
];

export function SettingsNav({ current }: { current: string }) {
  const { can } = useMerchant();
  return (
    <nav aria-label="Settings sections" className="mb-5 flex gap-1 overflow-x-auto rounded-full bg-surface-2 p-1 sm:inline-flex">
      {ITEMS.filter((i) => can(i.perm)).map((i) => (
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

/** Human description of a merchant role (the permission list itself comes from the API). */
export const ROLE_BLURBS: Record<string, string> = {
  owner: "Full control, including payout bank accounts and closing the account.",
  admin: "Manages everything except payout bank accounts and account closure.",
  finance: "Refunds, disputes, balances, payouts and reports.",
  developer: "API keys, webhooks, products and test integrations.",
  support: "Looks up customers, payments and subscriptions; edits customer details.",
  analyst: "Read-only access to sales, customers and analytics.",
  compliance_analyst: "Reads verification and compliance information.",
};
