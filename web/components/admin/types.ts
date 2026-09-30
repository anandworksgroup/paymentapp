/**
 * Shapes of the /v1/admin/* responses (snake_case of the C# entities). Amounts are integer minor
 * units plus an ISO currency code; the console only formats them.
 */

export type Id = string;

export type Base = { id: Id; object?: string; created_at: string };

export type ListResponse<T> = { object: "list"; data: T[]; has_more?: boolean };

export type Me = {
  user: User;
  organizations: unknown[];
  wallet: unknown;
  admin_permissions: string[];
};

export type User = Base & {
  email: string;
  email_verified?: boolean;
  name: string;
  phone: string | null;
  country: string | null;
  date_of_birth: string | null;
  nationality: string | null;
  address: string | null;
  platform_role: string | null;
  status: string;
  kyc_level: number;
  kyc_status: string;
  kyc_verified_at: string | null;
  risk_score: number;
  risk_level: string;
  mfa_enabled: boolean;
  last_login_at: string | null;
  last_activity_at: string | null;
};

export type Organization = Base & {
  name: string;
  country: string;
  default_currency: string;
  status: string;
  go_live_state: string;
  restriction: string;
  risk_score: number;
  risk_level: string;
  support_email: string | null;
  website: string | null;
  payout_schedule: string;
  settlement_delay_days: number;
  reserve_bps: number;
  closed_at: string | null;
};

export type MerchantApplication = Base & {
  status: string;
  legal_name: string | null;
  trading_name: string | null;
  website: string | null;
  business_type: string | null;
  industry: string | null;
  country: string | null;
  registered_address: string | null;
  operating_address: string | null;
  registration_number: string | null;
  tax_number: string | null;
  contact_email: string | null;
  product_description: string | null;
  customer_type: string | null;
  average_order_minor: number | null;
  expected_monthly_volume_minor: number | null;
  countries_served_csv: string | null;
  refund_policy_url: string | null;
  terms_url: string | null;
  privacy_url: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_reason: string | null;
  risk_score: number;
  checks: Record<string, unknown>[] | null;
  required_actions: unknown;
};

export type BeneficialOwner = Base & {
  name: string;
  date_of_birth: string | null;
  nationality: string | null;
  country: string | null;
  ownership_bps: number;
  relationship: string;
  verification_status: string;
  screening_status: string;
};

export type Balance = { object: "balance"; livemode: boolean; balances: { currency: string; available?: number; pending?: number; reserved?: number; [k: string]: unknown }[]; source: string };

export type AuditLog = {
  seq: number;
  id: Id;
  at: string;
  actor_type: string;
  actor_id: string;
  actor_role: string | null;
  org_id: string | null;
  action: string;
  object_type: string | null;
  object_id: string | null;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  ip: string | null;
  request_id: string | null;
  case_id: string | null;
  approval_id: string | null;
  prev_hash: string | null;
  hash: string;
};

export type Payout = Base & {
  amount: number;
  currency: string;
  status: string;
  destination_last4: string | null;
  arrival_date: string | null;
  failure_reason: string | null;
  bank_reference: string | null;
  ledger_transaction_id: string | null;
  breakdown: Record<string, number | string | null> | null;
  automatic: boolean;
  hold_reason: string | null;
  paid_at: string | null;
  org_id: string;
  livemode: boolean;
};

export type ComplianceCase = Base & {
  title: string;
  type: string;
  subject_type: string;
  subject_id: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  created_by: string;
  due_at: string;
  decision: string | null;
  decision_reason: string | null;
  decided_by: string | null;
  closed_at: string | null;
  legal_hold: boolean;
  confidential: boolean;
  updated_at: string;
};

export type MerchantDetail = {
  organization: Organization;
  application: MerchantApplication | null;
  beneficial_owners: BeneficialOwner[];
  members: { role: string; id: string; name: string; email: string }[];
  balance_test: Balance;
  balance_live: Balance;
  volume: { payments: number; succeeded: number; refunds: number; disputes: number };
  payouts: Payout[];
  cases: ComplianceCase[];
  audit: AuditLog[];
};

export type Wallet = Base & { owner_type: string; owner_id: string; status: string; handle: string; currencies_csv: string };

export type Transfer = Base & {
  type: string;
  status: string;
  sender_wallet_id: string | null;
  recipient_wallet_id: string | null;
  bank_account_id: string | null;
  source_org_id: string | null;
  source_currency: string;
  source_amount: number;
  destination_currency: string;
  destination_amount: number;
  fx_rate_e9: number | null;
  fx_mid_rate_e9: number | null;
  fx_quote_id: string | null;
  fee_amount: number;
  fx_spread_amount: number;
  purpose: string | null;
  source_of_funds: string | null;
  note: string | null;
  funding_source: string | null;
  rail: string | null;
  screening_result: string | null;
  hold_id: string | null;
  customer_message: string | null;
  parent_transfer_id: string | null;
  ledger_transaction_id: string | null;
  initiated_by: string | null;
  ip: string | null;
  device_id: string | null;
  sender_country: string | null;
  recipient_country: string | null;
  failure_reason: string | null;
  completed_at: string | null;
  updated_at: string;
};

export type Payment = Base & {
  amount: number;
  currency: string;
  status: string;
  amount_captured: number;
  amount_refunded: number;
  fee_amount: number;
  net_amount: number;
  provider_id: string | null;
  payment_method_type: string | null;
  card_brand: string | null;
  last4: string | null;
  country: string | null;
  risk_score: number;
  risk_action: string | null;
  description: string | null;
  customer_email: string | null;
  org_id: string;
  livemode: boolean;
  failure_message: string | null;
};

export type AlertReason = { code: string; text: string; observed?: number; threshold?: number; [k: string]: unknown };

export type Alert = Base & {
  type: string;
  rule_key: string;
  rule_version: number;
  subject_type: string;
  subject_id: string;
  transfer_id: string | null;
  payment_id: string | null;
  severity: string;
  status: string;
  amount: number | null;
  currency: string | null;
  summary: string;
  reasons: AlertReason[] | null;
  related: {
    transfers?: string[];
    counterparties?: string[];
    rule?: { key: string; version: number; params: Record<string, number> };
    [k: string]: unknown;
  } | null;
  case_id: string | null;
  assigned_to: string | null;
  conclusion: string | null;
  conclusion_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
};

export type MonitoringRule = Base & {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  severity: string;
  params: Record<string, number> | null;
  action: string;
  version: number;
};

export type ScreeningCheck = Base & {
  subject_type: string;
  subject_id: string;
  screened_name: string;
  context: string;
  list_version: string;
  result: string;
  score: number;
  matched_entry_id: string | null;
  matched_name: string | null;
  match_logic: string | null;
  alert_id: string | null;
  reviewed_by: string | null;
};

export type AlertDetail = {
  alert: Alert;
  rule: MonitoringRule | null;
  transfer: Transfer | null;
  screening: ScreeningCheck[];
  subject: Record<string, unknown> | null;
};

export type KycCheck = Base & {
  user_id: string;
  level_requested: number;
  document_type: string;
  provider: string;
  result: string;
  reviewed_by: string | null;
  reason: string | null;
};

export type Device = Base & { user_id: string; fingerprint: string; user_agent: string | null; platform: string | null; last_ip: string | null; last_country: string | null; last_seen_at: string };

export type UserDetail = {
  identity: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    country: string | null;
    nationality: string | null;
    date_of_birth: string | null;
    address: string | null;
    created_at: string;
    last_login_at: string | null;
    status: string;
    platform_role: string | null;
    mfa_enabled: boolean;
  };
  verification: { kyc_level: number; kyc_status: string; kyc_verified_at: string | null; checks: KycCheck[] };
  risk: { risk_score: number; risk_level: string };
  wallet: Wallet | null;
  money_profile: {
    total_incoming_usd: number;
    total_outgoing_usd: number;
    withdrawals: number;
    counterparties: number;
    currencies: string[];
    countries: string[];
    average_transaction_usd: number;
    top_funding_sources: { source: string; count: number; usd: number }[];
  };
  transfers: Transfer[];
  bank_accounts: { id: string; bank_name: string; country: string; currency: string; last4: string; verification_status: string; name_match: boolean; created_at: string; removed_at: string | null }[];
  devices: Device[];
  sessions: { id: string; created_at: string; ip: string | null; user_agent: string | null; revoked_at: string | null }[];
  alerts: Alert[];
  cases: ComplianceCase[];
  memberships: (Base & { org_id: string; user_id: string; role: string })[];
};

export type TimelineItem = { at: string; kind: string; text: string; ref: string | null };

export type GraphNode = { id: string; type: string; label: string; country: string | null };
export type GraphEdge = { id: string; from: string; to: string; type: string; amount: number; currency: string; at: string; status: string; relation: string; note: string | null };

export type FundFlowGraph = {
  object: "fund_flow_graph";
  subject: string;
  period_start: string;
  period_end: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  totals: { incoming: Record<string, number>; outgoing: Record<string, number> };
};

export type FundTrace = {
  object: "fund_trace";
  root: string;
  window_days: number;
  max_hops: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  ledger_transaction: string | null;
  legend: Record<string, string>;
};

export type NetworkLink = { user: string; signal: string; strength: string; detail: string };
export type Network = { object: string; subject: string; links: NetworkLink[]; caution: string };

export type StateTransition = Base & { object_type: string; object_id: string; from_state: string | null; to_state: string; actor_id: string | null; reason: string | null; request_id: string | null };

export type FxQuote = Base & {
  from_currency: string;
  to_currency: string;
  source_amount: number;
  destination_amount: number;
  mid_rate_e9: number;
  customer_rate_e9: number;
  spread_bps: number;
  spread_amount: number;
  fee_amount: number;
  rate_timestamp: string;
  rate_source: string;
  expires_at: string;
  used_at: string | null;
};

export type TransferDetail = {
  transfer: Transfer;
  internal_reason: string | null;
  sender: Wallet | null;
  recipient: Wallet | null;
  bank_account: (Base & { bank_name: string; country: string; currency: string; last4: string; verification_status: string; owner_id: string }) | null;
  fx_quote: FxQuote | null;
  screening: ScreeningCheck[];
  alerts: Alert[];
  ledger: { id: string; type: string; created_at: string; entries: { account: string; owner: string | null; direction: string; amount: number; currency: string }[] }[];
  lineage: { parent: string | null; ledger_transaction: string | null };
  timeline: StateTransition[];
};

export type CaseNote = Base & { case_id: string; author_id: string; kind: string; body: string; finalized: boolean; finalized_at: string | null };
export type CaseEvidence = Base & { case_id: string; type: string; ref_type: string | null; ref_id: string | null; description: string; source: string; snapshot: unknown; sha256: string; captured_by: string };

export type Approval = Base & {
  action: string;
  target_type: string;
  target_id: string;
  payload: unknown;
  reason: string;
  case_id: string | null;
  requested_by: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  executed_at: string | null;
  execution_result: string | null;
};

export type CaseDetail = {
  case: ComplianceCase;
  alerts: Alert[];
  notes: CaseNote[];
  evidence: CaseEvidence[];
  approvals: Approval[];
  history: AuditLog[];
  sla: { due_at: string; overdue: boolean };
};

export type ScreeningList = { id: string; name: string; source: string; version: string; active: boolean; entries: number };
export type ScreeningEntry = Base & { list_id: string; name: string; aliases_csv: string | null; entry_type: string; date_of_birth: string | null; country: string | null; program: string | null };

export type LedgerIntegrity = {
  ledger: { balanced: boolean; transactions_checked: number; unbalanced_transactions: unknown[]; trial_balance: { currency: string; debits: number; credits: number }[] };
  audit_chain: { valid: boolean; rows_checked: number; broken_at_seq: number | null };
};

export type LedgerAccount = { id: string; owner_type: string; owner_id: string | null; code: string; currency: string; livemode: boolean; kind: string; balance: number };

export type LedgerTransaction = Base & {
  type: string;
  description: string;
  org_id: string | null;
  livemode: boolean;
  source_type: string;
  source_id: string;
  posting_key: string;
  parent_transaction_id: string | null;
  reverses_transaction_id: string | null;
  effective_at: string;
  request_id: string | null;
  actor_id: string | null;
};

export type LedgerTransactionDetail = {
  transaction: LedgerTransaction;
  entries: { id: string; account: LedgerAccount & Base; direction: string; amount: number; currency: string }[];
  children: LedgerTransaction[];
};

export type ReconRun = Base & { scope: string; matched: number; exceptions: number; completed_at: string; triggered_by: string | null };
export type ReconException = Base & {
  run_id: string;
  type: string;
  status: string;
  provider_id: string | null;
  org_id: string | null;
  internal_reference: string | null;
  external_reference: string | null;
  expected_amount: number | null;
  actual_amount: number | null;
  currency: string | null;
  details: string;
  resolved_by: string | null;
  resolution: string | null;
  resolved_at: string | null;
};

export type Provider = Base & {
  name: string;
  kind: string;
  livemode: boolean;
  enabled: boolean;
  priority: number;
  countries_csv: string;
  currencies_csv: string;
  methods_csv: string;
  fee_bps: number;
  fee_fixed_minor: number;
  settlement_days: number;
  health_state: string;
  health_updated_at: string | null;
  force_outage: boolean;
};

export type ProviderRow = {
  provider: Provider;
  last_24h: { attempts: number; success_rate: number | null; avg_latency_ms: number | null; errors: Record<string, number> };
};

export type FeeSchedule = Base & {
  org_id: string | null;
  country: string | null;
  method: string | null;
  percent_bps: number;
  fixed_minor: number;
  fixed_currency: string;
  minimum_minor: number | null;
  maximum_minor: number | null;
  international_bps: number;
  priority: number;
  version: number;
  active: boolean;
};

export type TaxRule = Base & {
  country: string;
  region: string | null;
  tax_category: string;
  customer_type: string;
  tax_type: string;
  rate_bps: number;
  reverse_charge_b2_b: boolean;
  label: string;
  version: number;
  effective_from: string;
  effective_to: string | null;
  rounding: string;
};

export type CountryCapability = Base & {
  country: string;
  name: string;
  checkout_enabled: boolean;
  wallet_enabled: boolean;
  payouts_enabled: boolean;
  merchant_onboarding_enabled: boolean;
  default_currency: string;
  payment_methods_csv: string;
  locale: string;
  wallet_kyc_level_required: number;
  restrictions: string | null;
};

export type WalletLimit = Base & { country: string; kyc_level: number; transfer_type: string; per_transaction_usd: number; daily_usd: number; monthly_usd: number; max_balance_usd: number };
export type FxRate = Base & { base: string; quote: string; rate_e9: number; source: string; as_of: string };

export type DataAccessLog = Base & { admin_user_id: string; object_type: string; object_id: string; action: string | null; fields: string | null; reason: string | null; ip: string | null };

export type Overview = {
  active_users: number;
  active_merchants: number;
  daily_transactions: number;
  daily_payment_volume_usd: number;
  daily_wallet_volume_usd: number;
  cross_border_volume_usd: number;
  failed_transactions: number;
  payment_success_rate: number;
  aml_alerts_open: number;
  sanctions_alerts_open: number;
  open_cases: number;
  high_priority_cases: number;
  pending_kyc: number;
  pending_kyb: number;
  transfers_on_hold: number;
  payouts_on_hold: number;
  pending_approvals: number;
  recon_exceptions_open: number;
  providers: { id: string; name: string; health_state: string; enabled: boolean; livemode: boolean }[];
  webhook_backlog: number;
  outbox_backlog: number;
};

export type SystemHealth = {
  api: { requests_last_hour: number; error_rate_pct: number; p50_ms: number; p95_ms: number };
  outbox: { backlog: number; failed: number };
  webhooks: { pending: number; dead: number };
  providers: { id: string; health_state: string; enabled: boolean }[];
  ledger_exceptions: number;
  database: string;
};

export type SearchResult = {
  users: { id: string; name: string; email: string; status: string; kyc_level: number }[];
  merchants: { id: string; name: string; status: string }[];
  payments: { id: string; org_id: string; amount: number; currency: string; status: string }[];
  transfers: Transfer[];
  wallets: Wallet[];
  cases: ComplianceCase[];
  devices: Device[];
  ip_sessions: { user_id: string; created_at: string }[];
  invoices: { id: string; org_id: string; number: string; status: string }[];
  subscriptions: { id: string; org_id: string; status: string }[];
};
