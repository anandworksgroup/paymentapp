"use client";

import Link from "next/link";
import { useState } from "react";
import { useCursorList } from "@/lib/merchant/hooks";
import type { Meter } from "@/lib/merchant/types";
import { Button, Card, Chip, Empty, Modal, PageHeader, Table } from "@/components/ui";
import { date } from "@/lib/format";
import { useMerchant } from "@/components/merchant/context";
import { ListSkeleton, Loaded, NoAccess, Pager } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { AGGREGATIONS, MeterCreateModal, UsageExample } from "@/components/merchant/catalog/Meters";
import { useNewParam } from "@/components/merchant/sales/links";

export default function MetersPage() {
  const { can } = useMerchant();
  const create = useNewParam();
  const list = useCursorList<Meter>(can("usage.read") ? "/v1/meters" : null);
  const [example, setExample] = useState<Meter | null>(null);

  if (!can("usage.read")) return <NoAccess what="meters" />;
  const canWrite = can("products.write");

  return (
    <>
      <PageHeader
        title="Meters"
        subtitle="A meter turns the usage events your server reports into a billable quantity for metered prices."
        actions={
          <>
            <Link href="/usage" className="inline-flex h-11 items-center rounded-full bg-surface-2 px-5 text-[14px] font-medium text-text transition hover:bg-surface-3">View usage</Link>
            {canWrite && <Button icon={<Icon name="plus" size={16} />} onClick={create.setOpen}>Create meter</Button>}
          </>
        }
      />
      <Card>
        <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton rows={4} />}>
          {() => (
            <>
              <Table
                rows={list.rows}
                rowKey={(m) => m.id}
                empty={
                  <Empty title="No meters yet" icon={<Icon name="gauge" />} action={canWrite && <Button onClick={create.setOpen}>Create meter</Button>}>
                    Create a meter for each thing you bill by usage — API requests, tokens, storage — then attach it to a metered price.
                  </Empty>
                }
                columns={[
                  {
                    key: "name",
                    header: "Meter",
                    render: (m) => (
                      <div>
                        <div className="text-text">{m.display_name}</div>
                        <div className="font-mono text-[12px] text-muted">{m.event_name}</div>
                      </div>
                    ),
                  },
                  {
                    key: "agg",
                    header: "Aggregation",
                    render: (m) => <Chip tone="neutral">{AGGREGATIONS.find((a) => a.value === m.aggregation)?.label ?? m.aggregation}</Chip>,
                  },
                  { key: "unit", header: "Unit", render: (m) => <span className="text-text-2">{m.unit ?? "—"}</span> },
                  { key: "id", header: "Id", render: (m) => <span className="font-mono text-[12px] text-text-2">{m.id}</span> },
                  { key: "created", header: "Created", render: (m) => <span className="whitespace-nowrap text-muted">{date(m.created_at)}</span> },
                  {
                    key: "ex",
                    header: <span className="sr-only">Example</span>,
                    align: "right",
                    render: (m) => (
                      <Button size="sm" variant="soft" icon={<Icon name="code" size={14} />} onClick={() => setExample(m)} aria-label={`Show usage example for ${m.display_name}`}>
                        Send usage
                      </Button>
                    ),
                  },
                ]}
              />
              <Pager page={list.page} hasPrev={list.hasPrev} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
            </>
          )}
        </Loaded>
      </Card>

      <Modal open={!!example} onClose={() => setExample(null)} title={example ? `Report usage for ${example.display_name}` : "Report usage"} wide>
        {example && <UsageExample eventName={example.event_name} />}
      </Modal>

      {create.open && canWrite && <MeterCreateModal onClose={create.close} onCreated={() => list.reload()} />}
    </>
  );
}
