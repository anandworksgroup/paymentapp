"use client";

import { useState } from "react";
import type { List } from "@/lib/api";
import { useApi } from "@/lib/merchant/hooks";
import type { Product } from "@/lib/merchant/types";
import { date } from "@/lib/format";
import { Button, Card, Empty, PageHeader, Skeleton } from "@/components/ui";
import { useMerchant } from "@/components/merchant/context";
import { Help, Loaded, Mono, NoAccess } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { useNewParam } from "@/components/merchant/sales/links";
import { StateChip } from "@/components/merchant/growth/helpers";
import { BrandBadge, BrandModal, BrandProductsModal } from "@/components/merchant/growth/BrandModal";
import type { Brand } from "@/components/merchant/growth/types";

export default function BrandsPage() {
  const { can, org } = useMerchant();
  const create = useNewParam();
  const list = useApi<{ data: Brand[] }>(can("products.read") ? "/v1/brands" : null);
  const [editing, setEditing] = useState<Brand | null>(null);
  const [assigning, setAssigning] = useState<Brand | null>(null);
  const products = useApi<List<Product & { brand_id?: string | null }>>(can("products.read") ? "/v1/products?limit=100" : null);
  const productCount = (id: string) => products.data?.data.filter((p) => p.brand_id === id && p.status !== "archived").length;

  if (!can("products.read")) return <NoAccess what="brands" />;
  const canWrite = can("org.manage");

  return (
    <>
      <PageHeader
        title="Brands"
        subtitle="Sell several products under their own name, colour and support contact — all from one account."
        actions={canWrite && <Button icon={<Icon name="plus" size={16} />} onClick={create.setOpen}>New brand</Button>}
      />
      <Loaded
        data={list.data}
        error={list.error}
        onRetry={list.reload}
        skeleton={<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-48 rounded-card" />)}</div>}
      >
        {(d) =>
          d.data.length === 0 ? (
            <Card>
              <Empty title="No brands yet" icon={<Icon name="palette" />} action={canWrite && <Button onClick={create.setOpen} icon={<Icon name="plus" size={16} />}>Create a brand</Button>}>
                Without brands, checkout shows {org.name}. Create a brand, then assign it to products so their checkouts and receipts carry the brand.
              </Empty>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {d.data.map((b) => (
                <Card key={b.id} className="flex flex-col">
                  <div className="flex items-start gap-3">
                    <BrandBadge name={b.name} color={b.color} logo={b.logo_url} size={46} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-[17px] font-medium tracking-[-0.01em] text-text">{b.name}</h2>
                        <StateChip status={b.active ? "active" : "inactive"} />
                      </div>
                      <Mono className="mt-0.5">{b.id}</Mono>
                    </div>
                  </div>
                  <dl className="mt-5 space-y-2 text-[13px]">
                    <Row label="Colour">
                      {b.color ? (
                        <span className="inline-flex items-center gap-2">
                          <span aria-hidden className="h-4 w-4 rounded-full border border-line" style={{ background: b.color }} />
                          <span className="font-mono text-[12px] uppercase">{b.color}</span>
                        </span>
                      ) : null}
                    </Row>
                    <Row label="Support">{b.support_email || null}</Row>
                    <Row label="Website">
                      {b.website ? (
                        <a href={b.website} target="_blank" rel="noopener noreferrer" className="truncate underline-offset-4 hover:underline">{b.website.replace(/^https?:\/\//, "")}</a>
                      ) : null}
                    </Row>
                    <Row label="Products">{productCount(b.id) === undefined ? null : `${productCount(b.id)} product${productCount(b.id) === 1 ? "" : "s"}`}</Row>
                    <Row label="Created">{date(b.created_at)}</Row>
                  </dl>
                  {(canWrite || can("products.write")) && (
                    <div className="mt-auto flex flex-wrap gap-2 pt-5">
                      {canWrite && <Button size="sm" variant="soft" onClick={() => setEditing(b)}>Edit brand</Button>}
                      {can("products.write") && <Button size="sm" variant="ghost" icon={<Icon name="box" size={14} />} onClick={() => setAssigning(b)}>Choose products</Button>}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )
        }
      </Loaded>

      <Card className="mt-5">
        <h2 className="mb-2 text-[15px] font-medium text-text">How brands appear to buyers</h2>
        <Help>
          Use <span className="text-text">Choose products</span> on a brand to assign it (or send <span className="font-mono">&quot;brand&quot;: &quot;brand_…&quot;</span> when you create or update a product through the API).
          When everything in a checkout belongs to one active brand, the checkout, receipt and support contact use that brand; mixed carts use {org.name}.
          The legal seller is always shown as the Merchant of Record, whatever the brand.
        </Help>
      </Card>

      {create.open && canWrite && <BrandModal onClose={create.close} onSaved={() => { create.close(); list.reload(); }} />}
      {editing && <BrandModal brand={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
      {assigning && (
        <BrandProductsModal brand={assigning} brands={list.data?.data ?? []} onClose={() => setAssigning(null)} onSaved={() => { setAssigning(null); products.reload(); }} />
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-text-2">{children ?? <span className="text-faint">—</span>}</dd>
    </div>
  );
}
