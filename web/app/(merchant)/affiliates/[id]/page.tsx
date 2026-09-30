"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction, useApi } from "@/lib/merchant/hooks";
import { date, money } from "@/lib/format";
import { Amount, Button, Card, CardHeader, Chip, PageHeader, Stat, Table } from "@/components/ui";
import { useMerchant, useStepUp, useToast } from "@/components/merchant/context";
import { BackLink, ConfirmModal, CopyButton, DetailSkeleton, InfoPopover, KV, Loaded, Mono, NoAccess } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { Count } from "@/components/merchant/billing/bits";
import { customerLabel, useCustomerNames } from "@/components/merchant/sales/lookups";
import { StateChip } from "@/components/merchant/growth/helpers";
import { commissionLabel } from "@/components/merchant/growth/AffiliateModals";
import type { AffiliateDetail, AffiliatePayout } from "@/components/merchant/growth/types";

export default function AffiliateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useMerchant();
  const res = useApi<AffiliateDetail>(can("customers.read") ? `/v1/affiliates/${id}` : null);
  if (!can("customers.read")) return <NoAccess what="affiliates" />;
  return (
    <>
      <BackLink href="/affiliates">Affiliates</BackLink>
      <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<DetailSkeleton />}>
        {(d) => <Detail d={d} reload={res.reload} />}
      </Loaded>
    </>
  );
}

const STATUS_ORDER = ["pending", "approved", "paid", "reversed"] as const;
const STATUS_HELP: Record<string, string> = {
  pending: "In the hold period. Reversed automatically if the payment is refunded or disputed.",
  approved: "Hold period passed; owed to the affiliate and accrued in your ledger.",
  paid: "Settled to the affiliate.",
  reversed: "Cancelled because the payment was refunded or charged back.",
};

function Detail({ d, reload }: { d: AffiliateDetail; reload: () => void }) {
  const a = d.affiliate;
  const { can } = useMerchant();
  const withStepUp = useStepUp();
  const toast = useToast();
  const pay = useAction();
  const deactivate = useAction();
  const [paying, setPaying] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const names = useCustomerNames(d.commissions.map((c) => c.customer_id), can("customers.read"));

  const currencies = [...new Set(d.totals.map((t) => t.currency))].sort();
  const approved = d.totals.filter((t) => t.status === "approved" && t.amount > 0);
  const total = (currency: string, status: string) => d.totals.find((t) => t.currency === currency && t.status === status);

  return (
    <>
      <PageHeader
        eyebrow={<Mono>{a.id}</Mono>}
        title={
          <span className="flex flex-wrap items-baseline gap-3">
            <span>{a.name}</span>
            <StateChip status={a.status} className="text-[12px]" />
          </span>
        }
        subtitle={<>{a.email} · since {date(a.created_at)}</>}
        actions={
          <>
            {can("customers.write") && a.status === "active" && (
              <Button variant="danger" onClick={() => { deactivate.setError(null); setDeactivating(true); }}>Deactivate</Button>
            )}
            {can("payouts.manage") && (
              <Button icon={<Icon name="send" size={16} />} disabled={approved.length === 0} onClick={() => { pay.setError(null); setPaying(true); }} title={approved.length ? undefined : "No approved commissions to pay"}>
                Pay approved commissions
              </Button>
            )}
          </>
        }
      />

      {a.status !== "active" && (
        <div role="status" className="mb-5 rounded-inner bg-surface-3 px-5 py-4 text-[13.5px] text-text-2">
          This affiliate is inactive: new clicks and referrals aren&apos;t tracked and no new commissions are created. Approved commissions can still be paid.
        </div>
      )}

      <section aria-label="Performance" className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Link clicks"><Count value={d.clicks} /></Stat>
        <Stat label="Referred customers"><Count value={d.referred_customers} /></Stat>
        <Stat label="Conversion" chip={<InfoPopover label="Conversion">Referred customers divided by link clicks. Checkouts created through the API with an affiliate code count as referrals without a click.</InfoPopover>}>
          <span className="numeral text-[26px] text-text">{d.conversion_pct === null ? "—" : `${d.conversion_pct}%`}</span>
        </Stat>
      </section>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Commissions" subtitle="One per eligible payment from a referred customer" />
            <Table
              rows={d.commissions}
              rowKey={(c) => c.id}
              empty={<p className="text-[13px] text-muted">No commissions yet. They appear when a referred customer pays.</p>}
              columns={[
                {
                  key: "amt",
                  header: "Commission",
                  render: (c) => (
                    <span className="block whitespace-nowrap">
                      <Amount minor={c.amount} currency={c.currency} size="sm" />
                      <span className="block text-[11.5px] text-muted">on a {money(c.basis_amount, c.currency)} sale</span>
                    </span>
                  ),
                },
                {
                  key: "cust",
                  header: "Customer",
                  render: (c) => (
                    <Link href={`/customers/${c.customer_id}`} className="block max-w-[200px] truncate text-text-2 underline-offset-4 hover:underline">
                      {customerLabel(names(c.customer_id), c.customer_id)}
                    </Link>
                  ),
                },
                {
                  key: "pay",
                  header: "Payment",
                  render: (c) =>
                    can("payments.read") ? (
                      <Link href={`/payments/${c.payment_id}`} className="font-mono text-[12px] text-text-2 underline-offset-4 hover:underline">{c.payment_id}</Link>
                    ) : (
                      <span className="font-mono text-[12px] text-text-2">{c.payment_id}</span>
                    ),
                },
                {
                  key: "status",
                  header: "Status",
                  render: (c) => (
                    <span className="flex flex-col gap-0.5">
                      <StateChip status={c.status} />
                      {c.status === "pending" && <span className="whitespace-nowrap text-[11.5px] text-muted">Approves {date(c.approve_after)}</span>}
                      {c.status === "paid" && c.paid_at && <span className="whitespace-nowrap text-[11.5px] text-muted">Paid {date(c.paid_at)}</span>}
                      {c.status === "reversed" && c.reversal_reason && <span className="max-w-[160px] truncate text-[11.5px] text-muted">{c.reversal_reason}</span>}
                    </span>
                  ),
                },
                { key: "d", header: "Created", align: "right", render: (c) => <span className="whitespace-nowrap text-muted">{date(c.created_at, true)}</span> },
              ]}
            />
          </Card>
        </div>

        <div className="order-first grid min-w-0 grid-cols-1 content-start gap-5 lg:grid-cols-2 2xl:order-none 2xl:grid-cols-1">
          <Card>
            <CardHeader title="Totals" subtitle="By status and currency" />
            {currencies.length === 0 ? (
              <p className="text-[13px] text-muted">Nothing earned yet.</p>
            ) : (
              <div className="space-y-4">
                {currencies.map((cur) => (
                  <div key={cur} className="grid grid-cols-2 gap-2">
                    {STATUS_ORDER.map((st) => {
                      const t = total(cur, st);
                      return (
                        <div key={st} className={st === "approved" && t?.amount ? "rounded-inner lemon-gradient p-4" : "rounded-inner bg-surface-2 p-4"}>
                          <div className="flex items-center justify-between gap-1 text-[12.5px] text-text-2">
                            <span className="capitalize">{st}</span>
                            <InfoPopover label={st[0].toUpperCase() + st.slice(1)}>{STATUS_HELP[st]}</InfoPopover>
                          </div>
                          <Amount minor={t?.amount ?? 0} currency={cur} size="sm" className="mt-1.5" />
                          <div className="text-[11.5px] text-muted">{t?.count ?? 0} commission{t?.count === 1 ? "" : "s"}</div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Program" />
            <KV
              rows={[
                ["Code", <span key="c" className="flex items-center gap-1.5"><span className="font-mono">{a.code}</span><CopyButton value={a.code} /></span>],
                ["Commission", commissionLabel(a)],
                ["Hold period", `${a.hold_days} days`],
                ["Attribution", "First touch: a customer stays with the first affiliate that referred them."],
                ["Referral link", <span key="l" className="font-mono text-[12px] text-text-2">/pay/&lt;link id&gt;?ref={a.code}</span>],
              ]}
            />
          </Card>
        </div>
      </div>

      <ConfirmModal
        open={paying}
        onClose={() => setPaying(false)}
        title={`Pay ${a.name}?`}
        confirmLabel="Pay commissions"
        busy={pay.busy}
        error={pay.error}
        onConfirm={async () => {
          const r = await pay.run(() => withStepUp(() => api<AffiliatePayout>(`/v1/affiliates/${a.id}/pay`, { method: "POST" })));
          if (r) {
            toast(`Paid ${r.commissions} commission${r.commissions === 1 ? "" : "s"}: ${Object.entries(r.totals).map(([c, v]) => money(v, c, { code: true })).join(", ")}`);
            setPaying(false);
            reload();
          }
        }}
      >
        <p>Every approved commission is settled to the affiliate and marked paid:</p>
        <ul className="space-y-1.5">
          {approved.map((t) => (
            <li key={t.currency} className="flex items-center justify-between rounded-[14px] bg-surface-2 px-4 py-2.5">
              <span className="text-[13px] text-text-2">{t.count} approved <Chip tone="neutral" className="ml-1">{t.currency}</Chip></span>
              <Amount minor={t.amount} currency={t.currency} size="sm" />
            </li>
          ))}
        </ul>
        <p className="text-[12.5px] text-muted">Pending commissions stay in their hold period. You&apos;ll confirm your password because this moves money.</p>
      </ConfirmModal>

      <ConfirmModal
        open={deactivating}
        onClose={() => setDeactivating(false)}
        title={`Deactivate ${a.code}?`}
        confirmLabel="Deactivate"
        danger
        busy={deactivate.busy}
        error={deactivate.error}
        onConfirm={async () => {
          const r = await deactivate.run(() => api(`/v1/affiliates/${a.id}/deactivate`, { method: "POST" }));
          if (r) {
            toast("Affiliate deactivated");
            setDeactivating(false);
            reload();
          }
        }}
      >
        Links with <span className="font-mono">?ref={a.code}</span> stop being tracked and referred customers stop earning new commissions. Existing pending and approved commissions are kept.
      </ConfirmModal>
    </>
  );
}
