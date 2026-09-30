"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useCursorList, useDebounced, qs } from "@/lib/merchant/hooks";
import type { Customer } from "@/lib/merchant/types";
import { Button, Card, Chip, Empty, PageHeader, Segmented, Table } from "@/components/ui";
import { date, flag } from "@/lib/format";
import { useMerchant } from "@/components/merchant/context";
import { FilterBar, FlagAvatar, Loaded, ListSkeleton, NoAccess, Pager, SearchBox } from "@/components/merchant/common";
import { CustomerFormModal } from "@/components/merchant/customers/CustomerFormModal";
import { Icon } from "@/components/merchant/icons";
import { DuplicatesPanel } from "@/components/merchant/growth/CustomerMerge";

export default function CustomersPage() {
  const { can } = useMerchant();
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [creating, setCreating] = useState(params.get("new") === "1" && can("customers.write"));
  const term = useDebounced(search.trim(), 350);
  const view = params.get("view") === "duplicates" ? "duplicates" : "all";
  const list = useCursorList<Customer>(can("customers.read") && view === "all" ? `/v1/customers${qs({ search: term.length > 1 ? term : "" })}` : null);

  const changeView = (v: "all" | "duplicates") => {
    const next = new URLSearchParams(params.toString());
    if (v === "duplicates") next.set("view", "duplicates");
    else next.delete("view");
    router.replace(`/customers${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };

  const closeCreate = () => {
    setCreating(false);
    if (params.get("new")) {
      const next = new URLSearchParams(params.toString());
      next.delete("new");
      router.replace(`/customers${next.toString() ? `?${next}` : ""}`, { scroll: false });
    }
  };

  if (!can("customers.read")) return <NoAccess what="customers" />;
  const filtered = term.length > 1;

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="People and businesses who buy from you, with their billing profile."
        actions={can("customers.write") && <Button icon={<Icon name="plus" size={16} />} onClick={() => setCreating(true)}>New customer</Button>}
      />
      <div className="mb-4">
        <Segmented<"all" | "duplicates">
          value={view}
          onChange={changeView}
          options={[{ value: "all", label: "All customers" }, { value: "duplicates", label: "Possible duplicates" }]}
        />
      </div>
      {view === "duplicates" ? (
        <Card>
          <DuplicatesPanel canMerge={can("customers.write")} />
        </Card>
      ) : (
        <Card>
          <FilterBar>
            <SearchBox value={search} onChange={setSearch} placeholder="Name, email, phone, id or external id" label="Search customers" />
          </FilterBar>
          <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton />}>
            {() => (
              <>
                <Table
                  rows={list.rows}
                  rowKey={(c) => c.id}
                  onRowClick={(c) => router.push(`/customers/${c.id}`)}
                  empty={
                    <Empty title={filtered ? "No customers match this search" : "No customers yet"} icon={<Icon name="users" />}>
                      {filtered ? "Try a different name, email or id." : "Customers are created at checkout, or you can add one yourself to send them a B2B invoice."}
                    </Empty>
                  }
                  columns={[
                    { key: "name", header: "Customer", render: (c) => (
                      <span className="flex min-w-0 items-center gap-3">
                        <FlagAvatar country={c.country} size={30} />
                        <span className="min-w-0">
                          <span className="block max-w-[240px] truncate text-text">{c.name ?? c.email ?? c.id}</span>
                          <span className="block max-w-[240px] truncate text-[12px] text-muted">{c.email ?? c.id}</span>
                        </span>
                      </span>
                    ) },
                    { key: "type", header: "Type", render: (c) => (
                      <span className="flex flex-wrap gap-1">
                        <Chip tone={c.customer_type === "b2b" ? "lemon-soft" : "neutral"}>{c.customer_type === "b2b" ? "Business" : "Individual"}</Chip>
                        {c.anonymized_at && <Chip tone="neutral">Anonymized</Chip>}
                      </span>
                    ) },
                    { key: "country", header: "Country", render: (c) => <span className="whitespace-nowrap text-text-2">{c.country ? `${flag(c.country)} ${c.country}` : "—"}</span> },
                    { key: "tax", header: "Tax ID", render: (c) => <span className="font-mono text-[12px] text-text-2">{c.tax_id ?? "—"}</span> },
                    { key: "terms", header: "Terms", render: (c) => <span className="whitespace-nowrap text-text-2">{c.payment_terms_days ? `Net ${c.payment_terms_days}` : "On receipt"}</span> },
                    { key: "created", header: "Created", align: "right", render: (c) => <span className="whitespace-nowrap text-muted">{date(c.created_at)}</span> },
                  ]}
                />
                <Pager page={list.page} hasPrev={list.hasPrev} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
              </>
            )}
          </Loaded>
        </Card>
      )}
      {creating && (
        <CustomerFormModal
          open
          onClose={closeCreate}
          onSaved={(c) => {
            setCreating(false);
            router.push(`/customers/${c.id}`);
          }}
        />
      )}
    </>
  );
}
