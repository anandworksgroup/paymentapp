/**
 * Console navigation (URS §72/§333). Each entry is shown only when the signed-in platform role holds
 * one of the listed permissions; the pages re-check and the API enforces it again.
 */
export type NavItem = { href: string; label: string; icon: string; perms: string[]; badge?: "alerts" | "cases" | "approvals" | "recon" };

export const NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: "overview", perms: ["admin.overview"] },
  { href: "/admin/merchants", label: "Merchants", icon: "merchants", perms: ["admin.merchants.read"] },
  { href: "/admin/users", label: "Users", icon: "users", perms: ["admin.users.read"] },
  { href: "/admin/transactions", label: "Transactions", icon: "transactions", perms: ["admin.transactions.read"] },
  { href: "/admin/money-movement", label: "Money movement", icon: "movement", perms: ["admin.transactions.read"] },
  { href: "/admin/alerts", label: "Alerts", icon: "alerts", perms: ["admin.aml.read"], badge: "alerts" },
  { href: "/admin/cases", label: "Cases", icon: "cases", perms: ["admin.aml.read"], badge: "cases" },
  // The approvals queue is shown to roles that can request or decide four-eyes actions, and to auditors.
  {
    href: "/admin/approvals",
    label: "Approvals",
    icon: "approvals",
    perms: ["admin.approve", "admin.aml.write", "admin.payouts.hold", "admin.ledger.adjust", "admin.merchants.decide", "admin.restrict", "admin.freeze", "admin.audit.read"],
    badge: "approvals",
  },
  { href: "/admin/screening", label: "Screening", icon: "screening", perms: ["admin.aml.read"] },
  { href: "/admin/ledger", label: "Ledger", icon: "ledger", perms: ["admin.ledger.read"] },
  { href: "/admin/reconciliation", label: "Reconciliation", icon: "recon", perms: ["admin.recon.read"], badge: "recon" },
  { href: "/admin/payouts", label: "Payouts", icon: "payouts", perms: ["admin.transactions.read"] },
  { href: "/admin/providers", label: "Providers", icon: "providers", perms: ["admin.overview"] },
  { href: "/admin/configuration", label: "Configuration", icon: "config", perms: ["admin.overview"] },
  { href: "/admin/audit", label: "Audit logs", icon: "audit", perms: ["admin.audit.read"] },
  { href: "/admin/health", label: "System health", icon: "health", perms: ["admin.overview"] },
];

export function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(href + "/");
}
