"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ReactNode, useState } from "react";
import { Button, Card, Chip, cx, ErrorNote, Field, PageHeader, Select, StatusChip, Textarea } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { adminApi, useAdminQuery, useDirectory } from "@/components/admin/data";
import { Country, EntityLink, IdTag, KV, Loadable, Mono, Notice, PageSkeleton, Person, ReadOnlyNote, When, humanize } from "@/components/admin/kit";
import { PriorityChip, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, TicketStatusChip } from "@/components/admin/ops";
import type { SupportTicket, TicketDetail, TicketMessage } from "@/components/admin/ops-types";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";

/** Platform roles that hold admin.support (Infrastructure/Security.cs) — the only sensible assignees. */
const SUPPORT_ROLES = ["SUPER_ADMIN", "SUPPORT_ADMIN"];

export default function TicketPage() {
  return (
    <Guard perm="admin.support">
      <TicketBody />
    </Guard>
  );
}

function TicketBody() {
  const { id } = useParams<{ id: string }>();
  const q = useAdminQuery<TicketDetail>(`/support/tickets/${id}`);
  return (
    <Loadable q={q} skeleton={<PageSkeleton />}>
      {(d) => <TicketView d={d} reload={q.reload} />}
    </Loadable>
  );
}

type Note = { tone: "sage" | "sky" | "lemon"; text: ReactNode } | null;

function TicketView({ d, reload }: { d: TicketDetail; reload: () => void }) {
  const { me, guard } = useAdmin();
  const t = d.ticket;
  const [notice, setNotice] = useState<Note>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const internalCount = d.messages.filter((m) => m.internal).length;

  const patch = async (label: string, body: Partial<Pick<SupportTicket, "status" | "priority" | "assigned_to">>, done: string) => {
    setBusy(label);
    setError(null);
    try {
      await guard(() => adminApi(`/support/tickets/${t.id}`, { method: "PATCH", body }));
      setNotice({ tone: "sage", text: done });
      reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <Link href="/admin/support" className="hover:text-text">
              Support
            </Link>{" "}
            · <IdTag id={t.id} full />
          </span>
        }
        title={t.subject}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <TicketStatusChip status={t.status} />
            <PriorityChip priority={t.priority} />
            <Chip>{TICKET_CATEGORIES[t.category] ?? humanize(t.category)}</Chip>
            <span className="text-[13px] text-muted">
              from <EntityLink type="org" id={t.org_id}>{d.account.name}</EntityLink> · opened <When at={t.created_at} rel />
            </span>
          </span>
        }
        actions={
          <>
            {t.assigned_to !== me?.user.id && (
              <Button variant="soft" loading={busy === "assign"} onClick={() => patch("assign", { assigned_to: me!.user.id }, "Ticket assigned to you.")}>
                Assign to me
              </Button>
            )}
            {(t.status === "open" || t.status === "awaiting_merchant") && (
              <Button loading={busy === "resolve"} onClick={() => patch("resolve", { status: "resolved" }, "Ticket marked resolved. The merchant can still reply, which reopens it.")}>
                Mark resolved
              </Button>
            )}
          </>
        }
      />
      {(notice || error) && (
        <div className="mb-5 space-y-2">
          {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
          <ErrorNote error={error} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Conversation"
              subtitle={`${d.messages.length} message${d.messages.length === 1 ? "" : "s"}${internalCount ? ` · ${internalCount} internal note${internalCount === 1 ? "" : "s"} (staff only)` : ""}`}
            />
            <ul className="space-y-3">
              {d.messages.map((m) => (
                <MessageItem key={m.id} m={m} />
              ))}
            </ul>
          </Card>
          <Composer
            ticket={t}
            onSent={(internal) => {
              setNotice(
                internal
                  ? { tone: "lemon", text: "Internal note saved. It is visible to staff only." }
                  : { tone: "sage", text: "Reply sent. The merchant was notified and the ticket is now awaiting their response." },
              );
              reload();
            }}
          />
        </div>

        <div className="space-y-5">
          <TicketSettings key={t.updated_at} t={t} onSaved={(text) => { setNotice({ tone: "sage", text }); reload(); }} />
          <Card>
            <CardHeader
              title="Account context"
              subtitle="A controlled summary for support. Open the merchant record for full details."
              action={
                <Link href={`/admin/merchants/${d.account.id}`} className="inline-flex h-8 items-center rounded-full bg-surface-2 px-3.5 text-[12.5px] font-medium text-text hover:bg-surface-3">
                  Merchant record
                </Link>
              }
            />
            <KV
              items={[
                ["Merchant", <EntityLink key="o" type="org" id={d.account.id}>{d.account.name}</EntityLink>],
                ["Country", <Country key="c" code={d.account.country} />],
                ["KYB status", <StatusChip key="s" status={d.account.status} />],
                ["Go-live", <Chip key="g" tone={d.account.go_live_state === "PRODUCTION" ? "ink" : "neutral"}>{d.account.go_live_state.toLowerCase()}</Chip>],
                [
                  "Restriction",
                  d.account.restriction === "NORMAL" ? (
                    <span key="r" className="text-muted">None</span>
                  ) : (
                    <Chip key="r" tone="peach">{d.account.restriction.replace(/_/g, " ").toLowerCase()}</Chip>
                  ),
                ],
                ["Raised by", <Person key="p" id={t.created_by_user_id} />],
                ["Related object", t.related_object_id ? <EntityLink key="rel" id={t.related_object_id} /> : null],
              ]}
            />
            <div className="mt-5">
              <div className="mb-2 text-[12.5px] text-muted">Recent failed payments</div>
              {d.account.recent_failed_payments.length === 0 ? (
                <p className="rounded-inner bg-surface-2 px-4 py-3 text-[13px] text-muted">No failed payments on record.</p>
              ) : (
                <ul className="space-y-1.5">
                  {d.account.recent_failed_payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 rounded-[14px] bg-surface-2 px-3.5 py-2.5 text-[13px]">
                      <span className="flex min-w-0 items-center gap-2">
                        <IdTag id={p.id} />
                        <Chip tone="rose">{p.failure_code ? humanize(p.failure_code) : "Failed"}</Chip>
                      </span>
                      <When at={p.created_at} rel />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

function MessageItem({ m }: { m: TicketMessage }) {
  const staff = m.author_type === "staff";
  if (m.internal) {
    return (
      <li className="rounded-inner border border-dashed border-lemon-ink/30 bg-lemon-soft p-4 sm:ml-10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-lemon-ink">
            <LockIcon /> Internal note · not visible to merchant
          </span>
          <span className="text-[12px] text-lemon-ink/80">
            <Person id={m.author_id} /> · <When at={m.created_at} />
          </span>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-text">{m.body}</p>
      </li>
    );
  }
  return (
    <li className={cx("rounded-inner p-4", staff ? "bg-sage-100 sm:ml-10" : "bg-surface-2 sm:mr-10")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[12.5px]">
          <Chip tone={staff ? "ink" : "neutral"}>{staff ? "Staff reply" : "Merchant"}</Chip>
          <Person id={m.author_id} />
        </span>
        <span className="text-[12px] text-muted">
          <When at={m.created_at} />
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-text">{m.body}</p>
    </li>
  );
}

function Composer({ ticket, onSent }: { ticket: SupportTicket; onSent: (internal: boolean) => void }) {
  const { guard } = useAdmin();
  const [internal, setInternal] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await guard(() => adminApi(`/support/tickets/${ticket.id}/messages`, { body: { body: body.trim(), internal } }));
      setBody("");
      onSent(internal);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={cx("transition", internal && "!bg-lemon-soft/60 outline-2 outline-dashed outline-lemon-ink/25")}>
      <CardHeader
        title={internal ? "Internal note" : "Reply to merchant"}
        subtitle={
          internal
            ? "Only platform staff can see this. The merchant is not notified."
            : "The merchant sees this in their dashboard and gets a notification. The ticket moves to Awaiting merchant."
        }
      />
      <label className="mb-4 flex cursor-pointer items-center justify-between gap-4 rounded-inner bg-surface-2 px-4 py-3">
        <span>
          <span className="block text-[13.5px] font-medium text-text">Internal note (not visible to merchant)</span>
          <span className="block text-[12px] text-muted">Use for investigation details, links and hand-over context.</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={internal}
          aria-label="Internal note (not visible to merchant)"
          onClick={() => setInternal((v) => !v)}
          className={cx("relative h-7 w-12 shrink-0 rounded-full transition", internal ? "bg-lemon" : "bg-surface-3")}
        >
          <span className={cx("absolute top-1 h-5 w-5 rounded-full bg-white shadow-card transition-all", internal ? "left-6" : "left-1")} />
        </button>
      </label>
      {!internal && ticket.status === "closed" && (
        <div className="mb-3">
          <Notice tone="peach">This ticket is closed. Sending a reply reopens it as Awaiting merchant.</Notice>
        </div>
      )}
      <Field label={internal ? "Note (staff only)" : "Message to merchant"} hint="Ctrl + Enter to send.">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={internal ? "What you checked and what you found. Not shared with the merchant." : "Plain, calm and specific. Avoid internal jargon and risk details."}
          className={cx("min-h-32", internal && "border-lemon-ink/30 bg-white")}
        />
      </Field>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12px] text-muted">{internal ? <Chip tone="lemon">Staff only</Chip> : <Chip tone="sage">Visible to merchant</Chip>}</span>
        <Button variant={internal ? "lemon" : "ink"} onClick={send} loading={busy} disabled={!body.trim()}>
          {internal ? "Save internal note" : "Send reply"}
        </Button>
      </div>
      <div className="mt-3">
        <ErrorNote error={error} />
      </div>
    </Card>
  );
}

function TicketSettings({ t, onSaved }: { t: SupportTicket; onSaved: (text: string) => void }) {
  const { me, guard, can } = useAdmin();
  const dir = useDirectory();
  const [status, setStatus] = useState(t.status);
  const [priority, setPriority] = useState(t.priority);
  const [assignee, setAssignee] = useState(t.assigned_to ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const staff = [...dir.users.values()].filter((u) => u.platform_role && SUPPORT_ROLES.includes(u.platform_role));
  const options = new Map<string, string>();
  if (me) options.set(me.user.id, `${me.user.name} (you)`);
  staff.forEach((u) => options.has(u.id) || options.set(u.id, u.name));
  if (t.assigned_to && !options.has(t.assigned_to)) options.set(t.assigned_to, dir.users.get(t.assigned_to)?.name ?? t.assigned_to);

  const changes: Record<string, string> = {};
  if (status !== t.status) changes.status = status;
  if (priority !== t.priority) changes.priority = priority;
  if (assignee && assignee !== (t.assigned_to ?? "")) changes.assigned_to = assignee;
  const dirty = Object.keys(changes).length > 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await guard(() => adminApi(`/support/tickets/${t.id}`, { method: "PATCH", body: changes }));
      onSaved(`Ticket updated: ${Object.keys(changes).map((k) => humanize(k)).join(", ").toLowerCase()}.`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Ticket" subtitle={<>Last activity <When at={t.updated_at} rel /></>} />
      <div className="space-y-3">
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {TICKET_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            {!TICKET_PRIORITIES.some((p) => p.value === t.priority) && <option value={t.priority}>{t.priority}</option>}
          </Select>
        </Field>
        <Field
          label="Assignee"
          hint={can("admin.users.read") ? "Staff whose role can work the support queue." : "Your role can't list staff; you can assign the ticket to yourself."}
        >
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            {!t.assigned_to && <option value="">Unassigned</option>}
            {[...options.entries()].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        {t.assigned_to && <ReadOnlyNote>Tickets can be reassigned but not returned to unassigned.</ReadOnlyNote>}
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-[12px] text-muted">
            Changes are audited as <Mono>support.update</Mono>.
          </span>
          <Button onClick={save} loading={busy} disabled={!dirty}>
            Save changes
          </Button>
        </div>
        <ErrorNote error={error} />
      </div>
    </Card>
  );
}
