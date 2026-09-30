"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApi, qs } from "@/lib/merchant/hooks";
import { date, flag } from "@/lib/format";
import { Button, Card, Chip, Empty, PageHeader, Table } from "@/components/ui";
import { useMerchant } from "@/components/merchant/context";
import { FilterBar, FilterSelect, FlagAvatar, ListSkeleton, Loaded, NoAccess } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { useNewParam } from "@/components/merchant/sales/links";
import { bpsLabel, StateChip } from "@/components/merchant/growth/helpers";
import { MarketplaceUnavailable, OnboardSellerModal, SplitFormula } from "@/components/merchant/growth/SellerModals";
import type { Seller } from "@/components/merchant/growth/types";

const STATUSES = [
  { value: "", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "pending_verification", label: "Pending verification" },
  { value: "restricted", label: "Restricted" },
  { value: "rejected", label: "Rejected" },
];

export default function SellersPage() {
  const { can } = useMerchant();
  const router = useRouter();
  const create = useNewParam();
  const [status, setStatus] = useState("");
  const allowed = can("customers.read");
  const list = useApi<{ data: Seller[] }>(allowed ? `/v1/sellers${qs({ status })}` : null);
  const features = useApi<{ features: Record<string, boolean> }>(allowed ? "/v1/features" : null);

  if (!allowed) return <NoAccess what="sellers" />;
  const canWrite = can("customers.write");
  // Unknown flags don't gate anything server-side, so only an explicit `false` means "off".
  const enabled = features.data?.features.marketplace !== false;

  return (
    <>
      <PageHeader
        title="Sellers"
        subtitle="Businesses you sell for as a marketplace. Each sale is split and the seller's share is paid out from its own balance."
        actions={canWrite && enabled && <Button icon={<Icon name="plus" size={16} />} onClick={create.setOpen}>Onboard seller</Button>}
      />
      {features.data && !enabled ? (
        <Card><MarketplaceUnavailable /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
          <Card className="min-w-0">
            <FilterBar>
              <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUSES} />
            </FilterBar>
            <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton />}>
              {(d) => (
                <Table
                  rows={d.data}
                  rowKey={(s) => s.id}
                  onRowClick={(s) => router.push(`/sellers/${s.id}`)}
                  empty={
                    <Empty
                      title={status ? "No sellers with this status" : "No sellers yet"}
                      icon={<Icon name="store" />}
                      action={!status && canWrite && <Button onClick={create.setOpen} icon={<Icon name="plus" size={16} />}>Onboard your first seller</Button>}
                    >
                      {status ? "Try another status." : "Add the businesses you sell for, then create payment links or checkouts on their behalf."}
                    </Empty>
                  }
                  columns={[
                    {
                      key: "name",
                      header: "Seller",
                      render: (s) => (
                        <span className="flex min-w-0 items-center gap-3">
                          <FlagAvatar country={s.country} size={30} />
                          <span className="min-w-0">
                            <span className="block max-w-[220px] truncate text-text">{s.name}</span>
                            <span className="block max-w-[220px] truncate text-[12px] text-muted">{s.email} · {flag(s.country)} {s.country}</span>
                          </span>
                        </span>
                      ),
                    },
                    { key: "status", header: "Status", render: (s) => <StateChip status={s.status} /> },
                    { key: "commission", header: "Commission", render: (s) => <Chip tone="lemon-soft">{bpsLabel(s.commission_bps)}</Chip> },
                    {
                      key: "payout",
                      header: "Payout account",
                      render: (s) =>
                        s.payout_last4 ? (
                          <span className="whitespace-nowrap text-text-2">{s.payout_currency} ••••{s.payout_last4}</span>
                        ) : (
                          <Chip tone="peach">Missing</Chip>
                        ),
                    },
                    { key: "currency", header: "Currency", render: (s) => <span className="text-text-2">{s.default_currency}</span> },
                    { key: "created", header: "Added", align: "right", render: (s) => <span className="whitespace-nowrap text-muted">{date(s.created_at)}</span> },
                  ]}
                />
              )}
            </Loaded>
          </Card>

          <Card className="min-w-0 self-start">
            <h2 className="mb-1 text-[17px] font-medium tracking-[-0.01em]">How marketplace payments work</h2>
            <p className="mb-4 text-[13px] text-muted">
              We stay the Merchant of Record for every sale. When a checkout names a seller, the net sale is split in the ledger the moment the payment succeeds.
            </p>
            <SplitFormula />
            <ul className="mt-4 space-y-2 text-[12.5px] text-text-2">
              <li className="flex gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-sage-700" /><span>Seller funds are pending until your settlement delay passes, then become available.</span></li>
              <li className="flex gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-sage-700" /><span>Pay a seller out from its detail page once it has a payout account.</span></li>
              <li className="flex gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-sage-700" /><span>Sell for a seller by passing <code className="font-mono text-[11.5px]">seller</code> (and optionally <code className="font-mono text-[11.5px]">application_fee_bps</code>) when you create a checkout session or payment link.</span></li>
            </ul>
          </Card>
        </div>
      )}

      {create.open && canWrite && (
        <OnboardSellerModal
          onClose={create.close}
          onCreated={(s) => {
            create.close();
            router.push(`/sellers/${s.id}`);
          }}
        />
      )}
    </>
  );
}
