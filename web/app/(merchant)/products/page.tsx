"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCursorList, qs } from "@/lib/merchant/hooks";
import type { Product } from "@/lib/merchant/types";
import { Button, Card, Chip, Empty, PageHeader, Segmented, StatusChip, Table } from "@/components/ui";
import { date, titleCase } from "@/lib/format";
import { useMerchant } from "@/components/merchant/context";
import { ListSkeleton, Loaded, NoAccess, Pager } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { ProductCreateModal } from "@/components/merchant/catalog/ProductModals";
import { TAX_CATEGORIES } from "@/components/merchant/catalog/fields";
import { useNewParam } from "@/components/merchant/sales/links";

type StatusFilter = "" | "active" | "draft" | "archived";

export default function ProductsPage() {
  const { can } = useMerchant();
  const router = useRouter();
  const create = useNewParam();
  const [status, setStatus] = useState<StatusFilter>(() => {
    const s = create.params.get("status");
    return s === "active" || s === "draft" || s === "archived" ? s : "";
  });
  const list = useCursorList<Product>(can("products.read") ? `/v1/products${qs({ status })}` : null);

  if (!can("products.read")) return <NoAccess what="products" />;
  const canWrite = can("products.write");
  const typeLabel = (t: string) => (t === "saas" ? "SaaS" : t === "api" ? "API" : titleCase(t));

  return (
    <>
      <PageHeader
        title="Products & prices"
        subtitle="What you sell. Each product can have several prices — one-time, recurring, tiered or usage-based."
        actions={canWrite && <Button icon={<Icon name="plus" size={16} />} onClick={create.setOpen}>Create product</Button>}
      />
      <Card>
        <div className="mb-4 overflow-x-auto">
          <Segmented<StatusFilter>
            value={status}
            onChange={setStatus}
            options={[{ value: "", label: "All" }, { value: "active", label: "Active" }, { value: "draft", label: "Draft" }, { value: "archived", label: "Archived" }]}
          />
        </div>
        <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton />}>
          {() => (
            <>
              <Table
                rows={list.rows}
                rowKey={(p) => p.id}
                onRowClick={(p) => router.push(`/products/${p.id}`)}
                empty={
                  <Empty
                    title={status ? `No ${status} products` : "No products yet"}
                    icon={<Icon name="box" />}
                    action={!status && canWrite && <Button onClick={create.setOpen} icon={<Icon name="plus" size={16} />}>Create product</Button>}
                  >
                    {status ? "Try another status." : "Create a product, add a price, then share a payment link to make your first sale."}
                  </Empty>
                }
                columns={[
                  {
                    key: "name",
                    header: "Product",
                    render: (p) => (
                      <div className="min-w-[200px] max-w-[360px]">
                        <div className="text-text">{p.name}</div>
                        {p.description && <div className="truncate text-[12px] text-muted">{p.description}</div>}
                      </div>
                    ),
                  },
                  { key: "type", header: "Type", render: (p) => <Chip tone="neutral">{typeLabel(p.type)}</Chip> },
                  { key: "tax", header: "Tax category", render: (p) => <span className="whitespace-nowrap text-text-2">{TAX_CATEGORIES.find((t) => t.value === p.tax_category)?.label ?? titleCase(p.tax_category)}</span> },
                  { key: "status", header: "Status", render: (p) => <StatusChip status={p.status} /> },
                  { key: "updated", header: "Updated", align: "right", render: (p) => <span className="whitespace-nowrap text-muted">{date(p.updated_at)}</span> },
                ]}
              />
              <Pager page={list.page} hasPrev={list.hasPrev} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
            </>
          )}
        </Loaded>
      </Card>

      {create.open && canWrite && <ProductCreateModal onClose={create.close} onCreated={(p) => router.push(`/products/${p.id}`)} />}
    </>
  );
}
