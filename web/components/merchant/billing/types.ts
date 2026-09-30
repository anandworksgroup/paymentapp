/**
 * Response shapes for the billing / customers endpoints that are not plain entities
 * (backend Endpoints/MoneyEndpoints.cs "Billing" and CommerceEndpoints.cs "Customers").
 */
import type {
  CreditEntry, CreditNote, Customer, Dispute, Entitlement, Invoice, InvoiceLine, Order, Payment, PaymentMethod, Price, Refund,
  StateTransition, Subscription, SubscriptionItem, TaxRecord,
} from "@/lib/merchant/types";

/** Subscription fields the shared type leaves out. */
export type SubscriptionFull = Subscription & {
  days_until_due?: number;
  default_payment_method_id?: string | null;
  resumes_at?: string | null;
  test_clock_id?: string | null;
  coupon_id?: string | null;
};

export type CustomerDetail = {
  customer: Customer;
  payment_methods: PaymentMethod[];
  orders: Order[];
  payments: Payment[];
  subscriptions: SubscriptionFull[];
  invoices: Invoice[];
  entitlements: Entitlement[];
  credits: { available: number; reserved: number };
  usage: { event_name: string; quantity: number; events: number }[];
  refunds: Refund[];
  disputes: Dispute[];
};

export type SubscriptionDetail = {
  subscription: SubscriptionFull;
  items: SubscriptionItem[];
  prices: Price[];
  customer: Customer | null;
  invoices: Invoice[];
  current_usage: { event_name: string; quantity: number }[];
  credits: number;
  timeline: StateTransition[];
};

export type ProrationPreview = {
  object: "proration_preview";
  subscription: string;
  from_price: string;
  to_price: string;
  quantity: number;
  period_end: string;
  remaining_fraction: number;
  credit_for_unused_time: number;
  charge_for_remaining_time: number;
  net_amount: number;
  currency: string;
  behavior: string;
  next_invoice_amount_before_tax: number;
};

export type InvoiceFull = Invoice & { payment_id?: string | null };

export type InvoiceDetail = {
  invoice: InvoiceFull;
  lines: InvoiceLine[];
  credit_notes: CreditNote[];
  payments: Payment[];
  calculation_inputs: unknown;
  tax_records: TaxRecord[];
};

export type UsageSummary = {
  object: "usage_summary";
  by_event: { event_name: string; quantity: number; events: number; unbilled: number }[];
  by_day: { date: string; quantity: number }[];
};

export type CreditBalance = {
  object: "credit_balance";
  customer: string;
  credit_type: string;
  available: number;
  reserved: number;
  entries: CreditEntry[];
};

export const SUBSCRIPTION_STATUSES = ["TRIALING", "ACTIVE", "PAST_DUE", "PAUSED", "CANCELLED", "EXPIRED", "INCOMPLETE"];
export const INVOICE_STATUSES = ["DRAFT", "OPEN", "PAID", "PARTIALLY_PAID", "PAST_DUE", "VOID", "UNCOLLECTIBLE"];

/** Credits are counted in units, not money. */
export function units(n: number) {
  return n.toLocaleString("en-US");
}

export function bps(rate: number) {
  return `${(rate / 100).toFixed(rate % 100 === 0 ? 0 : 2)}%`;
}
