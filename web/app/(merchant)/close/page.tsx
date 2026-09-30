"use client";

import { useState } from "react";
import { api, ApiError, type List } from "@/lib/api";
import { date } from "@/lib/format";
import { qs, useAction, useApi } from "@/lib/merchant/hooks";
import { Button, Card, CardHeader, Chip, Empty, PageHeader, Skeleton, Table } from "@/components/ui";
import { useMerchant, useStepUp, useToast } from "@/components/merchant/context";
import { ConfirmModal, FilterSelect, Help, ListSkeleton, Loaded, Mono, NoAccess } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { CloseChecklist } from "@/components/merchant/ops/CloseChecklist";
import { monthLabel, recentMonths } from "@/components/merchant/ops/shared";
import type { AccountingPeriod, ClosePreview, PeriodVerification } from "@/components/merchant/ops/types";

export default function ClosePage() {
  const { can, live } = useMerchant();
  const allowed = can("ledger.read");
  const canClose = can("payouts.manage");
  const withStepUp = useStepUp();
  const toast = useToast();
  const [months] = useState(() => recentMonths(13));
  const [period, setPeriod] = useState(months[1]); // last completed month
  const preview = useApi<ClosePreview>(allowed ? `/v1/accounting_periods/preview${qs({ period })}` : null);
  const periods = useApi<List<AccountingPeriod>>(allowed ? "/v1/accounting_periods" : null);
  const [confirm, setConfirm] = useState(false);
  const close = useAction();
  const [verified, setVerified] = useState<Record<string, PeriodVerification | { error: unknown }>>({});
  const [verifying, setVerifying] = useState<string | null>(null);

  if (!allowed) return <NoAccess what="month-end close" />;

  const closedSet = new Set(periods.data?.data.map((p) => p.period) ?? []);

  const doClose = async () => {
    const done = await close.run(() => withStepUp(() => api<AccountingPeriod>("/v1/accounting_periods", { body: { period } })));
    if (done) {
      toast(`${monthLabel(period)} is closed`);
      setConfirm(false);
      preview.reload();
      periods.reload();
    } else {
      // A blocked close changes nothing; refresh the checklist so it shows what's still open.
      preview.reload();
    }
  };

  const verify = async (p: AccountingPeriod) => {
    setVerifying(p.id);
    try {
      const v = await api<PeriodVerification>(`/v1/accounting_periods/${p.id}/verify`);
      setVerified((s) => ({ ...s, [p.id]: v }));
      toast(v.unchanged ? `${monthLabel(p.period)} is unchanged since it was closed` : `${monthLabel(p.period)} no longer matches its snapshot`, v.unchanged ? "ok" : "error");
    } catch (e) {
      setVerified((s) => ({ ...s, [p.id]: { error: e } }));
    } finally {
      setVerifying(null);
    }
  };

  const blocked = close.error instanceof ApiError && close.error.code === "close_blocked" ? (close.error.details as { key: string; detail: string }[] | undefined) : undefined;

  return (
    <>
      <PageHeader
        title="Month-end close"
        subtitle={`Lock a month's ${live ? "live" : "test"} numbers once everything in it has settled. The closing balances are sealed with a SHA-256 fingerprint you can re-check at any time.`}
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader
            title="Close checklist"
            subtitle="Required checks must pass before the month can be closed."
            action={
              <FilterSelect
                label="Month"
                value={period}
                onChange={(v) => { setPeriod(v); close.setError(null); }}
                options={months.map((m, i) => ({ value: m, label: `${monthLabel(m)}${i === 0 ? " (in progress)" : ""}${closedSet.has(m) ? " · closed" : ""}` }))}
              />
            }
          />
          <Loaded data={preview.data} error={preview.error} onRetry={preview.reload} skeleton={<ListSkeleton rows={7} />}>
            {(p) => (
              <>
                <CloseChecklist checks={p.checks} />
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-inner bg-surface-2 px-4 py-4">
                  <div className="text-[13.5px]">
                    {p.already_closed ? (
                      <span className="inline-flex items-center gap-2 text-text"><Chip tone="sage">Closed</Chip> {monthLabel(p.period)} is already closed.</span>
                    ) : p.can_close ? (
                      <span className="text-text">{monthLabel(p.period)} is ready to close.</span>
                    ) : (
                      <span className="text-text-2">Resolve the required checks above, then close.</span>
                    )}
                  </div>
                  {!p.already_closed && canClose && (
                    <Button disabled={!p.can_close || preview.loading} onClick={() => { close.setError(null); setConfirm(true); }} icon={<Icon name="lock" size={16} />}>
                      Close {monthLabel(p.period)}
                    </Button>
                  )}
                </div>
                {!canClose && !p.already_closed && <div className="mt-3"><Help>Closing a month needs the payouts-management permission (owners, admins and finance). You can still review the checklist.</Help></div>}
              </>
            )}
          </Loaded>
        </Card>

        <Card className="lemon-gradient">
          <CardHeader title="How closing works" />
          <ul className="space-y-3 text-[13px] leading-relaxed text-text-2">
            <li className="flex gap-2"><Icon name="lock" size={16} className="mt-0.5 shrink-0" /> Closing stores every closing balance and the month&apos;s statement totals, plus their SHA-256 fingerprint. It can&apos;t be undone.</li>
            <li className="flex gap-2"><Icon name="book" size={16} className="mt-0.5 shrink-0" /> The ledger is append-only and every posting is dated when it happens, so nothing can land inside a closed month.</li>
            <li className="flex gap-2"><Icon name="refund" size={16} className="mt-0.5 shrink-0" /> <span><b className="font-medium text-text">Corrections post in the current open month.</b> A late refund or adjustment for a closed month appears in this month&apos;s statement, never by editing the closed one.</span></li>
            <li className="flex gap-2"><Icon name="shield" size={16} className="mt-0.5 shrink-0" /> <span>Verify recomputes the snapshot from the ledger and compares fingerprints. A match proves the closed numbers never changed.</span></li>
          </ul>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Closed months" subtitle={`${live ? "Live" : "Test"} mode · newest first`} />
        <Loaded data={periods.data} error={periods.error} onRetry={periods.reload} skeleton={<Skeleton className="h-32" />}>
          {(l) => (
            <Table
              rows={l.data}
              rowKey={(p) => p.id}
              empty={<Empty title="No closed months yet" icon={<Icon name="calendar" />}>Close your first month above once its checklist passes.</Empty>}
              columns={[
                { key: "period", header: "Month", render: (p) => <span className="whitespace-nowrap text-text">{monthLabel(p.period)}</span> },
                { key: "closed", header: "Closed", render: (p) => <span className="whitespace-nowrap text-muted">{date(p.closed_at, true)}</span> },
                { key: "sha", header: "SHA-256", render: (p) => <Mono className="max-w-[260px]">{p.snapshot_sha256}</Mono> },
                {
                  key: "verify", header: "Integrity", align: "right",
                  render: (p) => {
                    const v = verified[p.id];
                    return (
                      <span className="inline-flex flex-wrap items-center justify-end gap-2">
                        {v && "unchanged" in v && (v.unchanged ? <Chip tone="sage"><Icon name="check" size={13} /> Unchanged</Chip> : <span title={`Recomputed ${v.recomputed_sha256}`}><Chip tone="rose"><Icon name="alert" size={13} /> Doesn&apos;t match</Chip></span>)}
                        {v && "error" in v && <Chip tone="rose">Couldn&apos;t verify</Chip>}
                        <Button size="sm" variant="soft" loading={verifying === p.id} onClick={() => verify(p)} icon={<Icon name="shield" size={14} />}>Verify</Button>
                      </span>
                    );
                  },
                },
              ]}
            />
          )}
        </Loaded>
        {Object.values(verified).some((v) => "unchanged" in v && !v.unchanged) && (
          <div className="mt-4">
            <Help>A month that doesn&apos;t match was recomputed differently from what was sealed. Contact support with the month and both fingerprints (hover the chip) so we can investigate.</Help>
          </div>
        )}
      </Card>

      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Close ${monthLabel(period)}?`}
        confirmLabel="Close month"
        busy={close.busy}
        onConfirm={doClose}
        error={blocked ? null : close.error}
      >
        <p>This seals the month&apos;s closing balances and statement with a SHA-256 fingerprint. It can&apos;t be reopened; anything that comes up later is corrected in the current open month.</p>
        <p className="text-[12.5px] text-muted">You&apos;ll be asked to confirm your password.</p>
        {blocked && (
          <div role="alert" className="rounded-inner bg-rose-soft px-4 py-3 text-[13px] text-rose-ink">
            <div className="mb-1 font-medium">The month can&apos;t be closed yet:</div>
            <ul className="list-disc space-y-0.5 pl-5">{blocked.map((b) => <li key={b.key}>{b.detail || b.key}</li>)}</ul>
          </div>
        )}
      </ConfirmModal>
    </>
  );
}
