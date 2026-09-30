"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Amount, Button, Card, Chip, Empty, Field, Input, PageHeader, StatusChip, Table } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { adminApi, qs, useAdminQuery } from "@/components/admin/data";
import { Country, EntityLink, IdTag, KV, Loadable, Mono, Notice, PageSkeleton, Panel, Person, ReadOnlyNote, ReasonDialog, When, WalletRef, humanize } from "@/components/admin/kit";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import type { Approval, ListResponse, TransferDetail } from "@/components/admin/types";

export default function TransferDetailPage() {
  return (
    <Guard perm="admin.transactions.read">
      <TransferBody />
    </Guard>
  );
}

const isDebit = (d: string) => d === "D" || d.toLowerCase() === "debit";

function rate(e9?: number | null) {
  return e9 ? (e9 / 1e9).toFixed(6) : "—";
}

function TransferBody() {
  const { id } = useParams<{ id: string }>();
  const q = useAdminQuery<TransferDetail>(`/transfers/${id}`);
  const pending = useAdminQuery<ListResponse<Approval>>(`/approvals${qs({ status: "pending", limit: 100 })}`);
  return (
    <Loadable q={q} skeleton={<PageSkeleton />}>
      {(d) => (
        <TransferView
          d={d}
          pending={(pending.data?.data ?? []).filter((a) => a.target_id === d.transfer.id)}
          reload={() => {
            q.reload();
            pending.reload();
          }}
        />
      )}
    </Loadable>
  );
}

function TransferView({ d, pending, reload }: { d: TransferDetail; pending: Approval[]; reload: () => void }) {
  const { can, guard } = useAdmin();
  const t = d.transfer;
  const [ask, setAsk] = useState<"release_transfer" | "reject_transfer" | null>(null);
  const caseIds = [...new Set(d.alerts.map((a) => a.case_id).filter(Boolean))] as string[];
  const [caseId, setCaseId] = useState(caseIds[0] ?? "");
  const [created, setCreated] = useState<Approval | null>(null);
  const held = t.status === "HELD";
  const canRequest = can("admin.aml.write");

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            {humanize(t.type)} transfer · <IdTag id={t.id} full />
          </span>
        }
        title={
          <span className="inline-flex flex-wrap items-baseline gap-3">
            <Amount minor={t.source_amount} currency={t.source_currency} size="lg" />
            {t.destination_currency !== t.source_currency && (
              <span className="text-[20px] text-muted">
                → <Amount minor={t.destination_amount} currency={t.destination_currency} size="md" />
              </span>
            )}
          </span>
        }
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusChip status={t.status} />
            <Country code={t.sender_country} /> <span className="text-faint">→</span> <Country code={t.recipient_country} />
            <span className="text-muted">
              · created <When at={t.created_at} />
            </span>
          </span>
        }
        actions={
          <>
            {can("admin.aml.read") && (
              <Link href={`/admin/transactions/${t.id}/trace`} className="inline-flex h-11 items-center rounded-full bg-lemon px-5 text-[14px] font-medium text-lemon-ink hover:brightness-95">
                Trace funds
              </Link>
            )}
            {held &&
              (canRequest ? (
                <>
                  <Button variant="danger" onClick={() => setAsk("reject_transfer")} disabled={pending.some((p) => p.action === "reject_transfer")}>
                    Request rejection
                  </Button>
                  <Button onClick={() => setAsk("release_transfer")} disabled={pending.some((p) => p.action === "release_transfer")}>
                    Request release
                  </Button>
                </>
              ) : (
                <ReadOnlyNote>Held transfers are released or rejected by AML staff with a second approver.</ReadOnlyNote>
              ))}
          </>
        }
      />

      {(created || pending.length > 0) && (
        <div className="mb-5 space-y-2">
          {created && (
            <Notice tone="sky">
              Request created: <b>{humanize(created.action)}</b>. It takes effect only after a different reviewer approves it in <Link className="underline" href="/admin/approvals">Approvals</Link>.
            </Notice>
          )}
          {pending
            .filter((p) => p.id !== created?.id)
            .map((p) => (
              <Notice key={p.id} tone="lemon">
                Awaiting four-eyes approval: <b>{humanize(p.action)}</b>, requested by <Person id={p.requested_by} /> <When at={p.created_at} rel /> — “{p.reason}”
              </Notice>
            ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Parties" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Panel title="Sender">
              {d.sender ? (
                <KV
                  cols={1}
                  items={[
                    ["Wallet", <WalletRef key="w" id={d.sender.id} />],
                    ["Handle", d.sender.handle],
                    ["Wallet status", <StatusChip key="s" status={d.sender.status} />],
                  ]}
                />
              ) : (
                <KV cols={1} items={[["Source", t.source_org_id ? <EntityLink key="o" type="org" id={t.source_org_id} /> : humanize(t.funding_source) || "External funding"]]} />
              )}
            </Panel>
            <Panel title="Recipient">
              {d.recipient ? (
                <KV
                  cols={1}
                  items={[
                    ["Wallet", <WalletRef key="w" id={d.recipient.id} />],
                    ["Handle", d.recipient.handle],
                    ["Wallet status", <StatusChip key="s" status={d.recipient.status} />],
                  ]}
                />
              ) : d.bank_account ? (
                <KV
                  cols={1}
                  items={[
                    ["Bank", d.bank_account.bank_name],
                    ["Account", <span key="a" className="font-mono">•••• {d.bank_account.last4}</span>],
                    ["Country", <Country key="c" code={d.bank_account.country} />],
                    ["Verification", <StatusChip key="v" status={d.bank_account.verification_status} />],
                    ["Added", <When key="w" at={d.bank_account.created_at} />],
                  ]}
                />
              ) : (
                <p className="text-[13px] text-muted">External recipient</p>
              )}
            </Panel>
          </div>
          <div className="mt-5">
            <KV
              cols={3}
              items={[
                ["Initiated by", <Person key="p" id={t.initiated_by} />],
                ["IP address", t.ip ? <Mono key="ip">{t.ip}</Mono> : null],
                ["Device", t.device_id ? <IdTag key="d" id={t.device_id} /> : null],
                ["Rail", t.rail],
                ["Purpose", t.purpose],
                ["Source of funds", t.source_of_funds],
                ["Fee", <Amount key="f" minor={t.fee_amount} currency={t.source_currency} size="sm" />],
                ["FX spread", <Amount key="s" minor={t.fx_spread_amount} currency={t.destination_currency} size="sm" />],
                ["Screening", t.screening_result ? <StatusChip key="sc" status={t.screening_result} /> : null],
                ["Completed", t.completed_at ? <When key="c" at={t.completed_at} /> : null],
                ["Parent transfer", t.parent_transfer_id ? <EntityLink key="pt" type="transfer" id={t.parent_transfer_id} /> : null],
                ["Ledger transaction", d.lineage.ledger_transaction ? <EntityLink key="l" type="ledger_transaction" id={d.lineage.ledger_transaction} /> : null],
              ]}
            />
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Internal reason" subtitle="Staff-only. Never shown to the customer." />
            <p className="rounded-inner bg-surface-2 px-4 py-3 text-[13.5px] text-text">{d.internal_reason ?? <span className="text-muted">No internal reason recorded.</span>}</p>
            <div className="mt-4 text-[12px] text-muted">What the customer sees</div>
            <p className="mt-1 rounded-inner bg-sage-50 px-4 py-3 text-[13.5px] text-text-2">{t.customer_message ?? "—"}</p>
            {t.failure_reason && (
              <>
                <div className="mt-4 text-[12px] text-muted">Failure / cancellation reason</div>
                <p className="mt-1 text-[13.5px] text-text-2">{t.failure_reason}</p>
              </>
            )}
          </Card>
          <Card>
            <CardHeader title="FX quote" subtitle={d.fx_quote ? `${d.fx_quote.from_currency} → ${d.fx_quote.to_currency}` : "Same-currency transfer."} />
            {d.fx_quote ? (
              <KV
                items={[
                  ["Mid-market rate", <Mono key="m">{rate(d.fx_quote.mid_rate_e9)}</Mono>],
                  ["Customer rate", <Mono key="c">{rate(d.fx_quote.customer_rate_e9)}</Mono>],
                  ["Spread", `${(d.fx_quote.spread_bps / 100).toFixed(2)}%`],
                  ["Spread amount", <Amount key="sa" minor={d.fx_quote.spread_amount} currency={d.fx_quote.to_currency} size="sm" />],
                  ["Fee", <Amount key="fe" minor={d.fx_quote.fee_amount} currency={d.fx_quote.from_currency} size="sm" />],
                  ["Rate source", d.fx_quote.rate_source],
                  ["Rate time", <When key="rt" at={d.fx_quote.rate_timestamp} />],
                  ["Quote used", <When key="u" at={d.fx_quote.used_at} />],
                ]}
              />
            ) : (
              <p className="text-[13px] text-muted">No conversion.</p>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Alerts on this transfer" />
          {!can("admin.aml.read") ? (
            <ReadOnlyNote>Alerts are visible to AML roles only.</ReadOnlyNote>
          ) : (
            <Table
              rows={d.alerts}
              rowKey={(r) => r.id}
              empty={<Empty title="No alerts">No monitoring rule flagged this transfer.</Empty>}
              columns={[
                { key: "s", header: "Summary", render: (r) => <EntityLink type="alert" id={r.id}>{r.summary}</EntityLink> },
                { key: "rule", header: "Rule", render: (r) => <Mono>{r.rule_key} v{r.rule_version}</Mono> },
                { key: "sv", header: "Severity", render: (r) => <StatusChip status={r.severity} /> },
                { key: "st", header: "Status", render: (r) => <StatusChip status={r.status} /> },
                { key: "c", header: "Case", render: (r) => (r.case_id ? <EntityLink type="case" id={r.case_id} /> : <span className="text-faint">—</span>) },
              ]}
            />
          )}
        </Card>
        <Card>
          <CardHeader title="Screening" subtitle="Sanctions and watch-list checks linked to this transfer." />
          <Table
            rows={d.screening}
            rowKey={(r) => r.id}
            empty={<Empty title="No screening checks linked" />}
            columns={[
              { key: "n", header: "Screened name", render: (r) => r.screened_name },
              { key: "c", header: "Context", render: (r) => humanize(r.context) },
              { key: "r", header: "Result", render: (r) => <StatusChip status={r.result} /> },
              { key: "s", header: "Score", align: "right", render: (r) => r.score },
              { key: "l", header: "List version", render: (r) => <span className="text-[12px] text-muted">{r.list_version}</span> },
            ]}
          />
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Ledger entries" subtitle="Double-entry postings created by this transfer." />
          {d.ledger.length === 0 ? (
            <Empty title="Nothing posted yet">{held ? "Held transfers post to the ledger only when released." : "No ledger postings reference this transfer."}</Empty>
          ) : (
            <div className="space-y-4">
              {d.ledger.map((l) => (
                <div key={l.id}>
                  <div className="mb-1.5 flex items-center justify-between text-[12.5px] text-muted">
                    <span>
                      {humanize(l.type)} · <When at={l.created_at} />
                    </span>
                    <EntityLink type="ledger_transaction" id={l.id} />
                  </div>
                  <Table
                    rows={l.entries.map((e, i) => ({ ...e, key: `${l.id}-${i}` }))}
                    rowKey={(r) => r.key}
                    columns={[
                      { key: "a", header: "Account", render: (r) => <Mono className="text-text">{r.account}</Mono> },
                      { key: "o", header: "Owner", render: (r) => (r.owner ? <IdTag id={r.owner} /> : <span className="text-muted">Platform</span>) },
                      { key: "dr", header: "Debit", align: "right", render: (r) => (isDebit(r.direction) ? <Amount minor={r.amount} currency={r.currency} size="sm" /> : "") },
                      { key: "cr", header: "Credit", align: "right", render: (r) => (!isDebit(r.direction) ? <Amount minor={r.amount} currency={r.currency} size="sm" /> : "") },
                    ]}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="State timeline" />
          {d.timeline.length === 0 ? (
            <Empty title="No state changes recorded" />
          ) : (
            <ol className="relative ml-2 border-l border-line pl-6">
              {d.timeline.map((s) => (
                <li key={s.id} className="relative pb-5 last:pb-0">
                  <span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-surface bg-ink" />
                  <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
                    {s.from_state ? <StatusChip status={s.from_state} /> : <Chip>start</Chip>}
                    <span className="text-faint">→</span>
                    <StatusChip status={s.to_state} />
                    <span className="text-[12.5px] text-muted">
                      <When at={s.created_at} />
                    </span>
                  </div>
                  <div className="mt-1 text-[12.5px] text-text-2">
                    {s.reason ?? "No reason recorded"} · by <Person id={s.actor_id} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <ReasonDialog
        open={ask !== null}
        onClose={() => setAsk(null)}
        title={ask === "release_transfer" ? "Request release of this transfer" : "Request rejection of this transfer"}
        tone={ask === "reject_transfer" ? "danger" : "ink"}
        confirmLabel="Submit for approval"
        description={
          <>
            Held funds move only after four-eyes approval: a <b>different</b> reviewer must approve this request (they will be asked to re-authenticate).{" "}
            {ask === "release_transfer"
              ? "On approval the transfer completes and posts to the ledger."
              : "On approval the transfer is cancelled and the held funds are returned to the sender's available balance."}
          </>
        }
        onSubmit={async (reason) => {
          const a = await guard(() =>
            adminApi<Approval>("/approvals", { body: { action: ask, target_type: "transfer", target_id: t.id, reason, case_id: caseId.trim() || undefined } }),
          );
          setCreated(a);
          reload();
        }}
      >
        <Field label="Link to case (optional)" hint={caseIds.length ? "Pre-filled from this transfer's alerts." : "Paste a case id to attach the request to a case file."}>
          <Input value={caseId} onChange={(e) => setCaseId(e.target.value)} placeholder="case_…" />
        </Field>
      </ReasonDialog>
    </>
  );
}
