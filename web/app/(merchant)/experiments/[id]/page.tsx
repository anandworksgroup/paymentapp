"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { api, type List } from "@/lib/api";
import { useAction, useApi } from "@/lib/merchant/hooks";
import type { PaymentLink } from "@/lib/merchant/types";
import { date, money } from "@/lib/format";
import { Amount, Button, Card, CardHeader, Chip, PageHeader, ShareBars, Stat, Table } from "@/components/ui";
import { useMerchant, useToast } from "@/components/merchant/context";
import { BackLink, ConfirmModal, DetailSkeleton, InfoPopover, KV, Loaded, Mono, NoAccess } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { Count } from "@/components/merchant/billing/bits";
import { priceLabel } from "@/components/merchant/pickers";
import { useCatalogNames } from "@/components/merchant/sales/lookups";
import { payUrl } from "@/components/merchant/sales/links";
import { Meter, StateChip } from "@/components/merchant/growth/helpers";
import type { ExperimentDetail, ExperimentResult } from "@/components/merchant/growth/types";

export default function ExperimentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useMerchant();
  const res = useApi<ExperimentDetail>(can("analytics.read") ? `/v1/experiments/${id}` : null);
  if (!can("analytics.read")) return <NoAccess what="experiments" />;
  return (
    <>
      <BackLink href="/experiments">Experiments</BackLink>
      <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<DetailSkeleton />}>
        {(d) => <Detail d={d} reload={res.reload} />}
      </Loaded>
    </>
  );
}

function Detail({ d, reload }: { d: ExperimentDetail; reload: () => void }) {
  const x = d.experiment;
  const { can, org } = useMerchant();
  const toast = useToast();
  const act = useAction();
  const [confirm, setConfirm] = useState<"start" | "stop" | null>(null);
  const links = useApi<List<PaymentLink>>(can("payments.read") ? "/v1/payment_links?limit=100" : null);
  const link = links.data?.data.find((l) => l.id === x.payment_link_id);
  const priceIds = [...(link ? [link.price_id] : []), ...x.variants.map((v) => v.price_id).filter((p): p is string => !!p)];
  const names = useCatalogNames(priceIds, can("products.read"));
  const basePrice = link ? names.price(link.price_id) : undefined;

  // The API reports revenue without a currency: it is the currency of the variant's price, else the link's price.
  const currencyOf = (r: ExperimentResult) => (r.price_id ? names.price(r.price_id)?.currency : undefined) ?? basePrice?.currency ?? org.default_currency;
  const totalWeight = x.variants.reduce((a, v) => a + v.weight, 0) || 1;
  const visits = d.results.reduce((a, r) => a + r.visits, 0);
  const conversions = d.results.reduce((a, r) => a + r.conversions, 0);
  const best = [...d.results].sort((a, b) => b.revenue_per_visit - a.revenue_per_visit)[0];
  const canWrite = can("checkout.write");

  const run = async (what: "start" | "stop") => {
    const r = await act.run(() => api(`/v1/experiments/${x.id}/${what}`, { method: "POST" }));
    if (r) {
      toast(what === "start" ? "Experiment started" : "Experiment stopped");
      setConfirm(null);
      reload();
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={<Mono>{x.id}</Mono>}
        title={
          <span className="flex flex-wrap items-baseline gap-3">
            <span>{x.name}</span>
            <StateChip status={x.status} className="text-[12px]" />
          </span>
        }
        subtitle={x.started_at ? <>Started {date(x.started_at, true)}{x.stopped_at ? ` · stopped ${date(x.stopped_at, true)}` : " · collecting visits"}</> : <>Draft · created {date(x.created_at)}</>}
        actions={
          canWrite && (
            <>
              {x.status === "draft" && <Button icon={<Icon name="rocket" size={16} />} onClick={() => { act.setError(null); setConfirm("start"); }}>Start experiment</Button>}
              {x.status === "running" && <Button variant="danger" onClick={() => { act.setError(null); setConfirm("stop"); }}>Stop experiment</Button>}
            </>
          )
        }
      />

      {x.hypothesis && (
        <div className="mb-5 rounded-inner bg-lemon-soft px-5 py-4 text-[13.5px] text-lemon-ink">
          <span className="font-medium">Hypothesis:</span> {x.hypothesis}
        </div>
      )}

      <section aria-label="Totals" className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Visits"><Count value={visits} /></Stat>
        <Stat label="Conversions"><Count value={conversions} /></Stat>
        <Stat label="Best revenue per visit" chip={best && best.visits > 0 ? <Chip tone="lemon" className="font-mono">{best.variant}</Chip> : undefined}>
          {best && best.visits > 0 ? <Amount minor={best.revenue_per_visit} currency={currencyOf(best)} size="md" /> : <span className="numeral text-[26px] text-muted">—</span>}
        </Stat>
      </section>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader
              title="Results by variant"
              subtitle="Revenue excludes tax. Lift and p-value compare each variant's conversion rate with the control."
              action={<InfoPopover label="Reading the results">{d.reading_guide}</InfoPopover>}
            />
            <Table
              rows={d.results}
              rowKey={(r) => r.variant}
              columns={[
                {
                  key: "v",
                  header: "Variant",
                  render: (r) => {
                    const i = d.results.indexOf(r);
                    const p = r.price_id ? names.price(r.price_id) : undefined;
                    return (
                      <span className="block min-w-[140px]">
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono text-[13px] text-text">{r.variant}</span>
                          {i === 0 && <Chip tone="neutral">Control</Chip>}
                        </span>
                        <span className="block text-[11.5px] text-muted">
                          {p ? priceLabel(p) : r.price_id ? r.price_id : "Link price"}
                          {r.coupon_code ? ` · ${r.coupon_code}` : ""}
                        </span>
                      </span>
                    );
                  },
                },
                { key: "vis", header: "Visits", align: "right", render: (r) => <span className="numeral text-text-2">{r.visits.toLocaleString()}</span> },
                { key: "conv", header: "Conversions", align: "right", render: (r) => <span className="numeral text-text-2">{r.conversions.toLocaleString()}</span> },
                { key: "rate", header: "Rate", align: "right", render: (r) => <span className="numeral text-text">{r.conversion_rate_pct.toFixed(2)}%</span> },
                { key: "rev", header: "Revenue", align: "right", render: (r) => <Amount minor={r.revenue_excluding_tax} currency={currencyOf(r)} size="sm" /> },
                { key: "rpv", header: "Per visit", align: "right", render: (r) => <span className="whitespace-nowrap text-text-2">{money(r.revenue_per_visit, currencyOf(r))}</span> },
                {
                  key: "lift",
                  header: "Lift",
                  align: "right",
                  render: (r) =>
                    r.lift_vs_control_pct === null ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <Chip tone={r.lift_vs_control_pct > 0 ? "sage" : r.lift_vs_control_pct < 0 ? "peach" : "neutral"}>
                        {r.lift_vs_control_pct > 0 ? "+" : ""}{r.lift_vs_control_pct}%
                      </Chip>
                    ),
                },
                {
                  key: "p",
                  header: "p-value",
                  align: "right",
                  render: (r) =>
                    r.p_value === null || r.p_value === undefined ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <span className="inline-flex flex-col items-end gap-0.5">
                        <span className="numeral text-text-2">{r.p_value < 0.001 ? "< 0.001" : r.p_value.toFixed(3)}</span>
                        {r.p_value < 0.05 ? <Chip tone="lemon">Significant</Chip> : <span className="text-[11px] text-muted">Not yet</span>}
                      </span>
                    ),
                },
              ]}
            />
          </Card>

          {visits > 0 && (
            <Card>
              <CardHeader title="Conversion rate" />
              <ShareBars rows={d.results.map((r) => ({ label: <span className="font-mono">{r.variant}</span>, value: r.conversion_rate_pct, sub: `${r.conversions}/${r.visits}` }))} format={(v) => `${v.toFixed(2)}%`} />
            </Card>
          )}
        </div>

        <div className="order-first grid min-w-0 grid-cols-1 content-start gap-5 lg:grid-cols-2 2xl:order-none 2xl:grid-cols-1">
          <Card>
            <CardHeader title="Traffic split" />
            <ul className="space-y-3">
              {x.variants.map((v, i) => (
                <li key={v.key}>
                  <div className="mb-1.5 flex items-center justify-between text-[13px]">
                    <span className="font-mono text-text">{v.key}{i === 0 ? <span className="ml-1.5 font-sans text-muted">control</span> : null}</span>
                    <span className="numeral text-text-2">{Math.round((v.weight / totalWeight) * 100)}%</span>
                  </div>
                  <Meter value={v.weight} max={totalWeight} tone={i === 0 ? "sage" : i % 2 ? "lemon" : "peach"} label={`${v.key} traffic share`} />
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Setup" />
            <KV
              rows={[
                ["Payment link", <span key="l" className="flex flex-wrap items-center gap-1.5"><span className="font-mono text-[12px]">{x.payment_link_id}</span>{link?.status === "active" && <a href={payUrl(link.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-text-2 underline-offset-4 hover:underline"><Icon name="external" size={12} /> Open</a>}</span>],
                ["Link price", basePrice ? `${names.productName(basePrice.product_id) ?? ""} ${priceLabel(basePrice)}`.trim() : "—"],
                ["Status", <StateChip key="s" status={x.status} />],
                ["Created", date(x.created_at, true)],
              ]}
            />
          </Card>
        </div>
      </div>

      <ConfirmModal
        open={confirm === "start"}
        onClose={() => setConfirm(null)}
        title="Start this experiment?"
        confirmLabel="Start"
        busy={act.busy}
        error={act.error}
        onConfirm={() => run("start")}
      >
        <p>From now on, each visitor to the payment link is assigned one variant at random by weight and sees its price or coupon at checkout.</p>
        <p>Only one experiment can run on a link at a time.</p>
      </ConfirmModal>
      <ConfirmModal
        open={confirm === "stop"}
        onClose={() => setConfirm(null)}
        title="Stop this experiment?"
        confirmLabel="Stop experiment"
        danger
        busy={act.busy}
        error={act.error}
        onConfirm={() => run("stop")}
      >
        <p>New visitors go back to the link&apos;s own price. Results collected so far are kept. A stopped experiment can&apos;t be restarted — create a new one to test again.</p>
      </ConfirmModal>
    </>
  );
}
