"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useState } from "react";
import { Button, Card, Chip, cx, Empty, PageHeader, Table } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { adminDownload, qs, useAdminQuery, usePagedList } from "@/components/admin/data";
import {
  EntityLink,
  FilterBar,
  FilterInput,
  Hash,
  humanize,
  JsonBlock,
  KV,
  Loadable,
  Mono,
  Notice,
  Pager,
  Person,
  ReadOnlyNote,
  ReasonDialog,
  SkeletonRows,
  Tabs,
  When,
  filterClass,
} from "@/components/admin/kit";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";
import type { AuditLog, DataAccessLog, LedgerIntegrity } from "@/components/admin/types";

type Tab = "log" | "access";

export default function AuditPage() {
  return (
    <Guard perm="admin.audit.read">
      <Audit />
    </Guard>
  );
}

function Audit() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get("tab") === "access" ? "access" : "log");
  const select = (t: Tab) => {
    setTab(t);
    router.replace(`/admin/audit?tab=${t}`, { scroll: false });
  };
  return (
    <>
      <PageHeader
        eyebrow="Accountability"
        title="Audit logs"
        subtitle="Every consequential action by staff, merchants and the system, in an append-only, hash-chained log. Read-only for everyone."
      />
      <Tabs
        value={tab}
        onChange={select}
        tabs={[
          { value: "log", label: "Audit log" },
          { value: "access", label: "Data access log" },
        ]}
      />
      {tab === "log" ? <AuditLogTab initialObject={params.get("object") ?? ""} /> : <DataAccessTab />}
    </>
  );
}

// ───────────────────────── Audit log ─────────────────────────

type Filters = { actor: string; object: string; action: string; org: string; ip: string; from: string; to: string };
const EMPTY: Filters = { actor: "", object: "", action: "", org: "", ip: "", from: "", to: "" };
const LIMIT = 50;

type AuditPage = { object: "list"; data: AuditLog[]; next_before_seq: number | null };

/** Local calendar date → ISO instant at local midnight; `to` is exclusive on the API, so it moves to the next day. */
function dayStart(d: string, plusDays = 0) {
  if (!d) return undefined;
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day + plusDays).toISOString();
}

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function AuditLogTab({ initialObject }: { initialObject: string }) {
  const { can, guard } = useAdmin();
  const [draft, setDraft] = useState<Filters>({ ...EMPTY, object: initialObject });
  const [applied, setApplied] = useState<Filters>({ ...EMPTY, object: initialObject });
  // Stack of before_seq cursors; empty = newest page.
  const [cursors, setCursors] = useState<number[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const before = cursors[cursors.length - 1];
  const path = `/audit_logs${qs({
    actor: applied.actor.trim(),
    object: applied.object.trim(),
    action: applied.action.trim(),
    org: applied.org.trim(),
    ip: applied.ip.trim(),
    from: dayStart(applied.from),
    to: dayStart(applied.to, 1),
    before_seq: before,
    limit: LIMIT,
  })}`;
  const q = useAdminQuery<AuditPage>(path);
  const integrity = useAdminQuery<LedgerIntegrity>(can("admin.ledger.read") ? "/ledger/integrity" : null);
  const rows = q.data?.data ?? [];
  const hasMore = rows.length === LIMIT && q.data?.next_before_seq != null;

  const apply = (f: Filters) => {
    setApplied(f);
    setCursors([]);
    setOpen(null);
  };
  const active = Object.values(applied).some((v) => v.trim());
  const set = (k: keyof Filters) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));

  // Within the loaded page, row[i].prev_hash must equal the hash of the row with seq − 1.
  const bySeq = new Map(rows.map((r) => [r.seq, r]));
  const link = (r: AuditLog): "ok" | "broken" | "unknown" => {
    const prev = bySeq.get(r.seq - 1);
    if (!prev) return "unknown";
    return r.prev_hash === prev.hash ? "ok" : "broken";
  };
  const broken = rows.filter((r) => link(r) === "broken");
  const compared = rows.filter((r) => link(r) !== "unknown").length;
  const chain = integrity.data?.audit_chain;

  return (
    <Card>
      <CardHeader
        title="Audit log"
        subtitle="Newest first. Click a row for the before/after values and its place in the hash chain."
        action={
          can("admin.export") ? (
            <Button size="sm" variant="soft" onClick={() => setExporting(true)}>
              Export CSV
            </Button>
          ) : (
            <ReadOnlyNote>Export needs the admin.export permission</ReadOnlyNote>
          )
        }
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply(draft);
        }}
      >
        <FilterBar>
          <FilterInput label="Actor id" value={draft.actor} onChange={set("actor")} placeholder="usr_… or system" width="w-40" />
          <FilterInput label="Object id" value={draft.object} onChange={set("object")} placeholder="tr_…, org_…" width="w-40" />
          <FilterInput label="Action starts with" value={draft.action} onChange={set("action")} placeholder="approval." width="w-36" />
          <FilterInput label="Org id" value={draft.org} onChange={set("org")} placeholder="org_…" width="w-36" />
          <FilterInput label="IP address" value={draft.ip} onChange={set("ip")} placeholder="198.51.100.10" width="w-32" />
          <label className="flex flex-col gap-1">
            <span className="pl-2 text-[11.5px] text-muted">From</span>
            <input type="date" value={draft.from} onChange={(e) => set("from")(e.target.value)} className={filterClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="pl-2 text-[11.5px] text-muted">To (inclusive)</span>
            <input type="date" value={draft.to} onChange={(e) => set("to")(e.target.value)} className={filterClass} />
          </label>
          <Button size="sm" type="submit" className="h-9">
            Apply
          </Button>
          {(active || Object.values(draft).some((v) => v.trim())) && (
            <Button
              size="sm"
              variant="ghost"
              type="button"
              className="h-9"
              onClick={() => {
                setDraft(EMPTY);
                apply(EMPTY);
              }}
            >
              Clear
            </Button>
          )}
        </FilterBar>
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        {chain ? (
          chain.valid ? (
            <Chip tone="sage">Chain verified · {chain.rows_checked.toLocaleString("en-US")} rows</Chip>
          ) : (
            <Chip tone="rose">Chain check failed at #{chain.broken_at_seq}</Chip>
          )
        ) : null}
        {rows.length > 0 &&
          (broken.length ? (
            <Chip tone="rose">
              {broken.length} link{broken.length === 1 ? "" : "s"} on this page don&apos;t match (#{broken.map((b) => b.seq).join(", #")})
            </Chip>
          ) : compared > 0 ? (
            <Chip tone="neutral">
              {compared} link{compared === 1 ? "" : "s"} on this page match
            </Chip>
          ) : (
            <Chip tone="neutral">No consecutive entries on this page to compare</Chip>
          ))}
        <span>Dates use your local time zone.</span>
      </div>

      {notice && (
        <div className="mb-4">
          <Notice>{notice}</Notice>
        </div>
      )}

      <Loadable q={q} skeleton={<SkeletonRows rows={8} />}>
        {() =>
          rows.length === 0 ? (
            <Empty title={active ? "No entries match these filters" : "No audit entries yet"}>{active ? "Try a wider date range or fewer filters." : undefined}</Empty>
          ) : (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full border-separate border-spacing-y-1 text-[13.5px]">
                <thead>
                  <tr>
                    {["Seq", "Time", "Actor", "Action", "Object", "Reason", "Org", "IP", "Hash / prev"].map((h) => (
                      <th key={h} className="px-3 pb-2 text-left text-[12px] font-normal text-muted">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isOpen = open === r.id;
                    const state = link(r);
                    const cell = "bg-surface px-3 py-3 align-top transition group-hover:bg-surface-2";
                    return (
                      <Fragment key={r.id}>
                        <tr
                          className="group cursor-pointer"
                          tabIndex={0}
                          aria-expanded={isOpen}
                          onClick={() => setOpen(isOpen ? null : r.id)}
                          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(isOpen ? null : r.id))}
                        >
                          <td className={cx(cell, "rounded-l-[14px]", isOpen && "bg-surface-2")}>
                            <Mono>#{r.seq}</Mono>
                          </td>
                          <td className={cx(cell, isOpen && "bg-surface-2")}>
                            <When at={r.at} />
                          </td>
                          <td className={cx(cell, isOpen && "bg-surface-2")}>
                            <div className="flex flex-col items-start gap-1">
                              <Person id={r.actor_id} />
                              <Chip tone={r.actor_type === "system" ? "neutral" : r.actor_role && r.actor_role === r.actor_role.toUpperCase() ? "sky" : "neutral"}>
                                {r.actor_role ? humanize(r.actor_role) : humanize(r.actor_type)}
                              </Chip>
                            </div>
                          </td>
                          <td className={cx(cell, isOpen && "bg-surface-2")}>
                            <Mono className="text-text">{r.action}</Mono>
                          </td>
                          <td className={cx(cell, isOpen && "bg-surface-2")}>
                            {r.object_id ? (
                              <div className="flex flex-col items-start gap-0.5">
                                <span className="text-[11.5px] text-muted">{humanize(r.object_type)}</span>
                                <EntityLink type={r.object_type} id={r.object_id} />
                              </div>
                            ) : (
                              <span className="text-muted">{humanize(r.object_type) || "—"}</span>
                            )}
                          </td>
                          <td className={cx(cell, "max-w-56", isOpen && "bg-surface-2")}>
                            {r.reason ? (
                              <span className="line-clamp-2 text-text-2" title={r.reason}>
                                {r.reason}
                              </span>
                            ) : (
                              <span className="text-faint">—</span>
                            )}
                          </td>
                          <td className={cx(cell, isOpen && "bg-surface-2")}>
                            <EntityLink type="org" id={r.org_id} />
                          </td>
                          <td className={cx(cell, isOpen && "bg-surface-2")}>{r.ip ? <Mono>{r.ip}</Mono> : <span className="text-faint">—</span>}</td>
                          <td className={cx(cell, "rounded-r-[14px]", isOpen && "bg-surface-2")}>
                            <div className="flex flex-col gap-0.5">
                              <Hash value={r.hash} n={8} />
                              <span className="inline-flex items-center gap-1">
                                <Hash value={r.prev_hash} n={8} />
                                {state === "broken" && <Chip tone="rose">mismatch</Chip>}
                              </span>
                            </div>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={9} className="rounded-[14px] bg-surface-2 p-5">
                              <AuditDetail r={r} state={state} prev={bySeq.get(r.seq - 1)} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </Loadable>
      {(cursors.length > 0 || hasMore) && (
        <div className="mt-4 flex items-center justify-end gap-2 text-[12.5px] text-muted">
          <span>
            {rows.length ? `#${rows[0].seq} – #${rows[rows.length - 1].seq}` : ""} · page {cursors.length + 1}
          </span>
          <Button size="sm" variant="soft" onClick={() => setCursors((c) => c.slice(0, -1))} disabled={cursors.length === 0 || q.loading}>
            Newer
          </Button>
          <Button size="sm" variant="soft" onClick={() => q.data?.next_before_seq != null && setCursors((c) => [...c, q.data!.next_before_seq!])} disabled={!hasMore || q.loading}>
            Older
          </Button>
        </div>
      )}

      <ReasonDialog
        open={exporting}
        onClose={() => setExporting(false)}
        title="Export audit log"
        confirmLabel="Export CSV"
        minLength={5}
        placeholder="Why is this export needed? e.g. regulator request reference, internal review ticket."
        description={
          <div className="space-y-2">
            <p>
              Downloads the audit log as CSV (up to 50,000 rows, oldest first).
              {applied.object.trim() || applied.org.trim() ? (
                <>
                  {" "}
                  Filtered to
                  {applied.object.trim() && (
                    <>
                      {" "}
                      object <Mono>{applied.object.trim()}</Mono> (including entries linked to it as a case)
                    </>
                  )}
                  {applied.object.trim() && applied.org.trim() && " and"}
                  {applied.org.trim() && (
                    <>
                      {" "}
                      org <Mono>{applied.org.trim()}</Mono>
                    </>
                  )}
                  .
                </>
              ) : (
                " No object or org filter is set, so the export covers the whole log."
              )}
            </p>
            <p className="text-[12.5px] text-muted">The export supports the object and org filters only; actor, action, IP and date filters are not applied to the file.</p>
            <p className="text-[12.5px] text-muted">The export itself is recorded in the audit log with your reason.</p>
          </div>
        }
        onSubmit={async (reason) => {
          await guard(() => adminDownload(`/audit_logs/export${qs({ reason, object: applied.object.trim(), org: applied.org.trim() })}`, `audit-log-${stamp()}.csv`));
          setNotice("Export downloaded. The export has been added to the audit log.");
          if (cursors.length === 0) q.reload();
        }}
      />
    </Card>
  );
}

function AuditDetail({ r, state, prev }: { r: AuditLog; state: "ok" | "broken" | "unknown"; prev?: AuditLog }) {
  return (
    <div className="space-y-4">
      <KV
        cols={3}
        items={[
          ["Entry id", <Mono key="id">{r.id}</Mono>],
          ["Recorded at", <When key="at" at={r.at} />],
          ["Actor", <span key="actor" className="inline-flex flex-wrap items-center gap-1.5"><Person id={r.actor_id} /><span className="text-[12px] text-muted">{humanize(r.actor_type)}{r.actor_role ? ` · ${humanize(r.actor_role)}` : ""}</span></span>],
          ["Request id", r.request_id ? <Mono key="req">{r.request_id}</Mono> : null],
          ["Case", r.case_id ? <EntityLink key="case" type="case" id={r.case_id} /> : null],
          ["Approval", r.approval_id ? <EntityLink key="appr" type="approval" id={r.approval_id} /> : null],
          ["Reason", r.reason],
          ["Object", r.object_id ? <span key="obj">{humanize(r.object_type)} · <EntityLink type={r.object_type} id={r.object_id} /></span> : humanize(r.object_type)],
          ["IP", r.ip ? <Mono key="ip">{r.ip}</Mono> : null],
        ]}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[12px] text-muted">Before</div>
          {r.before_json ? <JsonBlock value={r.before_json} /> : <p className="rounded-[14px] bg-surface-3 p-3.5 text-[12.5px] text-muted">No prior state recorded.</p>}
        </div>
        <div>
          <div className="mb-1.5 text-[12px] text-muted">After</div>
          {r.after_json ? <JsonBlock value={r.after_json} /> : <p className="rounded-[14px] bg-surface-3 p-3.5 text-[12.5px] text-muted">No resulting state recorded.</p>}
        </div>
      </div>
      <div className="rounded-[14px] bg-surface p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-text">Hash chain</span>
          {state === "ok" && <Chip tone="sage">Matches #{r.seq - 1}</Chip>}
          {state === "broken" && <Chip tone="rose">Does not match #{r.seq - 1}</Chip>}
          {state === "unknown" && <Chip tone="neutral">#{r.seq - 1} not on this page</Chip>}
        </div>
        <dl className="space-y-2 text-[12px]">
          <div>
            <dt className="text-muted">Hash</dt>
            <dd className="break-all font-mono text-text-2">{r.hash}</dd>
          </div>
          <div>
            <dt className="text-muted">Previous hash</dt>
            <dd className="break-all font-mono text-text-2">{r.prev_hash ?? "— (first entry)"}</dd>
          </div>
          {prev && (
            <div>
              <dt className="text-muted">Hash of #{prev.seq}</dt>
              <dd className="break-all font-mono text-text-2">{prev.hash}</dd>
            </div>
          )}
        </dl>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          Each entry&apos;s previous hash must equal the hash of the entry before it. Because every hash covers the entry&apos;s content and the previous hash, changing or removing any past entry breaks
          every link after it, which makes tampering evident.
        </p>
      </div>
    </div>
  );
}

// ───────────────────────── Data access log ─────────────────────────

function Fields({ fields }: { fields: string | null }) {
  if (!fields) return <span className="text-faint">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {fields
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean)
        .map((f) =>
          f.includes("unmasked") ? (
            <Chip key={f} tone="peach">
              {humanize(f.replace(/_unmasked$/, ""))} · unmasked
            </Chip>
          ) : (
            <Chip key={f} tone="neutral">
              {humanize(f)}
            </Chip>
          ),
        )}
    </span>
  );
}

function DataAccessTab() {
  const list = usePagedList<DataAccessLog>("/data_access_logs", 50);
  return (
    <Card>
      <CardHeader
        title="Data access log"
        subtitle="Views of sensitive records are logged automatically: who opened which profile, case or money-flow view, when and from where. Unmasked personal data is highlighted."
      />
      <Loadable q={list} skeleton={<SkeletonRows rows={8} />}>
        {() => (
          <>
            <Table
              rows={list.rows}
              rowKey={(r) => r.id}
              empty={<Empty title="No record views logged yet">Opening a user profile, merchant, case or fund-flow view adds an entry here.</Empty>}
              columns={[
                { key: "when", header: "When", render: (r) => <When at={r.created_at} /> },
                { key: "who", header: "Staff member", render: (r) => <Person id={r.admin_user_id} /> },
                {
                  key: "object",
                  header: "Record",
                  render: (r) => (
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="text-[11.5px] text-muted">{humanize(r.object_type)}</span>
                      <EntityLink type={r.object_type} id={r.object_id} />
                    </div>
                  ),
                },
                { key: "fields", header: "Viewed", render: (r) => <Fields fields={r.fields} /> },
                { key: "action", header: "Action", render: (r) => <span className="text-text-2">{humanize(r.action) || "Viewed"}</span> },
                { key: "reason", header: "Reason", render: (r) => (r.reason ? <span className="text-text-2">{r.reason}</span> : <span className="text-faint">—</span>) },
                { key: "ip", header: "IP", render: (r) => (r.ip ? <Mono>{r.ip}</Mono> : <span className="text-faint">—</span>) },
              ]}
            />
            <Pager page={list.page} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
          </>
        )}
      </Loadable>
    </Card>
  );
}
