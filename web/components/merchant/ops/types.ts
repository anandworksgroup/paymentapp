/** Response shapes for finance reports, month-end close, support, domains and files (snake_case from the API). */

// ───────── Reports (/v1/reports/*) ─────────

export type RevenueRecognition = {
  object: "revenue_recognition";
  month: string;
  currency: string;
  billings: number;
  recognized_revenue: number;
  refunds: number;
  net_recognized_revenue: number;
  deferred_revenue_end_of_month: number;
  by_product: { product: string; name: string | null; recognized: number }[];
  methodology: string;
};

export type JournalLine = {
  date: string;
  journal_id: string;
  account: string;
  debit: number;
  credit: number;
  currency: string;
  memo: string;
  source_type: string;
  source_id: string;
};

export type Journal = {
  object: "journal";
  period_start: string;
  period_end: string;
  lines: JournalLine[];
  balanced: boolean;
  trial_balance: { account: string; currency: string; debit: number; credit: number }[];
  format_note: string;
};

export type CohortReport = {
  object: "cohort_analysis";
  currency: string;
  cohort_basis: string;
  activity_definition: string;
  cohorts: {
    cohort: string;
    customers: number;
    retention: { month_offset: number; active_customers: number; retention_pct: number; revenue: number }[];
  }[];
};

export type ChurnReport = {
  object: "churn";
  period_start: string;
  period_end: string;
  currency: string;
  subscriptions_at_start: number;
  cancelled: number;
  logo_churn_pct: number;
  voluntary: number;
  involuntary: number;
  mrr_at_start: number;
  mrr_lost: number;
  revenue_churn_pct: number;
  reasons: { reason: string; count: number }[];
  retention_saves: number;
  definitions: { logo_churn: string; revenue_churn: string; involuntary: string };
};

// ───────── Month-end close (/v1/accounting_periods) ─────────

export type CloseCheck = { key: string; label: string; passed: boolean; blocking: boolean; detail: string };

export type ClosePreview = {
  object: "period_close_preview";
  period: string;
  already_closed: boolean;
  can_close: boolean;
  checks: CloseCheck[];
};

export type AccountingPeriod = {
  id: string;
  object: "accounting_period";
  period: string;
  status: string;
  closed_at: string;
  closed_by: string;
  checks: CloseCheck[] | null;
  snapshot_sha256: string;
  livemode: boolean;
  created_at: string;
};

export type PeriodVerification = {
  object: "period_verification";
  period: string;
  closed_sha256: string;
  recomputed_sha256: string;
  unchanged: boolean;
};

// ───────── Support (/v1/support/tickets) ─────────

export type TicketStatus = "open" | "awaiting_merchant" | "resolved" | "closed";

export type SupportTicket = {
  id: string;
  object: "support_ticket";
  org_id: string;
  created_by_user_id: string;
  subject: string;
  category: string;
  status: TicketStatus | string;
  priority: string;
  assigned_to: string | null;
  related_object_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TicketMessage = {
  id: string;
  object: "ticket_message";
  ticket_id: string;
  author_id: string;
  author_type: "merchant" | "staff" | string;
  body: string;
  internal: boolean;
  created_at: string;
};

export type TicketDetail = { ticket: SupportTicket; messages: TicketMessage[] };

export const TICKET_CATEGORIES = [
  { value: "payment_issue", label: "Payment issue" },
  { value: "checkout_issue", label: "Checkout issue" },
  { value: "tax_issue", label: "Tax issue" },
  { value: "bug", label: "Something isn't working" },
  { value: "account", label: "Account" },
  { value: "feature_request", label: "Feature request" },
  { value: "other", label: "Other" },
] as const;

// The API accepts normal, high and urgent; anything else is stored as normal.
export const TICKET_PRIORITIES = [
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
] as const;

// ───────── Custom domains (/v1/domains) ─────────

export type DomainStatus = "PENDING" | "VERIFIED" | "FAILED" | "REVOKED";

export type CustomDomain = {
  id: string;
  object: "domain";
  hostname: string;
  purpose: "checkout" | "portal" | "payment_links" | string;
  status: DomainStatus | string;
  verification_token: string;
  verified_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
};

export type DnsRecord = { type: "TXT" | "CNAME" | string; name: string; value: string; purpose: string };

export type DomainEntry = { domain: CustomDomain; dns: DnsRecord[] };

// ───────── Files (/v1/files) ─────────

export type StoredFile = {
  id: string;
  object: "file";
  org_id: string | null;
  purpose: string;
  file_name: string;
  content_type: string;
  size: number;
  sha256: string;
  uploaded_by: string | null;
  scan_status: "not_scanned" | "clean" | "infected" | string;
  livemode: boolean;
  linked_object_id: string | null;
  created_at: string;
};

export type FileLink = { object: "file_link"; url: string; expires_at: string; file: StoredFile };

export const FILE_PURPOSES = [
  { value: "kyb_document", label: "Business verification", perm: "compliance.write" },
  { value: "tax_document", label: "Tax document", perm: "compliance.write" },
  { value: "dispute_evidence", label: "Dispute evidence", perm: "disputes.write" },
] as const;
