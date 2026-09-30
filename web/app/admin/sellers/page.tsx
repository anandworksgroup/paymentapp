"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, Card, Chip, Empty, PageHeader, StatusChip, Table, type Tone } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { adminApi, qs, useAdminQuery } from "@/components/admin/data";
import { Country, EntityLink, FilterBar, FilterInput, FilterSelect, IdTag, Loadable, Mono, Notice, ReadOnlyNote, ReasonDialog, When } from "@/components/admin/kit";
import type { Seller } from "@/components/admin/ops-types";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import type { ListResponse } from "@/components/admin/types";

const STATUSES: { value: string; label: string; tone: Tone }[] = [
  { value: "pending_verification", label: "Pending verification", tone: "peach" },
  { value: "active", label: "Active", tone: "sage" },
  { value: "restricted", label: "Restricted", tone: "lemon-soft" },
  { value: "rejected", label: "Rejected", tone: "rose" },
];

function SellerStatus({ status }: { status: string }) {
  const s = STATUSES.find((x) => x.value === status);
  return <Chip tone={s?.tone ?? "neutral"}>{s?.label ?? status}</Chip>;
}

export default function SellersPage() {
  return (
    <Guard perm="admin.merchants.read">
      <Sellers />
    </Guard>
  );
}

function Sellers() {
  const router = useRouter();
  const params = useSearchParams();
  const { can, guard } = useAdmin();
  const canDecide = can("admin.merchants.decide");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [text, setText] = useState("");
  const [deciding, setDeciding] = useState<{ seller: Seller; approve: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const list = useAdminQuery<ListResponse<Seller>>(`/sellers${qs({ status })}`);
  const pending = useAdminQuery<ListResponse<Seller>>("/sellers?status=pending_verification");

  const pick = (s: string) => {
    setStatus(s);
    router.replace(`/admin/sellers${qs({ status: s })}`, { scroll: false });
  };
  const reload = () => {
    list.reload();
    pending.reload();
  };

  return (
    <>
      <PageHeader
        eyebrow="Marketplace"
        title="Sellers"
        subtitle="Connected sellers onboarded by marketplace merchants. A clean screening activates a seller at once; a potential match waits here for review."
      />
      {notice && (
        <div className="mb-5">
          <Notice>{notice}</Notice>
        </div>
      )}

      {pending.data && pending.data.data.length > 0 && (
        <Card className="mb-5">
          <CardHeader
            title="Awaiting review"
            subtitle="Screening returned a potential match. A match is a prompt for review, not a finding — compare the details before deciding."
            action={<Chip tone="peach">{pending.data.data.length} pending</Chip>}
          />
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {pending.data.data.map((s) => (
              <li key={s.id} className="rounded-inner border border-peach bg-peach-soft/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-medium text-text">{s.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-muted">
                      <span className="truncate">{s.email}</span>
                      <IdTag id={s.id} />
                    </div>
                  </div>
                  <Chip tone="rose">Potential match</Chip>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-text-2">
                  <span className="inline-flex items-center gap-1.5">
                    Marketplace <EntityLink type="org" id={s.org_id} />
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    Country <Country code={s.country} />
                  </span>
                  <span>Onboarded <When at={s.created_at} rel /></span>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/admin/screening`} className="text-[12.5px] text-text underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                    Review screening hits
                  </Link>
                  {canDecide ? (
                    <span className="flex gap-2">
                      <Button size="sm" variant="danger" onClick={() => setDeciding({ seller: s, approve: false })}>
                        Reject
                      </Button>
                      <Button size="sm" onClick={() => setDeciding({ seller: s, approve: true })}>
                        Approve
                      </Button>
                    </span>
                  ) : (
                    <ReadOnlyNote>
                      Decisions need <Mono>admin.merchants.decide</Mono>
                    </ReadOnlyNote>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <FilterBar>
          <FilterSelect label="Status" value={status} onChange={pick} options={[{ value: "", label: "All statuses" }, ...STATUSES.map((s) => ({ value: s.value, label: s.label }))]} />
          <FilterInput label="Filter" value={text} onChange={setText} placeholder="Name, email, seller or org id" width="w-64" />
        </FilterBar>
        <Loadable q={list}>
          {(d) => {
            const needle = text.trim().toLowerCase();
            const rows = d.data.filter(
              (s) => !needle || s.name.toLowerCase().includes(needle) || s.email.toLowerCase().includes(needle) || s.id === text.trim() || s.org_id === text.trim(),
            );
            return (
              <>
                <Table
                  rows={rows}
                  rowKey={(r) => r.id}
                  empty={<Empty title={d.data.length ? "No sellers match" : "No sellers yet"}>{d.data.length ? "Try another filter." : "Sellers appear once a marketplace merchant onboards them."}</Empty>}
                  columns={[
                    {
                      key: "name",
                      header: "Seller",
                      render: (r) => (
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 font-medium text-text">
                            {r.status === "pending_verification" && <span className="h-2 w-2 shrink-0 rounded-full bg-peach" title="Awaiting review" />}
                            {r.name}
                          </div>
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <span className="text-[12px] text-muted">{r.email}</span>
                            <IdTag id={r.id} />
                          </div>
                        </div>
                      ),
                    },
                    { key: "org", header: "Marketplace", render: (r) => <EntityLink type="org" id={r.org_id} /> },
                    { key: "country", header: "Country", render: (r) => <Country code={r.country} /> },
                    { key: "commission", header: "Commission", align: "right", render: (r) => <span className="numeral text-text">{(r.commission_bps / 100).toFixed(r.commission_bps % 100 ? 2 : 0)}%</span> },
                    { key: "screening", header: "Screening", render: (r) => <StatusChip status={r.screening_status} /> },
                    {
                      key: "status",
                      header: "Status",
                      render: (r) => (
                        <div className="max-w-[260px]">
                          <SellerStatus status={r.status} />
                          {r.decision_reason && (
                            <p className="mt-1 line-clamp-2 text-[12px] text-muted" title={r.decision_reason}>
                              “{r.decision_reason}”
                            </p>
                          )}
                        </div>
                      ),
                    },
                    { key: "created", header: "Onboarded", render: (r) => <When at={r.created_at} rel /> },
                  ]}
                />
                {d.data.length >= 200 && <p className="mt-3 text-[12px] text-muted">Showing the 200 most recent sellers. Narrow the status filter to see older ones.</p>}
              </>
            );
          }}
        </Loadable>
      </Card>

      <ReasonDialog
        open={deciding !== null}
        onClose={() => setDeciding(null)}
        title={deciding ? `${deciding.approve ? "Approve" : "Reject"} ${deciding.seller.name}` : ""}
        tone={deciding?.approve ? "ink" : "danger"}
        confirmLabel={deciding?.approve ? "Approve seller" : "Reject seller"}
        description={
          deciding?.approve ? (
            <>
              Approving makes the seller <b>active</b>: the marketplace can route sales and payouts to them. Only approve once you have confirmed the screening result is not a true match. Your name and
              reason go to the audit log.
            </>
          ) : (
            <>Rejecting stops the seller from receiving sales or payouts on this marketplace. Use neutral, factual wording — the marketplace merchant may see the reason.</>
          )
        }
        onSubmit={async (reason) => {
          const s = deciding!.seller;
          await guard(() => adminApi(`/sellers/${s.id}/decision`, { body: { approve: deciding!.approve, reason } }));
          setNotice(`${s.name} ${deciding!.approve ? "approved and now active" : "rejected"}. The decision is recorded in the audit log.`);
          reload();
        }}
      />
    </>
  );
}
