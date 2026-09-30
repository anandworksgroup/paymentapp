"use client";

import { useState } from "react";
import type { List } from "@/lib/api";
import { useApi, qs } from "@/lib/merchant/hooks";
import type { ApiRequestLog } from "@/lib/merchant/types";
import { Button, Card, Chip, Empty, PageHeader, Table, cx } from "@/components/ui";
import { date, relative } from "@/lib/format";
import { useMerchant } from "@/components/merchant/context";
import { CopyButton, FilterBar, FilterSelect, ListSkeleton, Loaded, NoAccess } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { DevNav, HttpStatus, MethodPill } from "@/components/merchant/developers/shared";

const STATUSES: { value: string; label: string }[] = [
  { value: "200", label: "200 OK" }, { value: "201", label: "201 Created" }, { value: "204", label: "204 No content" },
  { value: "400", label: "400 Bad request" }, { value: "401", label: "401 Unauthorized" }, { value: "403", label: "403 Forbidden" },
  { value: "404", label: "404 Not found" }, { value: "409", label: "409 Conflict" }, { value: "422", label: "422 Unprocessable" },
  { value: "429", label: "429 Rate limited" }, { value: "500", label: "500 Server error" },
];
const QUICK = ["200", "400", "401", "404", "422", "429", "500"];

export default function LogsPage() {
  const { can, live } = useMerchant();
  const allowed = can("developers.read");
  const [status, setStatus] = useState("");
  const [limit, setLimit] = useState("50");
  const logs = useApi<List<ApiRequestLog>>(allowed ? `/v1/logs${qs({ status, limit })}` : null);

  if (!allowed) return <NoAccess what="request logs" />;

  return (
    <>
      <PageHeader
        title="Request logs"
        subtitle={`The most recent API requests in ${live ? "live" : "test"} mode, from the dashboard and your API keys.`}
        actions={<Button variant="soft" loading={logs.loading && !!logs.data} onClick={logs.reload} icon={<Icon name="repeat" size={15} />}>Refresh</Button>}
      />
      <DevNav current="/developers/logs" />
      <Card>
        <FilterBar>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status quick filters">
            <QuickChip active={!status} onClick={() => setStatus("")}>All</QuickChip>
            {QUICK.map((s) => (
              <QuickChip key={s} active={status === s} onClick={() => setStatus(status === s ? "" : s)}>{s}</QuickChip>
            ))}
          </div>
          <FilterSelect label="Status code" value={status} onChange={setStatus} options={[{ value: "", label: "Any status" }, ...STATUSES]} />
          <FilterSelect label="How many" value={limit} onChange={setLimit} options={[{ value: "50", label: "Last 50" }, { value: "100", label: "Last 100" }, { value: "200", label: "Last 200" }]} />
        </FilterBar>
        <Loaded data={logs.data} error={logs.error} onRetry={logs.reload} skeleton={<ListSkeleton rows={8} />}>
          {(l) => (
            <Table
              rows={l.data}
              rowKey={(r) => String(r.id)}
              empty={
                <Empty title={status ? `No ${status} responses` : "No requests yet"} icon={<Icon name="list" />}>
                  {status ? "Nothing in the recent log returned this status." : "Requests to the API appear here within a moment."}
                </Empty>
              }
              columns={[
                { key: "status", header: "Status", render: (r) => <HttpStatus code={r.status} /> },
                { key: "method", header: "Method", render: (r) => <MethodPill method={r.method} /> },
                { key: "path", header: "Path", render: (r) => (
                  <span className="block min-w-[180px]">
                    <span className="block break-all font-mono text-[12.5px] text-text">{r.path}</span>
                    {r.error_code && <span className="mt-0.5 block font-mono text-[11.5px] text-rose-ink">{r.error_code}</span>}
                  </span>
                ) },
                { key: "latency", header: "Latency", align: "right", render: (r) => <span className={cx("whitespace-nowrap numeral", r.latency_ms > 1000 ? "text-peach-ink" : "text-text-2")}>{r.latency_ms} ms</span> },
                { key: "source", header: "Source", render: (r) => (
                  <span className="block max-w-[200px]">
                    {r.api_key_id ? <Chip tone="lemon-soft" className="font-mono">{r.api_key_id}</Chip> : <Chip tone="neutral">Dashboard</Chip>}
                    <span className="mt-0.5 block truncate text-[11.5px] text-muted" title={r.user_agent ?? undefined}>{r.ip ?? "—"}{r.user_agent ? ` · ${r.user_agent}` : ""}</span>
                  </span>
                ) },
                { key: "req", header: "Request id", render: (r) => (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[12px] text-text-2">
                    {r.request_id}
                    <CopyButton value={r.request_id} className="h-6 px-2" />
                  </span>
                ) },
                { key: "at", header: "Time", align: "right", render: (r) => <span className="whitespace-nowrap text-muted" title={date(r.at, true)}>{relative(r.at)}</span> },
              ]}
            />
          )}
        </Loaded>
      </Card>
    </>
  );
}

function QuickChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={cx("h-8 rounded-full px-3 font-mono text-[12px] transition", active ? "bg-ink text-white" : "bg-surface-2 text-text-2 hover:bg-surface-3")}>
      {children}
    </button>
  );
}
