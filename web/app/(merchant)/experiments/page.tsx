"use client";

import { useRouter } from "next/navigation";
import { useCursorList } from "@/lib/merchant/hooks";
import { date } from "@/lib/format";
import { Button, Card, Chip, Empty, PageHeader, Table } from "@/components/ui";
import { useMerchant } from "@/components/merchant/context";
import { Help, ListSkeleton, Loaded, NoAccess, Pager } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { useNewParam } from "@/components/merchant/sales/links";
import { StateChip } from "@/components/merchant/growth/helpers";
import { ExperimentModal } from "@/components/merchant/growth/ExperimentModal";
import type { Experiment } from "@/components/merchant/growth/types";

export default function ExperimentsPage() {
  const { can } = useMerchant();
  const router = useRouter();
  const create = useNewParam();
  const list = useCursorList<Experiment>(can("analytics.read") ? "/v1/experiments" : null);

  if (!can("analytics.read")) return <NoAccess what="experiments" />;
  const canWrite = can("checkout.write");

  return (
    <>
      <PageHeader
        title="Experiments"
        subtitle="A/B test prices and discounts on a payment link and compare conversion and revenue per visitor."
        actions={canWrite && <Button icon={<Icon name="plus" size={16} />} onClick={create.setOpen}>New experiment</Button>}
      />
      <Card>
        <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton />}>
          {() => (
            <>
              <Table
                rows={list.rows}
                rowKey={(x) => x.id}
                onRowClick={(x) => router.push(`/experiments/${x.id}`)}
                empty={
                  <Empty
                    title="No experiments yet"
                    icon={<Icon name="flask" />}
                    action={canWrite && <Button onClick={create.setOpen} icon={<Icon name="plus" size={16} />}>Create an experiment</Button>}
                  >
                    Pick a payment link, add a variant with a different price or coupon, and each visitor is assigned one at random by weight.
                  </Empty>
                }
                columns={[
                  {
                    key: "name",
                    header: "Experiment",
                    render: (x) => (
                      <span className="block min-w-0">
                        <span className="block max-w-[280px] truncate text-text">{x.name}</span>
                        {x.hypothesis && <span className="block max-w-[280px] truncate text-[12px] text-muted">{x.hypothesis}</span>}
                      </span>
                    ),
                  },
                  { key: "status", header: "Status", render: (x) => <StateChip status={x.status} /> },
                  {
                    key: "variants",
                    header: "Variants",
                    render: (x) => (
                      <span className="flex flex-wrap gap-1">
                        {x.variants.map((v, i) => <Chip key={v.key} tone={i === 0 ? "neutral" : "lemon-soft"} className="font-mono">{v.key}</Chip>)}
                      </span>
                    ),
                  },
                  { key: "link", header: "Payment link", render: (x) => <span className="font-mono text-[12px] text-text-2">{x.payment_link_id}</span> },
                  {
                    key: "when",
                    header: "Running",
                    align: "right",
                    render: (x) => (
                      <span className="whitespace-nowrap text-muted">
                        {x.started_at ? `${date(x.started_at)} → ${x.stopped_at ? date(x.stopped_at) : "now"}` : `Created ${date(x.created_at)}`}
                      </span>
                    ),
                  },
                ]}
              />
              <Pager page={list.page} hasPrev={list.hasPrev} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
            </>
          )}
        </Loaded>
        <div className="mt-5 border-t border-line pt-4">
          <Help>One experiment can run per payment link at a time. Decide how many visitors you need before starting, and let it run until then even if an early result looks decisive.</Help>
        </div>
      </Card>

      {create.open && canWrite && (
        <ExperimentModal
          initialLink={create.params.get("link") ?? undefined}
          onClose={create.close}
          onCreated={(x) => {
            create.close();
            router.push(`/experiments/${x.id}`);
          }}
        />
      )}
    </>
  );
}
