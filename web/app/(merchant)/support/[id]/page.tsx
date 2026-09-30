"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { date, titleCase } from "@/lib/format";
import { useAction, useApi } from "@/lib/merchant/hooks";
import { Button, Card, CardHeader, Chip, ErrorNote, PageHeader, Textarea, cx } from "@/components/ui";
import { useMerchant, useToast } from "@/components/merchant/context";
import { BackLink, ConfirmModal, DetailSkeleton, KV, Loaded, Mono } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { TicketStatusChip } from "@/components/merchant/ops/shared";
import { TICKET_CATEGORIES, type TicketDetail, type TicketMessage } from "@/components/merchant/ops/types";

const CATEGORY = Object.fromEntries(TICKET_CATEGORIES.map((c) => [c.value, c.label])) as Record<string, string>;

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const res = useApi<TicketDetail>(`/v1/support/tickets/${id}`);
  return (
    <>
      <BackLink href="/support">Support</BackLink>
      <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<DetailSkeleton />}>
        {(d) => <Ticket d={d} reload={res.reload} />}
      </Loaded>
    </>
  );
}

function Ticket({ d, reload }: { d: TicketDetail; reload: () => void }) {
  const { me } = useMerchant();
  const toast = useToast();
  const t = d.ticket;
  const [reply, setReply] = useState("");
  const send = useAction();
  const close = useAction();
  const [confirmClose, setConfirmClose] = useState(false);
  const closed = t.status === "closed";
  const relatedHref = t.related_object_id ? objectHref(t.related_object_id) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    const m = await send.run(() => api<TicketMessage>(`/v1/support/tickets/${t.id}/messages`, { body: { body: reply.trim() } }));
    if (m) {
      setReply("");
      toast("Reply sent");
      reload();
    }
  };

  const doClose = async () => {
    const ok = await close.run(() => api(`/v1/support/tickets/${t.id}/close`, { method: "POST" }));
    if (ok !== undefined) {
      setConfirmClose(false);
      toast("Ticket closed");
      reload();
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={<Mono>{t.id}</Mono>}
        title={t.subject}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><TicketStatusChip status={t.status} /> {CATEGORY[t.category] ?? titleCase(t.category)} · opened {date(t.created_at, true)}</span>}
        actions={!closed && <Button variant="soft" onClick={() => setConfirmClose(true)} icon={<Icon name="check" size={16} />}>Close ticket</Button>}
      />
      {t.status === "awaiting_merchant" && (
        <div role="status" className="mb-5 flex items-center gap-3 rounded-inner bg-peach-soft px-5 py-3.5 text-[13.5px] text-peach-ink">
          <Icon name="info" size={17} /> Support replied and is waiting for you. Reply below, or close the ticket if the issue is solved.
        </div>
      )}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader title="Conversation" />
          <ol className="space-y-4">
            {d.messages.map((m) => {
              const mine = m.author_type === "merchant";
              return (
                <li key={m.id} className={cx("flex", mine ? "justify-end" : "justify-start")}>
                  <div className={cx("max-w-[85%] rounded-inner px-4 py-3", mine ? "bg-surface-2" : "sage-gradient")}>
                    <div className="mb-1 flex items-center gap-2 text-[12px] text-muted">
                      <span className="font-medium text-text-2">{mine ? (m.author_id === me.user.id ? "You" : "Your team") : "Support"}</span>
                      <span>{date(m.created_at, true)}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-text">{m.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          {closed ? (
            <p className="mt-6 rounded-inner bg-surface-2 px-4 py-3 text-[13px] text-muted">This ticket is closed. Open a new ticket if you need more help.</p>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-3">
              <label className="block">
                <span className="sr-only">Reply</span>
                <Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4} placeholder="Write a reply…" maxLength={10000} />
              </label>
              {send.error ? <ErrorNote error={send.error} /> : null}
              <div className="flex justify-end">
                <Button type="submit" loading={send.busy} disabled={!reply.trim()} icon={<Icon name="send" size={15} />}>Send reply</Button>
              </div>
            </form>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader title="Details" />
          <KV
            rows={[
              ["Status", <TicketStatusChip key="s" status={t.status} />],
              ["Priority", t.priority === "normal" ? "Normal" : <Chip key="p" tone={t.priority === "urgent" ? "rose" : "peach"}>{titleCase(t.priority)}</Chip>],
              ["Category", CATEGORY[t.category] ?? titleCase(t.category)],
              ["Related", t.related_object_id ? (relatedHref ? <Link key="r" href={relatedHref} className="font-mono text-[12px] underline-offset-4 hover:underline">{t.related_object_id}</Link> : <Mono key="r">{t.related_object_id}</Mono>) : null],
              ["Opened", date(t.created_at, true)],
              ["Last activity", date(t.updated_at, true)],
            ]}
          />
        </Card>
      </div>
      <ConfirmModal open={confirmClose} onClose={() => setConfirmClose(false)} title="Close this ticket?" confirmLabel="Close ticket" busy={close.busy} error={close.error} onConfirm={doClose}>
        <p>Close it if your issue is solved. A closed ticket can&apos;t be reopened, but you can always start a new one.</p>
      </ConfirmModal>
    </>
  );
}

/** Dashboard page for an object id, by its prefix, so a related payment or invoice is one click away. */
function objectHref(id: string) {
  const routes: Record<string, string> = { pay: "payments", inv: "invoices", po: "payouts", dspt: "disputes", ord: "orders", sub: "subscriptions", cus: "customers", prod: "products" };
  const route = routes[id.split("_")[0]];
  return route && /^[A-Za-z0-9_]+$/.test(id) ? `/${route}/${id}` : null;
}
