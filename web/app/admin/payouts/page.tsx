"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Amount, Button, Card, Chip, Empty, Modal, PageHeader, StatusChip, Table } from "@/components/ui";
import { adminApi, qs, usePagedList } from "@/components/admin/data";
import { EntityLink, FilterBar, FilterSelect, humanize, IdTag, KV, Loadable, Mono, Notice, Pager, Panel, ReadOnlyNote, ReasonDialog, SkeletonRows, When } from "@/components/admin/kit";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import type { Approval, Payout } from "@/components/admin/types";
import { ApiError } from "@/lib/api";
import { date } from "@/lib/format";

/** Payout.Status in the backend: PENDING | PROCESSING | PAID | FAILED | RETURNED | ON_HOLD. */
const STATUSES = ["", "PENDING", "ON_HOLD", "PROCESSING", "PAID", "FAILED", "RETURNED"];

/** Breakdown lines in display order; any other numeric key is appended after these. */
const BREAKDOWN_ORDER = [
  "gross_collected",
  "fees",
  "refunds",
  "chargebacks",
  "reserve_withheld",
  "reserve_released",
  "adjustments",
  "tax_collected_and_remitted_by_platform",
];
/** Keys in the breakdown that are counts or text, not money. */
const NON_MONEY = new Set(["balance_transactions", "note", "net_payout"]);

export default function PayoutsPage() {
  return (
    <Guard perm="admin.transactions.read">
      <Payouts />
    </Guard>
  );
}

function Payouts() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { can } = useAdmin();
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [open, setOpen] = useState<Payout | null>(null);
  const [notice, setNotice] = useState<{ tone: "sage" | "lemon"; text: string } | null>(null);
  const list = usePagedList<Payout>(`/payouts${qs({ status })}`, 25);

  const changeStatus = (s: string) => {
    setStatus(s);
    router.replace(`${pathname}${qs({ status: s })}`, { scroll: false });
  };

  return (
    <>
      <PageHeader
        eyebrow="Finance · merchant settlements"
        title="Payouts"
        subtitle="Transfers of merchant balances to their bank accounts. Payouts on hold need a four-eyes approval to be released."
      />
      <div className="space-y-5">
        {notice && (
          <Notice tone={notice.tone}>
            {notice.text}{" "}
            <Link href="/admin/approvals" className="font-medium underline underline-offset-4">
              Open approvals
            </Link>
          </Notice>
        )}
        <Card>
          <FilterBar>
            <FilterSelect label="Status" value={status} onChange={changeStatus} options={STATUSES.map((s) => ({ value: s, label: s ? humanize(s) : "All statuses" }))} />
          </FilterBar>
          <Loadable q={list} skeleton={<SkeletonRows rows={6} />}>
            {() => (
              <>
                <Table
                  rows={list.rows}
                  rowKey={(r) => r.id}
                  onRowClick={setOpen}
                  empty={<Empty title="No payouts match">{status ? "Try another status filter." : "No payouts have been created yet."}</Empty>}
                  columns={[
                    {
                      key: "merchant",
                      header: "Merchant",
                      render: (r) => (
                        <div>
                          <EntityLink type="org" id={r.org_id} />
                          <div>
                            <IdTag id={r.id} />
                          </div>
                        </div>
                      ),
                    },
                    { key: "amount", header: "Amount", align: "right", render: (r) => <Amount minor={r.amount} currency={r.currency} size="sm" /> },
                    { key: "status", header: "Status", render: (r) => <StatusChip status={r.status} /> },
                    { key: "mode", header: "Mode", render: (r) => (r.livemode ? <Chip tone="ink">Live</Chip> : <Chip tone="lemon">Test</Chip>) },
                    { key: "arrival", header: "Arrival", render: (r) => <span className="whitespace-nowrap text-text-2">{r.arrival_date ? date(r.arrival_date) : "—"}</span> },
                    { key: "dest", header: "Destination", render: (r) => (r.destination_last4 ? <Mono>•••• {r.destination_last4}</Mono> : <span className="text-faint">—</span>) },
                    {
                      key: "hold",
                      header: "Hold / failure",
                      className: "max-w-[220px]",
                      render: (r) =>
                        r.hold_reason ? (
                          <span className="line-clamp-2 text-[12.5px] text-peach-ink" title={r.hold_reason}>
                            {r.hold_reason}
                          </span>
                        ) : r.failure_reason ? (
                          <span className="line-clamp-2 text-[12.5px] text-rose-ink" title={r.failure_reason}>
                            {r.failure_reason}
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        ),
                    },
                    { key: "created", header: "Created", render: (r) => <When at={r.created_at} /> },
                  ]}
                />
                <Pager page={list.page} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
              </>
            )}
          </Loadable>
        </Card>
      </div>

      {open && (
        <PayoutModal
          payout={open}
          canHold={can("admin.payouts.hold")}
          onClose={() => setOpen(null)}
          onRequested={(n) => {
            setNotice(n);
            setOpen(null);
          }}
        />
      )}
    </>
  );
}

function PayoutModal({
  payout: p,
  canHold,
  onClose,
  onRequested,
}: {
  payout: Payout;
  canHold: boolean;
  onClose: () => void;
  onRequested: (n: { tone: "sage" | "lemon"; text: string }) => void;
}) {
  const { guard } = useAdmin();
  const [releasing, setReleasing] = useState(false);
  const b = p.breakdown ?? {};
  const moneyKeys = [...BREAKDOWN_ORDER.filter((k) => k in b), ...Object.keys(b).filter((k) => !BREAKDOWN_ORDER.includes(k) && !NON_MONEY.has(k) && typeof b[k] === "number")];
  const net = typeof b.net_payout === "number" ? b.net_payout : null;
  const onHold = p.status === "ON_HOLD";

  return (
    <>
      <Modal
        open={!releasing}
        onClose={onClose}
        wide
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            Payout <StatusChip status={p.status} />
            {p.livemode ? <Chip tone="ink">Live</Chip> : <Chip tone="lemon">Test</Chip>}
          </span>
        }
        footer={
          onHold ? (
            canHold ? (
              <Button variant="lemon" onClick={() => setReleasing(true)}>
                Request hold release
              </Button>
            ) : (
              <ReadOnlyNote>Releasing a hold needs the payouts hold permission.</ReadOnlyNote>
            )
          ) : undefined
        }
      >
        <div className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Amount minor={p.amount} currency={p.currency} size="lg" />
            <span className="text-[13px] text-muted">{p.automatic ? "Automatic (schedule)" : "Manual"}</span>
          </div>

          {onHold && p.hold_reason && <Notice tone="peach">On hold: {p.hold_reason}</Notice>}
          {p.failure_reason && <Notice tone="peach">Failure: {p.failure_reason}</Notice>}

          <KV
            items={[
              ["Payout id", <IdTag key="id" id={p.id} full />],
              ["Merchant", <EntityLink key="org" type="org" id={p.org_id} />],
              ["Destination", p.destination_last4 ? <Mono key="d">•••• {p.destination_last4}</Mono> : null],
              ["Arrival date", p.arrival_date ? date(p.arrival_date) : null],
              ["Paid at", p.paid_at ? <When key="paid" at={p.paid_at} /> : null],
              ["Bank reference", p.bank_reference ? <Mono key="bank">{p.bank_reference}</Mono> : null],
              ["Ledger transaction", p.ledger_transaction_id ? <EntityLink key="ltx" type="ledger_transaction" id={p.ledger_transaction_id} /> : null],
              ["Created", <When key="c" at={p.created_at} />],
            ]}
          />

          <Panel title="Breakdown">
            {p.breakdown ? (
              <dl className="divide-y divide-line text-[13.5px]">
                {moneyKeys.map((k) => (
                  <div key={k} className="flex items-center justify-between gap-4 py-2">
                    <dt className="text-text-2">{humanize(k)}</dt>
                    <dd>
                      <Amount minor={b[k] as number} currency={p.currency} size="sm" />
                    </dd>
                  </div>
                ))}
                {net !== null && (
                  <div className="flex items-center justify-between gap-4 pt-3">
                    <dt className="font-medium text-text">Net payout</dt>
                    <dd>
                      <Amount minor={net} currency={p.currency} size="md" />
                    </dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="text-[13px] text-muted">No breakdown was recorded for this payout.</p>
            )}
            {(typeof b.balance_transactions === "number" || (typeof b.note === "string" && b.note)) && (
              <p className="mt-3 text-[12px] text-muted">
                {typeof b.balance_transactions === "number" && <>{b.balance_transactions} balance transactions included. </>}
                {typeof b.note === "string" && b.note && <>Note: {b.note}</>}
              </p>
            )}
          </Panel>
        </div>
      </Modal>

      <ReasonDialog
        open={releasing}
        onClose={() => setReleasing(false)}
        title="Request hold release"
        confirmLabel="Submit for approval"
        tone="lemon"
        description={
          <>
            <p>
              This creates a four-eyes approval request to release the hold on this <Amount minor={p.amount} currency={p.currency} size="sm" className="text-[14px]" /> payout.
              Nothing changes until a different approver with the same permission approves it; the payout then returns to pending and is paid on the next run.
            </p>
            <p className="mt-2 text-muted">The request and its reason are audited.</p>
          </>
        }
        onSubmit={async (reason) => {
          try {
            await guard(() =>
              adminApi<Approval>("/approvals", { method: "POST", body: { action: "release_payout_hold", target_type: "payout", target_id: p.id, reason } }),
            );
            onRequested({ tone: "sage", text: "Release requested. It is waiting for a second approver." });
          } catch (e) {
            if (e instanceof ApiError && e.code === "approval_pending") {
              onRequested({ tone: "lemon", text: "A release request for this payout is already awaiting approval." });
              return;
            }
            throw e;
          }
        }}
      />
    </>
  );
}
