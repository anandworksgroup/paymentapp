"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Card, Chip, Empty, PageHeader, StatusChip, Table } from "@/components/ui";
import { qs, usePagedList } from "@/components/admin/data";
import { Country, FilterBar, FilterInput, FilterSelect, IdTag, Loadable, Pager, When } from "@/components/admin/kit";
import { maskEmail } from "@/components/admin/mask";
import { Guard } from "@/components/admin/shell";
import type { User } from "@/components/admin/types";

const STATUS = ["", "NORMAL", "LIMITED", "TRANSFERS_DISABLED", "FROZEN", "CLOSED"];
const KYC = ["", "NOT_STARTED", "PENDING", "REVIEW", "VERIFIED", "REJECTED"];
const label = (s: string, all: string) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : all);

export default function UsersPage() {
  return (
    <Guard perm="admin.users.read">
      <Users />
    </Guard>
  );
}

function Users() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [kyc, setKyc] = useState(params.get("kyc_status") ?? "");
  const [kind, setKind] = useState("");
  const [text, setText] = useState("");
  const list = usePagedList<User>(`/users${qs({ status, kyc_status: kyc })}`, 50);
  const t = text.trim().toLowerCase();
  const rows = list.rows.filter(
    (u) =>
      (!kind || (kind === "staff" ? !!u.platform_role : !u.platform_role)) &&
      (!t || u.name.toLowerCase().includes(t) || u.id === text.trim() || u.email.toLowerCase().startsWith(t)),
  );

  return (
    <>
      <PageHeader
        eyebrow="Customers"
        title="Users"
        subtitle="Wallet users, merchant team members and staff. Personal data is masked; open a profile to see more."
      />
      <Card>
        <FilterBar>
          <FilterSelect label="Account status" value={status} onChange={setStatus} options={STATUS.map((s) => ({ value: s, label: label(s, "All statuses") }))} />
          <FilterSelect label="KYC status" value={kyc} onChange={setKyc} options={KYC.map((s) => ({ value: s, label: label(s, "Any KYC status") }))} />
          <FilterSelect
            label="Account type"
            value={kind}
            onChange={setKind}
            options={[
              { value: "", label: "Everyone" },
              { value: "customer", label: "Customers" },
              { value: "staff", label: "Platform staff" },
            ]}
          />
          <FilterInput label="Filter this page" value={text} onChange={setText} placeholder="Name or user id" width="w-56" />
        </FilterBar>
        <Loadable q={list}>
          {() => (
            <>
              <Table
                rows={rows}
                rowKey={(r) => r.id}
                onRowClick={(r) => router.push(`/admin/users/${r.id}`)}
                empty={<Empty title="No users match">Adjust the filters above.</Empty>}
                columns={[
                  {
                    key: "name",
                    header: "User",
                    render: (r) => (
                      <div>
                        <div className="flex items-center gap-2 font-medium text-text">
                          {r.name}
                          {r.platform_role && <Chip tone="ink">{r.platform_role.replace(/_/g, " ").toLowerCase()}</Chip>}
                        </div>
                        <span className="text-[12px] text-muted">{maskEmail(r.email)}</span>
                      </div>
                    ),
                  },
                  { key: "id", header: "ID", render: (r) => <IdTag id={r.id} /> },
                  { key: "country", header: "Country", render: (r) => <Country code={r.country} /> },
                  { key: "status", header: "Status", render: (r) => <StatusChip status={r.status} /> },
                  {
                    key: "kyc",
                    header: "KYC",
                    render: (r) => (
                      <span className="inline-flex items-center gap-1.5">
                        <StatusChip status={r.kyc_status} />
                        {r.kyc_level > 0 && <span className="text-[12px] text-muted">L{r.kyc_level}</span>}
                      </span>
                    ),
                  },
                  { key: "risk", header: "Risk", render: (r) => <StatusChip status={r.risk_level} /> },
                  { key: "login", header: "Last sign-in", render: (r) => <When at={r.last_login_at} rel /> },
                  { key: "created", header: "Joined", render: (r) => <When at={r.created_at} /> },
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
