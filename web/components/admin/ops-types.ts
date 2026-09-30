/**
 * Shapes of the operations endpoints used by the console (support, incidents, marketplace sellers,
 * files, feature flags). snake_case of the C# entities in OperationsEndpoints / GrowthEndpoints.
 */
import type { Base } from "./types";

// ───────── Support (§110, §207) ─────────

export type TicketStatus = "open" | "awaiting_merchant" | "resolved" | "closed";
export type TicketPriority = "normal" | "high" | "urgent";

export type SupportTicket = Base & {
  org_id: string;
  created_by_user_id: string;
  subject: string;
  category: string;
  status: TicketStatus | string;
  priority: TicketPriority | string;
  assigned_to: string | null;
  related_object_id: string | null;
  updated_at: string;
};

export type TicketRow = { ticket: SupportTicket; organization: string | null };

export type TicketMessage = Base & {
  ticket_id: string;
  author_id: string;
  author_type: "merchant" | "staff" | string;
  body: string;
  internal: boolean;
};

export type TicketDetail = {
  ticket: SupportTicket;
  messages: TicketMessage[];
  account: {
    id: string;
    name: string;
    status: string;
    go_live_state: string;
    restriction: string;
    country: string;
    recent_failed_payments: { id: string; failure_code: string | null; created_at: string }[];
  };
};

// ───────── Incidents (§111) ─────────

export type IncidentSeverity = "minor" | "major" | "critical";
export type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved";

export type Incident = Base & {
  title: string;
  severity: IncidentSeverity | string;
  status: IncidentStatus | string;
  affected_services_csv: string;
  customer_impact: string;
  started_at: string;
  resolved_at: string | null;
  created_by: string;
};

/** GET /v1/incidents — open incidents plus those resolved in the last 14 days, with their updates. */
export type IncidentWithUpdates = { incident: Incident; updates: { status: string; message: string; created_at: string }[] };

export type PublicStatus = {
  object: "status";
  overall: "operational" | "degraded" | "major_outage" | string;
  incidents: { id: string; title: string; severity: string; status: string; affected: string[]; customer_impact: string; started_at: string }[];
  payment_providers: { name: string; health_state: string }[];
};

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
  payout_bank_name: string | null;
  payout_currency: string | null;
  payout_last4: string | null;
  decision_reason: string | null;
};

// ───────── Files (§96) ─────────

export type StoredFile = Base & {
  org_id: string | null;
  user_id: string | null;
  purpose: string;
  file_name: string;
  content_type: string;
  size: number;
  sha256: string;
  uploaded_by: string | null;
  scan_status: string;
  livemode: boolean;
  linked_object_id: string | null;
};

export type FileLink = { object: "file_link"; url: string; expires_at: string; file: StoredFile };

// ───────── Feature flags (§119) ─────────

export type FeatureFlag = Base & {
  key: string;
  description: string;
  enabled: boolean;
  rollout_percent: number;
  org_ids_csv: string | null;
  countries_csv: string | null;
  /** "*" | Development | Production */
  environment: string;
  updated_at: string;
};
