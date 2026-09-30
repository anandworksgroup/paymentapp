"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useCursorList, useDebounced, qs } from "@/lib/merchant/hooks";
import type { ApiEvent } from "@/lib/merchant/types";
import { Card, Chip, Empty, PageHeader, Table, cx, inputClass } from "@/components/ui";
import { date, relative, titleCase } from "@/lib/format";
import { useMerchant } from "@/components/merchant/context";
import { FilterBar, ListSkeleton, Loaded, NoAccess, Pager } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { ALL_EVENT_TYPES, DevNav, EVENT_GROUPS } from "@/components/merchant/developers/shared";

const QUICK = ["payment.*", "refund.*", "dispute.*", "checkout.*", "subscription.*", "invoice.*", "payout.*", "customer.*"];

export default function EventsPage() {
  const { can, live } = useMerchant();
  const router = useRouter();
  const params = useSearchParams();
  const [type, setType] = useState(params.get("type") ?? "");
  const term = useDebounced(type.trim(), 350);
  const allowed = can("developers.read");
  const list = useCursorList<ApiEvent>(allowed ? `/v1/events${qs({ type: term })}` : null);

  const setFilter = (v: string) => {
    setType(v);
    router.replace(`/developers/events${v ? `?type=${encodeURIComponent(v)}` : ""}`, { scroll: false });
  };

  if (!allowed) return <NoAccess what="events" />;

  return (
    <>
      <PageHeader title="Events" subtitle={`Everything that happened in ${live ? "live" : "test"} mode, newest first. Each event is what your webhooks receive.`} />
      <DevNav current="/developers/events" />
      <Card>
        <FilterBar>
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"><Icon name="search" size={16} /></span>
            <input
              aria-label="Filter by event type"
              list="event-types"
              value={type}
              onChange={(e) => setType(e.target.value)}
              onBlur={() => setFilter(type.trim())}
              placeholder="Event type, e.g. payment.*"
              className={cx(inputClass, "h-10 rounded-full pl-10 font-mono text-[13px]")}
            />
            <datalist id="event-types">
              {EVENT_GROUPS.map((g) => <option key={g.group} value={`${g.group}.*`} />)}
              {ALL_EVENT_TYPES.map((t) => <option key={t} value={t} />)}
            </datalist>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick filters">
            {QUICK.map((q) => (
              <button
                key={q}
                type="button"
                aria-pressed={term === q}
                onClick={() => setFilter(term === q ? "" : q)}
                className={cx("h-8 rounded-full px-3 font-mono text-[12px] transition", term === q ? "bg-ink text-white" : "bg-surface-2 text-text-2 hover:bg-surface-3")}
              >
                {q}
              </button>
            ))}
            {term && !QUICK.includes(term) && (
              <button type="button" onClick={() => setFilter("")} className="inline-flex h-8 items-center gap-1 rounded-full bg-lemon-soft px-3 text-[12px] text-lemon-ink">
                Clear <Icon name="close" size={12} />
              </button>
            )}
          </div>
        </FilterBar>
        <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton />}>
          {() => (
            <>
              <Table
                rows={list.rows}
                rowKey={(e) => e.id}
                onRowClick={(e) => router.push(`/developers/events/${e.id}`)}
                empty={
                  <Empty title={term ? "No events match this type" : "No events yet"} icon={<Icon name="bolt" />}>
                    {term ? "Try a wider filter such as payment.* — a trailing * matches a prefix." : "Events are created as payments, subscriptions, invoices and payouts change."}
                  </Empty>
                }
                columns={[
                  { key: "type", header: "Event", render: (e) => <span className="font-mono text-[12.5px] text-text">{e.type}</span> },
                  { key: "obj", header: "Object", render: (e) => (
                    <span className="flex min-w-0 items-center gap-2">
                      <Chip tone="neutral">{titleCase(e.object_type)}</Chip>
                      <span className="truncate font-mono text-[12px] text-muted">{e.object_id}</span>
                    </span>
                  ) },
                  { key: "id", header: "Event id", render: (e) => <span className="whitespace-nowrap font-mono text-[12px] text-text-2">{e.id}</span> },
                  { key: "at", header: "Created", align: "right", render: (e) => <span className="whitespace-nowrap text-muted" title={date(e.created_at, true)}>{relative(e.created_at)}</span> },
                ]}
              />
              <Pager page={list.page} hasPrev={list.hasPrev} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
            </>
          )}
        </Loaded>
      </Card>
    </>
  );
}
