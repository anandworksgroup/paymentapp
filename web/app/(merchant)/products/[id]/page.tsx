"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction, useApi } from "@/lib/merchant/hooks";
import type { PaymentLink, Price, Product } from "@/lib/merchant/types";
import { Amount, Button, Card, CardHeader, Chip, ErrorNote, PageHeader, Stat, StatusChip } from "@/components/ui";
import { date, titleCase } from "@/lib/format";
import { useMerchant, useToast } from "@/components/merchant/context";
import { BackLink, ConfirmModal, DetailSkeleton, KV, Loaded, Mono, NoAccess } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { PricesCard } from "@/components/merchant/catalog/PricesCard";
import { PriceModal } from "@/components/merchant/catalog/PriceModal";
import { PricePreview } from "@/components/merchant/catalog/PricePreview";
import { ProductEditModal } from "@/components/merchant/catalog/ProductModals";
import { DELIVERY_TYPES, TAX_CATEGORIES } from "@/components/merchant/catalog/fields";
import { ShareUrl } from "@/components/merchant/sales/Qr";
import { payUrl } from "@/components/merchant/sales/links";

type ProductDetail = {
  product: Product;
  prices: Price[];
  sales: number;
  revenue_by_currency: Record<string, number>;
  subscriptions: number;
  payment_links: PaymentLink[];
};

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useMerchant();
  const res = useApi<ProductDetail>(can("products.read") ? `/v1/products/${id}` : null);
  if (!can("products.read")) return <NoAccess what="products" />;
  return (
    <>
      <BackLink href="/products">Products</BackLink>
      <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<DetailSkeleton />}>
        {(d) => <Detail d={d} reload={res.reload} />}
      </Loaded>
    </>
  );
}

function Detail({ d, reload }: { d: ProductDetail; reload: () => void }) {
  const p = d.product;
  const { can, org } = useMerchant();
  const toast = useToast();
  const canWrite = can("products.write");
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [priceModal, setPriceModal] = useState<{ from?: Price } | null>(null);
  const [previewId, setPreviewId] = useState(() => (d.prices.find((x) => x.active) ?? d.prices[0])?.id ?? "");
  const selectedPreview = d.prices.some((x) => x.id === previewId) ? previewId : d.prices[0]?.id ?? "";
  const revenue = Object.entries(d.revenue_by_currency);

  const setStatus = async (status: "active" | "archived") => {
    const r = await act.run(() => api(`/v1/products/${p.id}`, { method: "PATCH", body: { status } }));
    if (r) {
      toast(status === "archived" ? "Product archived" : "Product activated");
      setArchiving(false);
      reload();
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={<Mono>{p.id}</Mono>}
        title={
          <span className="flex flex-wrap items-baseline gap-3">
            {p.name}
            <StatusChip status={p.status} className="text-[12.5px]" />
          </span>
        }
        subtitle={p.description || "No description"}
        actions={
          canWrite && (
            <>
              <Button variant="soft" onClick={() => setEditing(true)}>Edit</Button>
              {p.status === "archived" || p.status === "draft" ? (
                <Button variant="soft" loading={act.busy && !archiving} onClick={() => setStatus("active")}>Activate</Button>
              ) : (
                <Button variant="soft" onClick={() => { act.setError(null); setArchiving(true); }}>Archive</Button>
              )}
              <Button icon={<Icon name="plus" size={16} />} onClick={() => setPriceModal({})}>Add price</Button>
            </>
          )
        }
      />
      {!archiving && act.error ? <div aria-live="assertive" className="mb-4"><ErrorNote error={act.error} /></div> : null}

      <section aria-label="Product figures" className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Sales (orders)"><span className="numeral text-[34px]">{d.sales.toLocaleString()}</span></Stat>
        <Stat label="Active subscriptions"><span className="numeral text-[34px]">{d.subscriptions.toLocaleString()}</span></Stat>
        <Stat label="Revenue (net of discounts, excl. tax)">
          {revenue.length ? (
            <div className="flex flex-col gap-1">
              {revenue.map(([cur, minor]) => <Amount key={cur} minor={minor} currency={cur} size="md" />)}
            </div>
          ) : (
            <span className="text-[14px] text-muted">No sales yet</span>
          )}
        </Stat>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <PricesCard
            prices={d.prices}
            canWrite={canWrite}
            canLink={can("checkout.write") && p.status === "active"}
            onAdd={() => setPriceModal({})}
            onVersion={(from) => setPriceModal({ from })}
            onPreview={(x) => { setPreviewId(x.id); document.getElementById("price-preview")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
            onChanged={reload}
          />

          {d.payment_links.length > 0 && (
            <Card>
              <CardHeader title="Payment links" subtitle="Links selling one of this product's prices" />
              <ul className="space-y-2">
                {d.payment_links.map((l) => (
                  <li key={l.id} className="flex flex-col gap-2 rounded-inner bg-surface-2 p-3 sm:flex-row sm:items-center">
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusChip status={l.status} />
                      <span className="whitespace-nowrap text-[12px] text-muted">{l.visits} visits · {l.completions} paid</span>
                    </div>
                    <div className="min-w-0 flex-1"><ShareUrl url={payUrl(l.id)} /></div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <div id="price-preview" className="scroll-mt-24" />
            <CardHeader title="Price preview" subtitle="What the server charges at each quantity" />
            <PricePreview prices={d.prices} selected={selectedPreview} onSelect={setPreviewId} />
          </Card>

          <Card>
            <CardHeader title="Details" />
            <KV
              rows={[
                ["Type", p.type === "saas" ? "SaaS" : p.type === "api" ? "API" : titleCase(p.type)],
                ["Tax category", TAX_CATEGORIES.find((t) => t.value === p.tax_category)?.label ?? p.tax_category],
                ["Delivery", DELIVERY_TYPES.find((t) => t.value === p.delivery_type)?.label ?? titleCase(p.delivery_type)],
                ["Features", p.features_csv ? <span className="flex flex-wrap gap-1">{p.features_csv.split(",").filter(Boolean).map((f) => <Chip key={f} tone="neutral">{f.trim()}</Chip>)}</span> : null],
                ["Created", date(p.created_at, true)],
                ["Updated", date(p.updated_at, true)],
              ]}
            />
          </Card>
        </div>
      </div>

      {editing && <ProductEditModal product={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {priceModal && (
        <PriceModal
          product={p}
          from={priceModal.from}
          defaultCurrency={d.prices[0]?.currency ?? org.default_currency}
          onClose={() => setPriceModal(null)}
          onDone={(np) => { setPriceModal(null); setPreviewId(np.id); reload(); }}
        />
      )}
      <ConfirmModal
        open={archiving}
        onClose={() => setArchiving(false)}
        title={`Archive ${p.name}?`}
        confirmLabel="Archive product"
        danger
        busy={act.busy}
        error={act.error}
        onConfirm={() => setStatus("archived")}
      >
        <p>Archived products can&apos;t be bought through new checkouts or payment links. They stay visible on past orders, invoices and reports.</p>
        <p>Existing subscriptions are not cancelled. You can activate the product again at any time.</p>
      </ConfirmModal>
    </>
  );
}
