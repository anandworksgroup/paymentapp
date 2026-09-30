"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Card, Chip, Empty, PageHeader, StatusChip, Table } from "@/components/ui";
import { qs, usePagedList } from "@/components/admin/data";
import { Country, FilterBar, FilterInput, FilterSelect, IdTag, Loadable, Pager, When } from "@/components/admin/kit";
import { Guard } from "@/components/admin/shell";
import type { Organization } from "@/components/admin/types";

const STATUSES = ["", "UNDER_REVIEW", "APPROVED", "REJECTED", "PENDING", "SUSPENDED", "CLOSED"];

export default function MerchantsPage() {
  return (
    <Guard perm="admin.merchants.read">
      <Merchants />
    </Guard>
  );
}

function Merchants() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [text, setText] = useState("");
  const list = usePagedList<Organization>(`/merchants${qs({ status })}`, 50);
  const rows = list.rows.filter((o) => !text || o.name.toLowerCase().includes(text.toLowerCase()) || o.id === text.trim());

  return (
    <>
      <PageHeader eyebrow="Merchants of record" title="Merchants" subtitle="Onboarding (KYB) decisions, risk and account state for every business on the platform." />
      <Card>
        <FilterBar>
          <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: s ? s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "All statuses" }))} />
          <FilterInput label="Filter this page" value={text} onChange={setText} placeholder="Name or org id" width="w-56" />
        </FilterBar>
        <Loadable q={list}>
          {() => (
            <>
              <Table
                rows={rows}
                rowKey={(r) => r.id}
                onRowClick={(r) => router.push(`/admin/merchants/${r.id}`)}
                empty={<Empty title="No merchants match">Try another status filter.</Empty>}
                columns={[
                  {
                    key: "name",
                    header: "Merchant",
                    render: (r) => (
                      <div>
                        <div className="font-medium text-text">{r.name}</div>
                        <IdTag id={r.id} />
                      </div>
                    ),
                  },
                  { key: "country", header: "Country", render: (r) => <Country code={r.country} /> },
                  { key: "status", header: "KYB status", render: (r) => <StatusChip status={r.status} /> },
                  { key: "golive", header: "Go-live", render: (r) => <Chip tone={r.go_live_state === "PRODUCTION" ? "ink" : "neutral"}>{r.go_live_state.toLowerCase()}</Chip> },
                  { key: "restriction", header: "Restriction", render: (r) => (r.restriction === "NORMAL" ? <span className="text-muted">None</span> : <Chip tone="peach">{r.restriction.replace(/_/g, " ").toLowerCase()}</Chip>) },
                  {
                    key: "risk",
                    header: "Risk",
                    render: (r) => (
                      <span className="inline-flex items-center gap-2">
                        <span className="numeral text-text">{r.risk_score}</span>
                        <StatusChip status={r.risk_level} />
                      </span>
                    ),
                  },
                  { key: "created", header: "Created", render: (r) => <When at={r.created_at} /> },
                ]}
              />
              <Pager page={list.page} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
            </>
          )}
        </Loadable>
      </Card>
    </>
  );
}
