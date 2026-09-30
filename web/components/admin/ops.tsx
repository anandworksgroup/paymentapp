"use client";

/**
 * Small shared pieces for the operations pages (support, incidents, overview card): status chips
 * whose wording matches the API enums, and the incident progress track.
 */
import Link from "next/link";
import { Card, Chip, cx, type Tone } from "@/components/ui";
import { CardHeader } from "./card-header";
import { useAdminQuery } from "./data";
import { When } from "./kit";
import type { IncidentWithUpdates, TicketPriority, TicketStatus } from "./ops-types";
import type { ListResponse } from "./types";

// ───────── Support ─────────

export const TICKET_STATUSES: { value: TicketStatus; label: string; tone: Tone }[] = [
  { value: "open", label: "Open", tone: "lemon" },
  { value: "awaiting_merchant", label: "Awaiting merchant", tone: "sky" },
  { value: "resolved", label: "Resolved", tone: "sage" },
  { value: "closed", label: "Closed", tone: "neutral" },
];

export const TICKET_PRIORITIES: { value: TicketPriority; label: string; tone: Tone }[] = [
  { value: "urgent", label: "Urgent", tone: "rose" },
  { value: "high", label: "High", tone: "peach" },
  { value: "normal", label: "Normal", tone: "neutral" },
];

export const TICKET_CATEGORIES: Record<string, string> = {
  bug: "Bug",
  payment_issue: "Payment issue",
  tax_issue: "Tax issue",
  checkout_issue: "Checkout issue",
  feature_request: "Feature request",
  account: "Account",
  other: "Other",
};

export function TicketStatusChip({ status }: { status: string }) {
  const s = TICKET_STATUSES.find((x) => x.value === status);
  return <Chip tone={s?.tone ?? "neutral"}>{s?.label ?? status.replace(/_/g, " ")}</Chip>;
}

export function PriorityChip({ priority }: { priority: string }) {
  const p = TICKET_PRIORITIES.find((x) => x.value === priority);
  return <Chip tone={p?.tone ?? "neutral"}>{p?.label ?? priority}</Chip>;
}

// ───────── Incidents ─────────

export const INCIDENT_STEPS: { value: string; label: string; help: string }[] = [
  { value: "investigating", label: "Investigating", help: "We know something is wrong and are looking into it." },
  { value: "identified", label: "Identified", help: "The cause is known and a fix is being worked on." },
  { value: "monitoring", label: "Monitoring", help: "A fix is in place; we are watching to confirm recovery." },
  { value: "resolved", label: "Resolved", help: "Service is back to normal. The incident leaves the public status page." },
];

export const SEVERITIES: { value: "minor" | "major" | "critical"; label: string; tone: Tone; help: string }[] = [
  { value: "minor", label: "Minor", tone: "lemon-soft", help: "Small or partial impact. Status page shows “degraded”." },
  { value: "major", label: "Major", tone: "peach", help: "Significant impact for many merchants. Status page shows “degraded”." },
  { value: "critical", label: "Critical", tone: "rose", help: "Core payments unavailable. Status page shows “major outage”." },
];

export function SeverityChip({ severity }: { severity: string }) {
  const s = SEVERITIES.find((x) => x.value === severity);
  return <Chip tone={s?.tone ?? "neutral"}>{s?.label ?? severity}</Chip>;
}

export function IncidentStatusChip({ status }: { status: string }) {
  const tone: Tone = status === "resolved" ? "sage" : status === "monitoring" ? "sky" : status === "identified" ? "lemon-soft" : "peach";
  const label = INCIDENT_STEPS.find((x) => x.value === status)?.label ?? status;
  return <Chip tone={tone}>{label}</Chip>;
}

/** Four-step pill track (investigating → identified → monitoring → resolved). */
export function IncidentTrack({ status }: { status: string }) {
  const at = INCIDENT_STEPS.findIndex((x) => x.value === status);
  return (
    <ol className="flex items-center gap-1 rounded-full bg-surface-3 p-1" aria-label={`Status: ${status}`}>
      {INCIDENT_STEPS.map((s, i) => (
        <li
          key={s.value}
          title={s.help}
          aria-current={i === at ? "step" : undefined}
          className={cx(
            "flex-1 truncate rounded-full px-2 py-1 text-center text-[11.5px] font-medium",
            i === at ? (s.value === "resolved" ? "bg-sage-300 text-sage-700" : "bg-ink text-white") : i < at ? "bg-sage-100 text-sage-700" : "text-muted",
          )}
        >
          {s.label}
        </li>
      ))}
    </ol>
  );
}

export function splitCsv(csv: string | null | undefined) {
  return (csv ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Overview card: incidents that are not resolved yet. Hidden when there are none. */
export function ActiveIncidentsCard() {
  const q = useAdminQuery<ListResponse<IncidentWithUpdates>>("/incidents");
  const active = (q.data?.data ?? []).map((x) => x.incident).filter((i) => i.status !== "resolved");
  if (!q.data || active.length === 0) return null;
  return (
    <Card className="border border-peach-soft">
      <CardHeader
        title="Active incidents"
        subtitle="Shown on the public status page until resolved."
        action={
          <Link href="/admin/incidents" className="inline-flex h-8 items-center rounded-full bg-surface-2 px-3.5 text-[12.5px] font-medium text-text hover:bg-surface-3">
            Manage incidents
          </Link>
        }
      />
      <ul className="space-y-2">
        {active.slice(0, 4).map((i) => (
          <li key={i.id}>
            <Link href={`/admin/incidents#${i.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-inner bg-surface-2 px-4 py-3 hover:bg-surface-3">
              <span className="flex min-w-0 items-center gap-2">
                <SeverityChip severity={i.severity} />
                <span className="truncate text-[13.5px] text-text">{i.title || "Untitled incident"}</span>
              </span>
              <span className="flex items-center gap-2 text-[12px] text-muted">
                <IncidentStatusChip status={i.status} />
                started <When at={i.started_at} rel />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
