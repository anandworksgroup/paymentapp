/**
 * Role → permission fallback. The authoritative map comes from `GET /v1/team` → `roles`, but that
 * endpoint needs `team.read`, which finance/developer/support members do not hold. For them the UI
 * falls back to this mirror of backend `Infrastructure/Security.cs` so it can still hide actions they
 * cannot perform. The server enforces every permission regardless; this only shapes the UI.
 */
const MERCHANT = [
  "payments.read", "payments.write", "payments.refund", "disputes.read", "disputes.write",
  "customers.read", "customers.write", "products.read", "products.write", "checkout.write", "coupons.write",
  "subscriptions.read", "subscriptions.write", "invoices.read", "invoices.write", "usage.read", "usage.write",
  "credits.read", "credits.write", "balance.read", "payouts.read", "payouts.manage", "payouts.destination",
  "ledger.read", "reports.read", "analytics.read", "tax.read", "tax.write",
  "developers.read", "developers.write", "team.read", "team.manage", "org.manage", "org.close",
  "compliance.read", "compliance.write", "wallet.read", "wallet.transfer", "copilot.use",
];

export const ALL_MERCHANT_PERMISSIONS = MERCHANT;

export const FALLBACK_ROLES: Record<string, string[]> = {
  owner: MERCHANT,
  admin: MERCHANT.filter((p) => p !== "payouts.destination" && p !== "org.close"),
  finance: ["payments.read", "payments.refund", "disputes.read", "disputes.write", "invoices.read", "balance.read",
    "payouts.read", "payouts.manage", "ledger.read", "reports.read", "analytics.read", "tax.read", "customers.read",
    "subscriptions.read", "usage.read", "credits.read", "wallet.read", "copilot.use"],
  developer: ["developers.read", "developers.write", "products.read", "products.write", "payments.read", "customers.read",
    "subscriptions.read", "invoices.read", "usage.read", "usage.write", "checkout.write", "credits.read", "copilot.use"],
  support: ["customers.read", "customers.write", "payments.read", "subscriptions.read", "invoices.read", "disputes.read", "products.read"],
  analyst: ["payments.read", "customers.read", "products.read", "subscriptions.read", "invoices.read", "reports.read",
    "analytics.read", "usage.read", "balance.read", "copilot.use"],
  compliance_analyst: ["compliance.read", "customers.read", "payments.read", "disputes.read"],
};

/** Groups for the restricted-key permission picker. */
export function permissionGroups(perms: string[]) {
  const groups: Record<string, string[]> = {};
  for (const p of perms) {
    const [g] = p.split(".");
    (groups[g] ??= []).push(p);
  }
  return groups;
}
