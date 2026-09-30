"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction, useCursorList } from "@/lib/merchant/hooks";
import type { PaymentLink } from "@/lib/merchant/types";
import { Button, Card, Empty, PageHeader, StatusChip, Table } from "@/components/ui";
import { date } from "@/lib/format";
import { useMerchant, useToast } from "@/components/merchant/context";
import { ConfirmModal, CopyButton, ListSkeleton, Loaded, NoAccess, Pager } from "@/components/merchant/common";
import { priceLabel } from "@/components/merchant/pickers";
import { Icon } from "@/components/merchant/icons";
import { QrModal } from "@/components/merchant/sales/Qr";
import { PaymentLinkCreateModal } from "@/components/merchant/sales/PaymentLinkCreateModal";
import { useCatalogNames } from "@/components/merchant/sales/lookups";
import { payUrl, useNewParam } from "@/components/merchant/sales/links";

export default function PaymentLinksPage() {
  const { can } = useMerchant();
  const toast = useToast();
  const create = useNewParam();
  const list = useCursorList<PaymentLink>(can("payments.read") ? "/v1/payment_links" : null);
  const names = useCatalogNames(list.rows.map((l) => l.price_id), can("products.read"));
  const [qr, setQr] = useState<string | null>(null);
  const [disabling, setDisabling] = useState<PaymentLink | null>(null);
  const act = useAction();

  if (!can("payments.read")) return <NoAccess what="payment links" />;
  const canWrite = can("checkout.write");

  return (
    <>
      <PageHeader
        title="Payment links"
        subtitle="A shareable page that sells one price — no code needed. Share the URL or its QR code."
        actions={canWrite && <Button icon={<Icon name="plus" size={16} />} onClick={create.setOpen}>Create link</Button>}
      />
      <Card>
        <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton />}>
          {() => (
            <>
              <Table
                rows={list.rows}
                rowKey={(l) => l.id}
                empty={
                  <Empty
                    title="No payment links yet"
                    icon={<Icon name="link" />}
                    action={canWrite && <Button onClick={create.setOpen} icon={<Icon name="plus" size={16} />}>Create your first link</Button>}
                  >
                    Pick a price, get a URL and QR code, and pay it with a test card to see your first order.
                  </Empty>
                }
                columns={[
                  {
                    key: "product",
                    header: "Product",
                    render: (l) => {
                      const p = names.price(l.price_id);
                      return (
                        <div className="min-w-[180px]">
                          <div className="text-text">
                            {p ? <Link href={`/products/${p.product_id}`} className="underline-offset-4 hover:underline">{names.productName(p.product_id) ?? p.product_id}</Link> : <span className="font-mono text-[12px]">{l.price_id}</span>}
                          </div>
                          <div className="text-[12px] text-muted">{p ? priceLabel(p) : names.loading ? "Loading price…" : "Price details unavailable"}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</div>
                        </div>
                      );
                    },
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (l) => (
                      <div>
                        <StatusChip status={l.status} />
                        {l.expires_at && <div className="mt-1 whitespace-nowrap text-[11.5px] text-muted">Expires {date(l.expires_at)}</div>}
                      </div>
                    ),
                  },
                  {
                    key: "perf",
                    header: "Visits / paid",
                    render: (l) => (
                      <span className="numeral whitespace-nowrap text-text-2">
                        {l.visits.toLocaleString()} <span className="text-muted">/</span> {l.completions.toLocaleString()}
                      </span>
                    ),
                  },
                  {
                    key: "url",
                    header: "Link",
                    render: (l) => (
                      <div className="flex items-center gap-1.5">
                        <a href={payUrl(l.id)} target="_blank" rel="noreferrer" className="max-w-[180px] truncate font-mono text-[12px] text-text-2 underline-offset-4 hover:underline">
                          /pay/{l.id}
                        </a>
                        <CopyButton value={payUrl(l.id)} label="Copy" />
                        <button
                          type="button"
                          onClick={() => setQr(payUrl(l.id))}
                          aria-label={`Show QR code for ${l.id}`}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-text-2 hover:bg-surface-3 hover:text-text"
                        >
                          <Icon name="qr" size={14} />
                        </button>
                      </div>
                    ),
                  },
                  { key: "created", header: "Created", render: (l) => <span className="whitespace-nowrap text-muted">{date(l.created_at)}</span> },
                  {
                    key: "actions",
                    header: <span className="sr-only">Actions</span>,
                    align: "right",
                    render: (l) =>
                      canWrite && l.status === "active" ? (
                        <Button size="sm" variant="ghost" onClick={() => { act.setError(null); setDisabling(l); }}>Disable</Button>
                      ) : null,
                  },
                ]}
              />
              <Pager page={list.page} hasPrev={list.hasPrev} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
            </>
          )}
        </Loaded>
      </Card>

      <QrModal url={qr} title="Payment link QR code" onClose={() => setQr(null)} />

      {create.open && canWrite && (
        <PaymentLinkCreateModal initialPrice={create.params.get("price") ?? ""} onClose={create.close} onCreated={() => list.reload()} />
      )}

      <ConfirmModal
        open={!!disabling}
        onClose={() => setDisabling(null)}
        title="Disable this payment link?"
        confirmLabel="Disable link"
        danger
        busy={act.busy}
        error={act.error}
        onConfirm={async () => {
          if (!disabling) return;
          const r = await act.run(() => api(`/v1/payment_links/${disabling.id}/disable`, { method: "POST" }));
          if (r) {
            toast("Payment link disabled");
            setDisabling(null);
            list.reload();
          }
        }}
      >
        Customers who open <span className="font-mono text-[12.5px] text-text">/pay/{disabling?.id}</span> will see that it is no longer active. Past orders and payments are not affected. A disabled link can&apos;t be turned back on — create a new one instead.
      </ConfirmModal>
    </>
  );
}
