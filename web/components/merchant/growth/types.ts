/**
 * Shapes of the marketplace, affiliate, import, brand, experiment, budget and merge endpoints
 * (backend Endpoints/OperationsEndpoints.cs, GrowthEndpoints.cs, CommerceEndpoints.cs). JSON is
 * snake_case; every amount is integer minor units.
 */
import type { Customer, Tenant, Base } from "@/lib/merchant/types";

// ───────── Marketplace sellers (§101) ─────────

export type Seller = Base & {
  org_id: string;
  name: string;
  email: string;
  country: string;
  default_currency: string;
  /** pending_verification | active | restricted | rejected */
  status: string;
  screening_status: string;
  commission_bps: number;
  payout_bank_name?: string | null;
  payout_currency?: string | null;
  payout_last4?: string | null;
  decision_reason?: string | null;
};

export type SellerBalanceRow = { currency: string; pending: number; available: number };

export type SellerBalanceTxn = Tenant & {
  seller_id: string;
  /** sale | refund | dispute | dispute_reversal | payout | payout_failure */
  type: string;
  amount: number;
  currency: string;
  status: string;
  available_on: string;
  source_type: string;
  source_id: string;
  ledger_transaction_id: string;
  payout_id?: string | null;
  description?: string | null;
};

export type SellerPayout = Tenant & {
  seller_id: string;
  amount: number;
  currency: string;
  /** PENDING | PROCESSING | PAID | FAILED */
  status: string;
  bank_last4?: string | null;
  failure_reason?: string | null;
  paid_at?: string | null;
};

export type SellerPayment = {
  id: string;
  amount: number;
  tax_amount: number;
  fee_amount: number;
  application_fee_amount: number;
  seller_amount: number;
  currency: string;
  status: string;
  created_at: string;
};

export type SellerDetail = {
  seller: Seller;
  balance: { object: "seller_balance"; seller: string; balances: SellerBalanceRow[]; source: string };
  balance_transactions: SellerBalanceTxn[];
  payouts: SellerPayout[];
  payments: SellerPayment[];
};

// ───────── Affiliates (§51) ─────────

export type Affiliate = Tenant & {
  name: string;
  email: string;
  code: string;
  /** percentage | fixed */
  commission_type: string;
  rate_bps: number;
  fixed_amount: number;
  fixed_currency?: string | null;
  /** first_payment | recurring | months */
  duration: string;
  duration_months?: number | null;
  hold_days: number;
  /** active | inactive */
  status: string;
  clicks: number;
};

export type AffiliateCommission = Tenant & {
  affiliate_id: string;
  customer_id: string;
  payment_id: string;
  basis_amount: number;
  amount: number;
  currency: string;
  /** pending | approved | paid | reversed */
  status: string;
  approve_after: string;
  paid_at?: string | null;
  reversal_reason?: string | null;
};

export type AffiliateDetail = {
  affiliate: Affiliate;
  clicks: number;
  referred_customers: number;
  conversion_pct: number | null;
  totals: { currency: string; status: string; amount: number; count: number }[];
  commissions: AffiliateCommission[];
};

export type AffiliatePayout = { object: "affiliate_payout"; affiliate: string; commissions: number; totals: Record<string, number> };

// ───────── Imports (§187-§189) ─────────

export type ImportRowResult = {
  row: number;
  /** Preview: valid | invalid | duplicate. After commit: imported | skipped | failed. */
  status: string;
  errors: string[];
  key: string;
  id?: string;
  price_id?: string;
};

export type ImportJob = Tenant & {
  type: "customers" | "products";
  format: "csv" | "json";
  /** previewed | completed | failed */
  status: string;
  dry_run: boolean;
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  imported: number;
  results?: ImportRowResult[] | null;
  created_by: string;
};

// ───────── Customers: merge, duplicates, budgets (§186, §245-§246) ─────────

export type CustomerWithMerge = Customer & { merged_into_id?: string | null };

export type DuplicateGroup = {
  match: "email" | "phone";
  value: string;
  customers: { id: string; email?: string | null; name?: string | null; phone?: string | null; created_at: string }[];
};

export type DuplicateCandidates = { object: "duplicate_candidates"; data: DuplicateGroup[]; note?: string };

export type CustomerMergeResult = { object: "customer_merge"; survivor: string; merged: string; moved: Record<string, number> };

export type CustomerBudget = Tenant & {
  customer_id: string;
  event_name: string;
  monthly_limit: number;
  /** hard = reject events over the limit; soft = accept and notify */
  mode: "hard" | "soft";
  thresholds_csv: string;
  notified_csv: string;
  active: boolean;
};

export type BudgetRow = { budget: CustomerBudget; month_to_date: number; used_pct: number };

// ───────── Brands (§102) ─────────

export type Brand = Base & {
  org_id: string;
  name: string;
  logo_url?: string | null;
  color?: string | null;
  support_email?: string | null;
  website?: string | null;
  active: boolean;
};

// ───────── Experiments (§108) ─────────

export type ExperimentVariant = { key: string; weight: number; price_id?: string | null; coupon_code?: string | null };

export type Experiment = Tenant & {
  name: string;
  payment_link_id: string;
  /** draft | running | stopped */
  status: string;
  variants: ExperimentVariant[];
  hypothesis?: string | null;
  started_at?: string | null;
  stopped_at?: string | null;
};

export type ExperimentResult = {
  variant: string;
  price_id?: string | null;
  coupon_code?: string | null;
  visits: number;
  conversions: number;
  conversion_rate_pct: number;
  /** Set when the variant's revenue is in a single currency; the totals below are null when it's mixed. */
  currency?: string | null;
  revenue_excluding_tax: number | null;
  revenue_per_visit: number | null;
  revenue_by_currency?: { currency: string; amount: number }[];
  lift_vs_control_pct: number | null;
  p_value: number | null;
};

export type ExperimentDetail = { experiment: Experiment; results: ExperimentResult[]; reading_guide: string };

// ───────── Organization (retention offer, §257) ─────────

export type OrganizationSettings = Base & {
  name: string;
  default_currency: string;
  retention_coupon_id?: string | null;
  retention_offer_pause: boolean;
};
