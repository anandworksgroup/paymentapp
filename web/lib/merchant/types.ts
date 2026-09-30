/**
 * Shapes of the platform API objects the merchant app reads. JSON is snake_case of the C# entity
 * properties (backend/src/PaymentApp.Api/Data/Entities.cs). Amounts are integer minor units.
 */

export type Base = { id: string; object: string; created_at: string };
export type Tenant = Base & { org_id: string; livemode: boolean };
export type Json = unknown;

export type User = Base & {
  email: string;
  name: string;
  phone?: string | null;
  country?: string | null;
  mfa_enabled: boolean;
  kyc_status?: string;
  platform_role?: string | null;
};

export type OrgSummary = {
  id: string;
  name: string;
  status: string;
  go_live_state: string;
  country: string;
  default_currency: string;
  role: string;
};

export type Me = {
  user: User;
  organizations: OrgSummary[];
  wallet: { id: string; handle: string; status: string } | null;
  admin_permissions: string[];
};

export type Organization = Base & {
  name: string;
  country: string;
  default_currency: string;
  status: string;
  go_live_state: string;
  restriction: string;
  support_email?: string | null;
  website?: string | null;
  brand_color?: string | null;
  logo_url?: string | null;
  payout_schedule: string;
  settlement_delay_days: number;
  reserve_bps: number;
  minimum_payout_minor: number;
  invoice_prefix: string;
  dunning_retry_days_csv: string;
  dunning_final_action: string;
  dunning_grace_days: number;
};

export type RiskReason = { code: string; weight: number; explanation: string };

export type Payment = Tenant & {
  order_id?: string | null;
  invoice_id?: string | null;
  customer_id?: string | null;
  checkout_session_id?: string | null;
  amount: number;
  currency: string;
  status: string;
  amount_captured: number;
  amount_refunded: number;
  amount_disputed: number;
  tax_amount: number;
  fee_amount: number;
  processor_fee_amount: number;
  net_amount: number;
  provider_id?: string | null;
  provider_transaction_id?: string | null;
  payment_method_type?: string | null;
  card_brand?: string | null;
  last4?: string | null;
  country?: string | null;
  risk_score: number;
  risk_action?: string | null;
  risk_reasons?: RiskReason[] | null;
  review_status: string;
  failure_code?: string | null;
  failure_message?: string | null;
  provider_failure_code?: string | null;
  suggested_action?: string | null;
  three_ds_result?: string | null;
  description?: string | null;
  customer_email?: string | null;
  ip?: string | null;
  updated_at: string;
};

export type PaymentAttempt = Tenant & {
  payment_id: string;
  provider_id: string;
  status: string;
  provider_transaction_id?: string | null;
  error_code?: string | null;
  provider_error_code?: string | null;
  decline_type?: string | null;
  latency_ms: number;
  three_ds_result?: string | null;
  routing_reason?: string | null;
  completed_at?: string | null;
};

export type Refund = Tenant & {
  payment_id: string;
  amount: number;
  tax_amount: number;
  currency: string;
  status: string;
  reason?: string | null;
  failure_reason?: string | null;
  completed_at?: string | null;
};

export type Dispute = Tenant & {
  payment_id: string;
  amount: number;
  fee_amount: number;
  currency: string;
  reason: string;
  status: string;
  evidence_due_by: string;
  submitted_at?: string | null;
  closed_at?: string | null;
};

export type DisputeEvidence = Tenant & { dispute_id: string; type: string; text?: string | null; added_by?: string | null };

export type StateTransition = Base & {
  object_type: string;
  object_id: string;
  from_state?: string | null;
  to_state: string;
  actor_id?: string | null;
  reason?: string | null;
  request_id?: string | null;
};

export type LineItem = {
  price_id: string;
  product_id?: string | null;
  description?: string | null;
  quantity: number;
  unit_amount: number;
  amount: number;
  discount: number;
  tax: number;
  tax_rate_bps: number;
  tax_type?: string | null;
  tax_inclusive: boolean;
};

export type Order = Tenant & {
  customer_id?: string | null;
  currency: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amount_refunded: number;
  status: string;
  items: LineItem[];
  country?: string | null;
  checkout_session_id?: string | null;
  payment_id?: string | null;
  invoice_id?: string | null;
  accepted_terms_version?: string | null;
  seller_of_record?: string | null;
};

export type Customer = Tenant & {
  external_id?: string | null;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  country?: string | null;
  postal_code?: string | null;
  address_line?: string | null;
  tax_id?: string | null;
  tax_status: string;
  customer_type: string;
  default_payment_method_id?: string | null;
  credit_balance: number;
  credit_currency?: string | null;
  payment_terms_days: number;
  credit_limit?: number | null;
  anonymized_at?: string | null;
};

export type PaymentMethod = Tenant & {
  customer_id: string;
  type: string;
  brand?: string | null;
  last4?: string | null;
  exp_month?: number | null;
  exp_year?: number | null;
  country?: string | null;
};

export type Entitlement = Tenant & {
  customer_id: string;
  product_id: string;
  source_type: string;
  source_id: string;
  status: string;
  features_csv?: string | null;
  seats: number;
  license_key?: string | null;
  expires_at?: string | null;
};

export type Product = Tenant & {
  name: string;
  description?: string | null;
  status: string;
  type: string;
  tax_category: string;
  delivery_type: string;
  image_url?: string | null;
  features_csv?: string | null;
  updated_at: string;
};

export type PriceTier = { up_to: number | null; unit_amount: number; flat_amount: number };

export type Price = Tenant & {
  product_id: string;
  nickname?: string | null;
  currency: string;
  type: "one_time" | "recurring";
  scheme: string;
  unit_amount: number;
  tiers?: PriceTier[] | null;
  tiers_mode?: string | null;
  package_size: number;
  interval?: string | null;
  interval_count: number;
  trial_days: number;
  usage_type: string;
  meter_id?: string | null;
  credits_granted: number;
  minimum_amount?: number | null;
  maximum_amount?: number | null;
  tax_behavior: string;
  country_amounts?: Record<string, number> | null;
  version: number;
  previous_version_id?: string | null;
  superseded_by_id?: string | null;
  active: boolean;
};

export type Coupon = Tenant & {
  code: string;
  name?: string | null;
  percent_off_bps?: number | null;
  amount_off?: number | null;
  currency?: string | null;
  duration: string;
  duration_in_months?: number | null;
  max_redemptions?: number | null;
  times_redeemed: number;
  starts_at?: string | null;
  expires_at?: string | null;
  countries_csv?: string | null;
  first_time_only: boolean;
  auto_apply: boolean;
  active: boolean;
};

export type Meter = Tenant & { event_name: string; display_name: string; aggregation: string; unit?: string | null };

export type PaymentLink = Tenant & {
  price_id: string;
  quantity: number;
  allow_coupons: boolean;
  coupon_id?: string | null;
  status: string;
  expires_at?: string | null;
  visits: number;
  completions: number;
  url: string;
};

export type CheckoutSession = Tenant & {
  mode: string;
  status: string;
  line_items: LineItem[];
  currency: string;
  country?: string | null;
  customer_id?: string | null;
  customer_email?: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  tax_label?: string | null;
  payment_link_id?: string | null;
  expires_at: string;
  completed_at?: string | null;
  payment_id?: string | null;
  order_id?: string | null;
  subscription_id?: string | null;
  url: string;
};

export type Subscription = Tenant & {
  customer_id: string;
  status: string;
  currency: string;
  current_period_start: string;
  current_period_end: string;
  trial_end?: string | null;
  cancel_at_period_end: boolean;
  canceled_at?: string | null;
  cancellation_reason?: string | null;
  paused_at?: string | null;
  collection_method: string;
  latest_invoice_id?: string | null;
  dunning_attempts: number;
  next_retry_at?: string | null;
  country?: string | null;
};

export type SubscriptionItem = Tenant & { subscription_id: string; price_id: string; quantity: number };

export type Invoice = Tenant & {
  number: string;
  customer_id?: string | null;
  subscription_id?: string | null;
  billing_reason: string;
  status: string;
  currency: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amount_paid: number;
  amount_due: number;
  amount_credited: number;
  period_start?: string | null;
  period_end?: string | null;
  due_date?: string | null;
  finalized_at?: string | null;
  paid_at?: string | null;
  attempt_count: number;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_tax_id?: string | null;
  customer_country?: string | null;
  seller_of_record?: string | null;
  purchase_order?: string | null;
  memo?: string | null;
};

export type InvoiceLine = Tenant & {
  invoice_id: string;
  price_id?: string | null;
  description: string;
  quantity: number;
  unit_amount: number;
  amount: number;
  discount: number;
  tax: number;
  tax_rate_bps: number;
  tax_type?: string | null;
  proration: boolean;
  period_start?: string | null;
  period_end?: string | null;
};

export type CreditNote = Tenant & { invoice_id: string; number: string; amount: number; tax: number; currency: string; reason: string };

export type TaxRecord = Tenant & {
  source_type: string;
  source_id: string;
  invoice_id?: string | null;
  order_id?: string | null;
  country: string;
  tax_type: string;
  rate_bps: number;
  taxable_amount: number;
  tax_amount: number;
  currency: string;
  reverse_charge: boolean;
  exempt: boolean;
};

export type CreditEntry = Tenant & {
  customer_id: string;
  credit_type: string;
  operation: string;
  delta: number;
  reserved_delta: number;
  balance_after: number;
  source_type?: string | null;
  description?: string | null;
};

export type BalanceRow = { currency: string; available: number; pending: number; reserved: number; held_for_review: number; in_transit_to_bank: number };
export type Balance = { object: "balance"; livemode: boolean; balances: BalanceRow[]; source: string };

export type BalanceTransaction = Tenant & {
  type: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  source_type: string;
  source_id: string;
  status: string;
  available_on: string;
  payout_id?: string | null;
  reserve_amount: number;
  held_for_review: boolean;
  description?: string | null;
};

export type Payout = Tenant & {
  amount: number;
  currency: string;
  status: string;
  destination_id?: string | null;
  destination_last4?: string | null;
  arrival_date?: string | null;
  failure_reason?: string | null;
  bank_reference?: string | null;
  breakdown?: Record<string, number> | null;
  automatic: boolean;
  hold_reason?: string | null;
  paid_at?: string | null;
};

export type PayoutDestination = Base & {
  org_id: string;
  bank_country: string;
  currency: string;
  account_holder: string;
  bank_name?: string | null;
  last4: string;
  routing_number?: string | null;
  swift?: string | null;
  status: string;
  is_default: boolean;
};

export type ApiKey = Base & {
  org_id: string;
  livemode: boolean;
  type: string;
  name: string;
  display_key: string;
  publishable_value?: string | null;
  permissions?: string[] | null;
  allowed_ips_csv?: string | null;
  revoked_at?: string | null;
  last_used_at?: string | null;
};

export type WebhookEndpoint = Tenant & {
  url: string;
  description?: string | null;
  enabled_events_csv: string;
  status: string;
  consecutive_failures: number;
  last_success_at?: string | null;
  last_failure_at?: string | null;
  previous_secret_expires_at?: string | null;
};

export type WebhookDelivery = Tenant & {
  event_id: string;
  endpoint_id: string;
  attempt: number;
  status: string;
  next_attempt_at: string;
  response_status?: number | null;
  response_body?: string | null;
  duration_ms: number;
  is_replay: boolean;
  completed_at?: string | null;
};

export type ApiEvent = Base & {
  org_id?: string | null;
  livemode: boolean;
  type: string;
  object_type: string;
  object_id: string;
  data?: Json;
  api_version: string;
  sequence: number;
  request_id?: string | null;
};

export type ApiRequestLog = {
  id: number;
  request_id: string;
  method: string;
  path: string;
  status: number;
  latency_ms: number;
  ip?: string | null;
  user_agent?: string | null;
  error_code?: string | null;
  api_key_id?: string | null;
  at: string;
};

export type Membership = { id: string; role: string; created_at: string; user: { id: string; name: string; email: string; mfa_enabled: boolean } };

export type BeneficialOwner = Base & {
  name: string;
  date_of_birth?: string | null;
  nationality?: string | null;
  country?: string | null;
  ownership_bps: number;
  relationship: string;
  verification_status: string;
  screening_status: string;
};

export type MerchantApplication = Base & {
  status: string;
  legal_name?: string | null;
  trading_name?: string | null;
  website?: string | null;
  business_type?: string | null;
  industry?: string | null;
  country?: string | null;
  registered_address?: string | null;
  operating_address?: string | null;
  registration_number?: string | null;
  tax_number?: string | null;
  contact_phone?: string | null;
  product_description?: string | null;
  customer_type?: string | null;
  average_order_minor?: number | null;
  expected_monthly_volume_minor?: number | null;
  countries_served_csv?: string | null;
  refund_policy_url?: string | null;
  terms_url?: string | null;
  privacy_url?: string | null;
  submitted_at?: string | null;
  decided_at?: string | null;
  decision_reason?: string | null;
  required_actions?: string | null;
  updated_at: string;
};

export type Checklist = {
  go_live_state: string;
  status: string;
  items: { key: string; label: string; state: "done" | "todo" | "in_progress" | "attention" | "optional" }[];
  can_go_live: boolean;
};

export type AttentionItem = { kind: string; count: number; label: string; link: string };

export type Dashboard = {
  reporting_currency: string;
  period_start: string;
  period_end: string;
  gross_revenue: number;
  net_revenue: number;
  previous_period_gross_revenue: number;
  change_pct: number | null;
  taxes_collected: number;
  platform_fees: number;
  refunds: number;
  chargebacks: number;
  transactions: number;
  successful_payments: number;
  failed_payments: number;
  mrr: number;
  arr: number;
  active_subscriptions: number;
  churn_rate_pct: number;
  customers: number;
  new_customers: number;
  arpu: number;
  ltv_estimate: number | null;
  conversion_rate_pct: number;
  balance: Balance;
  series: { date: string; gross: number; count: number }[];
  by_country: { country: string; gross: number; count: number }[];
  by_method: { method: string; count: number; success_rate: number }[];
  by_provider: { provider: string; count: number; success_rate: number }[];
  definitions: Record<string, string>;
};

export type WalletBalances = {
  object: "wallet_balances" | "wallet";
  activated?: boolean;
  wallet?: string;
  handle?: string;
  status?: string;
  balances?: { currency: string; available: number; held: number; pending_incoming: number; ledger_balance: number }[];
  estimated_total_usd?: number;
  estimate_note?: string;
};

export type Country = { country: string; name: string; checkout_enabled: boolean; merchant_onboarding_enabled: boolean; default_currency: string; payment_methods_csv: string };
export type Meta = {
  api_version: string;
  environment: string;
  currencies: { code: string; exponent: number; symbol: string }[];
  countries: Country[];
  test_cards: { number: string; behavior: string; brand: string; country: string }[];
  test_upi: Record<string, string>;
};
