export type PublicLine = {
  price_id: string;
  description?: string | null;
  quantity: number;
  unit_amount: number;
  amount: number;
  discount: number;
  tax: number;
  tax_rate_bps: number;
  tax_type?: string | null;
  tax_inclusive: boolean;
  product?: { name: string; description?: string | null; image_url?: string | null } | null;
};

export type PublicCheckout = {
  id: string;
  status: "open" | "complete" | "expired";
  mode: "payment" | "subscription";
  livemode: boolean;
  currency: string;
  country?: string | null;
  customer_email?: string | null;
  merchant: { name: string; brand_color?: string | null; logo_url?: string | null; support_email?: string | null };
  seller_of_record: string;
  line_items: PublicLine[];
  subtotal: number;
  discount: number;
  tax: number;
  tax_label?: string | null;
  total: number;
  trial_days: number;
  recurring?: string | null;
  coupon?: { code: string; name?: string | null } | null;
  payment_methods: string[];
  terms?: { version: number; title: string } | null;
  expires_at: string;
  success_url?: string | null;
  cancel_url?: string | null;
  payment_id?: string | null;
  test_mode_notice?: string | null;
};

export type Confirmation = {
  checkout_session: string;
  status: string;
  payment_status?: string | null;
  payment?: string | null;
  next_action?: { type: string; redirect_url?: string } | null;
  failure_code?: string | null;
  failure_message?: string | null;
  suggested_action?: string | null;
  success_url?: string | null;
  order?: string | null;
  subscription?: string | null;
};
