"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAction, useCursorList } from "@/lib/merchant/hooks";
import type { Coupon } from "@/lib/merchant/types";
import { Button, Card, Chip, Empty, PageHeader, StatusChip, Table } from "@/components/ui";
import { date, money } from "@/lib/format";
import { useMerchant, useToast } from "@/components/merchant/context";
import { ConfirmModal, ListSkeleton, Loaded, NoAccess, Pager } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { CouponCreateModal } from "@/components/merchant/catalog/CouponCreateModal";
import { useNewParam } from "@/components/merchant/sales/links";

function discount(c: Coupon) {
  if (c.percent_off_bps) return `${(c.percent_off_bps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}% off`;
  if (c.amount_off && c.currency) return `${money(c.amount_off, c.currency, { code: true })} off`;
  return "—";
}

function duration(c: Coupon) {
  if (c.duration === "repeating") return c.duration_in_months ? `${c.duration_in_months} months` : "Repeating";
  return c.duration === "forever" ? "Forever" : "Once";
}

export default function CouponsPage() {
  const { can } = useMerchant();
  const toast = useToast();
  const create = useNewParam();
  const list = useCursorList<Coupon>(can("products.read") ? "/v1/coupons" : null);
  const act = useAction();
  const [deactivating, setDeactivating] = useState<Coupon | null>(null);

  if (!can("products.read")) return <NoAccess what="coupons" />;
  const canWrite = can("coupons.write");

  return (
    <>
      <PageHeader
        title="Coupons"
        subtitle="Discounts customers can enter at checkout, or that apply automatically when they qualify."
        actions={canWrite && <Button icon={<Icon name="plus" size={16} />} onClick={create.setOpen}>Create coupon</Button>}
      />
      <Card>
        <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton />}>
          {() => (
            <>
              <Table
                rows={list.rows}
                rowKey={(c) => c.id}
                empty={
                  <Empty title="No coupons yet" icon={<Icon name="tag" />} action={canWrite && <Button onClick={create.setOpen}>Create coupon</Button>}>
                    Create a percentage or fixed-amount discount, limit it by country or redemptions, and share the code.
                  </Empty>
                }
                columns={[
                  {
                    key: "code",
                    header: "Code",
                    render: (c) => (
                      <div>
                        <div className="font-mono text-[13px] text-text">{c.code}</div>
                        {c.name && <div className="max-w-[200px] truncate text-[12px] text-muted">{c.name}</div>}
                      </div>
                    ),
                  },
                  { key: "off", header: "Discount", render: (c) => <span className="whitespace-nowrap text-text">{discount(c)}</span> },
                  { key: "dur", header: "Duration", render: (c) => <span className="whitespace-nowrap text-text-2">{duration(c)}</span> },
                  {
                    key: "red",
                    header: "Redeemed",
                    render: (c) => (
                      <span className="numeral whitespace-nowrap text-text-2">
                        {c.times_redeemed.toLocaleString()} <span className="text-muted">/ {c.max_redemptions ? c.max_redemptions.toLocaleString() : "∞"}</span>
                      </span>
                    ),
                  },
                  { key: "countries", header: "Countries", render: (c) => <span className="whitespace-nowrap text-text-2">{c.countries_csv ? c.countries_csv.split(",").join(", ") : "All"}</span> },
                  {
                    key: "rules",
                    header: "Rules",
                    render: (c) => (
                      <span className="flex flex-wrap gap-1">
                        {c.auto_apply && <Chip tone="lemon">Auto-apply</Chip>}
                        {c.first_time_only && <Chip tone="sky">First purchase</Chip>}
                        {c.expires_at && <Chip tone="neutral">Ends {date(c.expires_at)}</Chip>}
                        {!c.auto_apply && !c.first_time_only && !c.expires_at && <span className="text-faint">—</span>}
                      </span>
                    ),
                  },
                  { key: "status", header: "Status", render: (c) => <StatusChip status={c.active ? "active" : "inactive"} /> },
                  {
                    key: "actions",
                    header: <span className="sr-only">Actions</span>,
                    align: "right",
                    render: (c) =>
                      canWrite && c.active ? (
                        <Button size="sm" variant="ghost" onClick={() => { act.setError(null); setDeactivating(c); }}>Deactivate</Button>
                      ) : null,
                  },
                ]}
              />
              <Pager page={list.page} hasPrev={list.hasPrev} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
            </>
          )}
        </Loaded>
      </Card>

      {create.open && canWrite && <CouponCreateModal onClose={create.close} onCreated={() => { create.close(); list.reload(); }} />}

      <ConfirmModal
        open={!!deactivating}
        onClose={() => setDeactivating(null)}
        title={`Deactivate ${deactivating?.code ?? "coupon"}?`}
        confirmLabel="Deactivate"
        danger
        busy={act.busy}
        error={act.error}
        onConfirm={async () => {
          if (!deactivating) return;
          const r = await act.run(() => api(`/v1/coupons/${deactivating.id}/deactivate`, { method: "POST" }));
          if (r) {
            toast("Coupon deactivated");
            setDeactivating(null);
            list.reload();
          }
        }}
      >
        New checkouts won&apos;t accept this code. Discounts already applied to orders and subscriptions are not changed.
      </ConfirmModal>
    </>
  );
}
