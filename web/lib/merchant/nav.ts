/** Sidebar information architecture (URS §331). `perm` hides items the member cannot open. */
export type NavItem = { href: string; label: string; icon: string; perm?: string };
export type NavSection = { label?: string; items: NavItem[] };

export const NAV: NavSection[] = [
  { items: [{ href: "/dashboard", label: "Home", icon: "home" }] },
  {
    label: "Sales",
    items: [
      { href: "/payments", label: "Payments", icon: "card", perm: "payments.read" },
      { href: "/orders", label: "Orders", icon: "bag", perm: "payments.read" },
      { href: "/payment-links", label: "Payment links", icon: "link", perm: "payments.read" },
      { href: "/checkout-sessions", label: "Checkout sessions", icon: "cart", perm: "payments.read" },
    ],
  },
  {
    label: "Billing",
    items: [
      { href: "/subscriptions", label: "Subscriptions", icon: "repeat", perm: "subscriptions.read" },
      { href: "/invoices", label: "Invoices", icon: "invoice", perm: "invoices.read" },
      { href: "/usage", label: "Usage", icon: "gauge", perm: "usage.read" },
      { href: "/credits", label: "Credits", icon: "coins", perm: "credits.read" },
    ],
  },
  { items: [{ href: "/customers", label: "Customers", icon: "users", perm: "customers.read" }] },
  {
    label: "Catalog",
    items: [
      { href: "/products", label: "Products & prices", icon: "box", perm: "products.read" },
      { href: "/coupons", label: "Coupons", icon: "tag", perm: "products.read" },
      { href: "/meters", label: "Meters", icon: "gauge", perm: "usage.read" },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/balance", label: "Balance", icon: "wallet", perm: "balance.read" },
      { href: "/payouts", label: "Payouts", icon: "bank", perm: "payouts.read" },
      { href: "/ledger", label: "Ledger", icon: "book", perm: "ledger.read" },
      { href: "/statements", label: "Statements", icon: "file", perm: "reports.read" },
    ],
  },
  {
    items: [
      { href: "/tax", label: "Tax", icon: "percent", perm: "tax.read" },
      { href: "/disputes", label: "Disputes", icon: "scale", perm: "disputes.read" },
      { href: "/analytics", label: "Analytics", icon: "chart", perm: "analytics.read" },
    ],
  },
  {
    label: "Developers",
    items: [
      { href: "/developers", label: "Overview", icon: "code", perm: "developers.read" },
      { href: "/developers/api-keys", label: "API keys", icon: "key", perm: "developers.read" },
      { href: "/developers/webhooks", label: "Webhooks", icon: "hook", perm: "developers.read" },
      { href: "/developers/events", label: "Events", icon: "bolt", perm: "developers.read" },
      { href: "/developers/logs", label: "Logs", icon: "list", perm: "developers.read" },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/settings", label: "Organization", icon: "building", perm: "team.read" },
      { href: "/settings/team", label: "Team", icon: "team", perm: "team.read" },
      { href: "/settings/verification", label: "Verification", icon: "check", perm: "compliance.read" },
      { href: "/settings/payout-accounts", label: "Payout accounts", icon: "bank", perm: "payouts.read" },
      { href: "/settings/security", label: "Security", icon: "lock" },
      { href: "/settings/go-live", label: "Go live", icon: "rocket", perm: "team.read" },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV.flatMap((s) => s.items.map((i) => ({ ...i, section: s.label })));
