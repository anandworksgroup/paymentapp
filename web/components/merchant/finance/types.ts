/** Response shapes for the finance area that are not in the shared `lib/merchant/types.ts`. */
import type { BalanceTransaction, Dispute, DisputeEvidence, Entitlement, Payment, Payout, PayoutDestination, StateTransition } from "@/lib/merchant/types";

export type PayoutBreakdown = {
  gross_collected?: number;
  fees?: number;
  refunds?: number;
  chargebacks?: number;
  reserve_withheld?: number;
  reserve_released?: number;
  adjustments?: number;
  net_payout?: number;
  tax_collected_and_remitted_by_platform?: number;
  balance_transactions?: number;
  note?: string | null;
};

export type PayoutDetail = {
  payout: Omit<Payout, "breakdown"> & { breakdown?: PayoutBreakdown | null };
  destination: PayoutDestination | null;
  balance_transactions: BalanceTransaction[];
  timeline: StateTransition[];
};

export type LedgerAccount = { id: string; code: string; currency: string; kind: string; balance: number };
export type LedgerEntry = {
  id: string;
  created_at: string;
  account: string;
  direction: "D" | "C";
  amount: number;
  currency: string;
  transaction: string;
  type: string;
  description: string;
  source_type: string;
  source_id: string;
};

export type Statement = {
  object: "statement";
  currency: string;
  period_start: string;
  period_end: string;
  opening_balance: number;
  payments_net_of_tax: number;
  refunds: number;
  disputes: number;
  fees: number;
  adjustments: number;
  payouts: number;
  transfers_to_wallet: number;
  closing_balance: number;
  reconciles: boolean;
  tax_collected_and_remitted_by_platform: number;
};

export type TaxJurisdiction = {
  country: string;
  tax_type: string;
  currency: string;
  taxable_sales: number;
  tax_collected: number;
  reverse_charge_sales: number;
  records: number;
};
export type TaxSummary = { object: "tax_summary"; note: string; by_jurisdiction: TaxJurisdiction[]; registrations: string[] };

export type DisputeDetail = {
  dispute: Dispute;
  payment: Payment;
  evidence: DisputeEvidence[];
  suggested_evidence: {
    purchase: { id: string; created_at: string; amount: number; currency: string; customer_email?: string | null; card_brand?: string | null; last4?: string | null; three_ds_result?: string | null };
    terms_accepted?: string | null;
    ip?: string | null;
    entitlements: Entitlement[];
    usage_events: number;
  };
};
