"use client";

import { useState } from "react";
import { Amount, Button, Card, Chip, Empty, PageHeader, Segmented, StatusChip, Table } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { adminApi, qs, usePagedList } from "@/components/admin/data";
import { ConfirmDialog, EntityLink, humanize, IdTag, Loadable, Mono, Notice, Pager, Person, ReadOnlyNote, ReasonDialog, SkeletonRows, When } from "@/components/admin/kit";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import type { ReconException, ReconRun } from "@/components/admin/types";
import { money } from "@/lib/format";

type StatusFilter = "open" | "resolved" | "all";

export default function ReconciliationPage() {
  return (
    <Guard perm="admin.recon.read">
      <Reconciliation />
    </Guard>
  );
}

function Reconciliation() {
  const { can, guard } = useAdmin();
  const canResolve = can("admin.recon.resolve");
  const [confirmRun, setConfirmRun] = useState(false);
  const [lastRun, setLastRun] = useState<ReconRun | null>(null);
  const [status, setStatus] = useState<StatusFilter>("open");
  const [resolving, setResolving] = useState<ReconException | null>(null);

  const runs = usePagedList<ReconRun>("/reconciliation/runs", 10);
  const exceptions = usePagedList<ReconException>(`/reconciliation/exceptions${qs({ status: status === "all" ? "" : status })}`, 25);

  return (
    <>
      <PageHeader
        eyebrow="Finance · provider reconciliation"
        title="Reconciliation"
        subtitle="Compares platform payment attempts and refunds with the providers' own records. Mismatches become exceptions for finance to resolve."
        actions={
          canResolve ? (
            <Button onClick={() => setConfirmRun(true)}>Run reconciliation now</Button>
          ) : (
            <ReadOnlyNote>Read-only: running reconciliation and resolving exceptions need the recon resolve permission.</ReadOnlyNote>
          )
        }
      />

      <div className="space-y-5">
        {lastRun && (
          <Notice tone={lastRun.exceptions > 0 ? "peach" : "sage"}>
            Run <Mono>{lastRun.id}</Mono> finished: {lastRun.matched.toLocaleString("en-US")} matched,{" "}
            {lastRun.exceptions === 0 ? "no new exceptions." : `${lastRun.exceptions.toLocaleString("en-US")} exception${lastRun.exceptions === 1 ? "" : "s"} raised for review.`}
          </Notice>
        )}

        <Card>
          <CardHeader
            title="Exceptions"
            subtitle="Differences between what the platform expected and what the provider reported."
            action={
              <Segmented<StatusFilter>
                value={status}
                onChange={setStatus}
                options={[
                  { value: "open", label: "Open" },
                  { value: "resolved", label: "Resolved" },
                  { value: "all", label: "All" },
                ]}
              />
            }
          />
          <Loadable q={exceptions} skeleton={<SkeletonRows rows={6} />}>
            {() => (
              <>
                <Table
                  rows={exceptions.rows}
                  rowKey={(r) => r.id}
                  empty={
                    status === "open" ? (
                      <Empty title="All transactions matched">There are no open reconciliation exceptions.</Empty>
                    ) : (
                      <Empty title="No exceptions">Nothing to show for this filter.</Empty>
                    )
                  }
                  columns={[
                    {
                      key: "type",
                      header: "Type",
                      render: (r) => (
                        <div>
                          <div className="font-medium text-text">{humanize(r.type)}</div>
                          <IdTag id={r.id} />
                        </div>
                      ),
                    },
                    { key: "provider", header: "Provider", render: (r) => (r.provider_id ? <Mono>{r.provider_id}</Mono> : <span className="text-faint">—</span>) },
                    { key: "org", header: "Merchant", render: (r) => <EntityLink type="org" id={r.org_id} /> },
                    {
                      key: "refs",
                      header: "References",
                      render: (r) => (
                        <div className="space-y-0.5 text-[12px]">
                          <div>
                            <span className="text-muted">Internal </span>
                            {r.internal_reference ? <EntityLink id={r.internal_reference} /> : <span className="text-faint">—</span>}
                          </div>
                          <div>
                            <span className="text-muted">External </span>
                            {r.external_reference ? <Mono>{r.external_reference}</Mono> : <span className="text-faint">—</span>}
                          </div>
                        </div>
                      ),
                    },
                    { key: "amounts", header: "Expected / actual", align: "right", render: (r) => <ExpectedActual r={r} /> },
                    {
                      key: "details",
                      header: "Details",
                      className: "max-w-[280px]",
                      render: (r) => (
                        <div className="text-[12.5px] text-text-2">
                          <p className="line-clamp-3" title={r.details}>
                            {r.details}
                          </p>
                          {r.status === "resolved" && (
                            <p className="mt-1.5 text-[12px] text-muted">
                              Resolved by <Person id={r.resolved_by} /> {r.resolved_at && <When at={r.resolved_at} />}
                              {r.resolution && <span className="mt-0.5 block text-text-2">“{r.resolution}”</span>}
                            </p>
                          )}
                        </div>
                      ),
                    },
                    { key: "status", header: "Status", render: (r) => <StatusChip status={r.status} /> },
                    { key: "created", header: "Raised", render: (r) => <When at={r.created_at} /> },
                    {
                      key: "action",
                      header: "",
                      align: "right",
                      render: (r) =>
                        r.status === "open" && canResolve ? (
                          <Button size="sm" variant="soft" onClick={() => setResolving(r)}>
                            Resolve
                          </Button>
                        ) : null,
                    },
                  ]}
                />
                <Pager page={exceptions.page} hasMore={exceptions.hasMore} onPrev={exceptions.prev} onNext={exceptions.next} loading={exceptions.loading} />
              </>
            )}
          </Loadable>
        </Card>

        <Card>
          <CardHeader title="Runs" subtitle="Scheduled and manual reconciliation runs, newest first." />
          <Loadable q={runs} skeleton={<SkeletonRows rows={4} />}>
            {() => (
              <>
                <Table
                  rows={runs.rows}
                  rowKey={(r) => r.id}
                  empty={<Empty title="No runs yet">Reconciliation runs appear here once the scheduler or a staff member starts one.</Empty>}
                  columns={[
                    { key: "id", header: "Run", render: (r) => <IdTag id={r.id} /> },
                    { key: "scope", header: "Scope", render: (r) => <Chip tone="neutral">{humanize(r.scope)}</Chip> },
                    { key: "matched", header: "Matched", align: "right", render: (r) => <span className="numeral text-text">{r.matched.toLocaleString("en-US")}</span> },
                    {
                      key: "exceptions",
                      header: "Exceptions",
                      align: "right",
                      render: (r) => (r.exceptions > 0 ? <Chip tone="peach">{r.exceptions.toLocaleString("en-US")}</Chip> : <Chip tone="sage">0</Chip>),
                    },
                    { key: "by", header: "Triggered by", render: (r) => <Person id={r.triggered_by} /> },
                    { key: "done", header: "Completed", render: (r) => <When at={r.completed_at} /> },
                  ]}
                />
                <Pager page={runs.page} hasMore={runs.hasMore} onPrev={runs.prev} onNext={runs.next} loading={runs.loading} />
              </>
            )}
          </Loadable>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmRun}
        onClose={() => setConfirmRun(false)}
        title="Run reconciliation now?"
        confirmLabel="Run now"
        onConfirm={async () => {
          const run = await guard(() => adminApi<ReconRun>("/reconciliation/run", { method: "POST" }));
          setLastRun(run);
          runs.reload();
          exceptions.reload();
        }}
      >
        <p>
          This compares all succeeded payment attempts and refunds with the providers&apos; records and raises an exception for each mismatch. It does not move money or
          change any balance.
        </p>
        <p className="text-muted">The run is recorded with your name and time.</p>
      </ConfirmDialog>

      <ReasonDialog
        open={!!resolving}
        onClose={() => setResolving(null)}
        title="Resolve exception"
        label="Resolution"
        placeholder="How was this settled? For example the ledger adjustment id or the provider ticket reference."
        minLength={5}
        confirmLabel="Mark resolved"
        description={
          resolving && (
            <>
              <p>
                <span className="font-medium text-text">{humanize(resolving.type)}</span>
                {resolving.provider_id && (
                  <>
                    {" "}
                    at <Mono>{resolving.provider_id}</Mono>
                  </>
                )}
                . {resolving.details}
              </p>
              <p className="mt-2 text-muted">Resolving closes the exception; it does not post any ledger entry. Record the adjustment or reference that settled it. This action is audited.</p>
            </>
          )
        }
        onSubmit={async (resolution) => {
          if (!resolving) return;
          await guard(() => adminApi<ReconException>(`/reconciliation/exceptions/${resolving.id}/resolve`, { method: "POST", body: { resolution } }));
          exceptions.reload();
        }}
      />
    </>
  );
}

function ExpectedActual({ r }: { r: ReconException }) {
  if (r.expected_amount === null && r.actual_amount === null) return <span className="text-faint">—</span>;
  const cur = r.currency ?? "USD";
  const diff = r.expected_amount !== null && r.actual_amount !== null ? r.actual_amount - r.expected_amount : null;
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="text-[12px] text-muted">
        Expected <Amount minor={r.expected_amount} currency={cur} size="sm" className="text-[14px]" />
      </span>
      <span className="text-[12px] text-muted">
        Actual <Amount minor={r.actual_amount} currency={cur} size="sm" className="text-[14px]" />
      </span>
      {diff !== null && diff !== 0 && (
        <Chip tone="peach">
          Difference {diff > 0 ? "+" : "−"}
          {money(Math.abs(diff), cur, { code: true })}
        </Chip>
      )}
    </div>
  );
}
