"use client";

import { useRouter } from "next/navigation";
import { useCursorList } from "@/lib/merchant/hooks";
import { date } from "@/lib/format";
import { Button, Card, Empty, PageHeader, Table } from "@/components/ui";
import { useMerchant } from "@/components/merchant/context";
import { CopyButton, Help, ListSkeleton, Loaded, NoAccess, Pager } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { useNewParam } from "@/components/merchant/sales/links";
import { StateChip } from "@/components/merchant/growth/helpers";
import { commissionLabel, CreateAffiliateModal } from "@/components/merchant/growth/AffiliateModals";
import type { Affiliate } from "@/components/merchant/growth/types";

export default function AffiliatesPage() {
  const { can } = useMerchant();
  const router = useRouter();
  const create = useNewParam();
  const list = useCursorList<Affiliate>(can("customers.read") ? "/v1/affiliates" : null);

  if (!can("customers.read")) return <NoAccess what="affiliates" />;
  const canWrite = can("customers.write");

  return (
    <>
      <PageHeader
        title="Affiliates"
        subtitle="Partners who refer customers with a code. They earn a commission on the sales they bring in."
        actions={canWrite && <Button icon={<Icon name="plus" size={16} />} onClick={create.setOpen}>New affiliate</Button>}
      />
      <Card>
        <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton />}>
          {() => (
            <>
              <Table
                rows={list.rows}
                rowKey={(a) => a.id}
                onRowClick={(a) => router.push(`/affiliates/${a.id}`)}
                empty={
                  <Empty
                    title="No affiliates yet"
                    icon={<Icon name="handshake" />}
                    action={canWrite && <Button onClick={create.setOpen} icon={<Icon name="plus" size={16} />}>Add your first affiliate</Button>}
                  >
                    Give a partner a referral code. Buyers who arrive through <span className="font-mono">?ref=CODE</span> are attributed to them, first touch wins.
                  </Empty>
                }
                columns={[
                  {
                    key: "name",
                    header: "Affiliate",
                    render: (a) => (
                      <span className="block min-w-0">
                        <span className="block max-w-[220px] truncate text-text">{a.name}</span>
                        <span className="block max-w-[220px] truncate text-[12px] text-muted">{a.email}</span>
                      </span>
                    ),
                  },
                  {
                    key: "code",
                    header: "Code",
                    render: (a) => (
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-[13px] text-text">{a.code}</span>
                        <CopyButton value={a.code} label="Copy" className="h-6 px-2" />
                      </span>
                    ),
                  },
                  { key: "commission", header: "Commission", render: (a) => <span className="block max-w-[260px] text-text-2">{commissionLabel(a)}</span> },
                  { key: "hold", header: "Hold", render: (a) => <span className="whitespace-nowrap text-text-2">{a.hold_days} days</span> },
                  { key: "clicks", header: "Clicks", align: "right", render: (a) => <span className="numeral text-text-2">{a.clicks.toLocaleString()}</span> },
                  { key: "status", header: "Status", render: (a) => <StateChip status={a.status} /> },
                  { key: "created", header: "Created", align: "right", render: (a) => <span className="whitespace-nowrap text-muted">{date(a.created_at)}</span> },
                ]}
              />
              <Pager page={list.page} hasPrev={list.hasPrev} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
            </>
          )}
        </Loaded>
        <div className="mt-5 border-t border-line pt-4">
          <Help>
            Attribution: append <span className="font-mono">?ref=CODE</span> to a payment link URL, or pass <span className="font-mono">&quot;affiliate&quot;: &quot;CODE&quot;</span> when
            you create a checkout session. Commissions are calculated on the sale excluding tax.
          </Help>
        </div>
      </Card>

      {create.open && canWrite && (
        <CreateAffiliateModal
          onClose={create.close}
          onCreated={(a) => {
            create.close();
            router.push(`/affiliates/${a.id}`);
          }}
        />
      )}
    </>
  );
}
