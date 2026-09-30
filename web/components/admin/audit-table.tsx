"use client";

import { Fragment, useState } from "react";
import { Chip, cx, Empty } from "@/components/ui";
import { EntityLink, Hash, JsonBlock, Mono, Person, When } from "./kit";
import type { AuditLog } from "./types";

/** Compact audit trail used inside record pages (merchant, case). Click a row to see before/after. */
export function AuditTable({ rows, empty = "No audit events yet." }: { rows: AuditLog[]; empty?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (rows.length === 0) return <Empty title={empty} />;
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full border-separate border-spacing-y-1 text-[13px]">
        <thead>
          <tr className="text-left text-[12px] text-muted">
            <th className="px-3 pb-1 font-normal">Seq</th>
            <th className="px-3 pb-1 font-normal">When</th>
            <th className="px-3 pb-1 font-normal">Actor</th>
            <th className="px-3 pb-1 font-normal">Action</th>
            <th className="px-3 pb-1 font-normal">Object</th>
            <th className="px-3 pb-1 font-normal">Reason</th>
            <th className="px-3 pb-1 font-normal">Hash</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.id}>
              <tr onClick={() => setOpen(open === r.id ? null : r.id)} className="group cursor-pointer">
                <td className="rounded-l-[14px] bg-surface-2 px-3 py-2.5 group-hover:bg-surface-3">
                  <Mono>{r.seq}</Mono>
                </td>
                <td className="bg-surface-2 px-3 py-2.5 group-hover:bg-surface-3">
                  <When at={r.at} />
                </td>
                <td className="bg-surface-2 px-3 py-2.5 group-hover:bg-surface-3">
                  <span className="inline-flex items-center gap-1.5">
                    <Person id={r.actor_id} />
                    <Chip className="!py-0.5">{r.actor_role ?? r.actor_type}</Chip>
                  </span>
                </td>
                <td className="bg-surface-2 px-3 py-2.5 group-hover:bg-surface-3">
                  <Mono className="text-text">{r.action}</Mono>
                </td>
                <td className="bg-surface-2 px-3 py-2.5 group-hover:bg-surface-3">
                  {r.object_id ? <EntityLink type={r.object_type} id={r.object_id} /> : <span className="text-faint">—</span>}
                </td>
                <td className={cx("max-w-[280px] bg-surface-2 px-3 py-2.5 text-text-2 group-hover:bg-surface-3")}>{r.reason ?? <span className="text-faint">—</span>}</td>
                <td className="rounded-r-[14px] bg-surface-2 px-3 py-2.5 group-hover:bg-surface-3">
                  <Hash value={r.hash} n={8} />
                </td>
              </tr>
              {open === r.id && (
                <tr>
                  <td colSpan={7} className="rounded-[14px] bg-surface-2 p-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <div className="mb-1 text-[12px] text-muted">Before</div>
                        {r.before_json ? <JsonBlock value={r.before_json} max="max-h-56" /> : <span className="text-[12.5px] text-faint">—</span>}
                      </div>
                      <div>
                        <div className="mb-1 text-[12px] text-muted">After</div>
                        {r.after_json ? <JsonBlock value={r.after_json} max="max-h-56" /> : <span className="text-[12.5px] text-faint">—</span>}
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-1 text-[12px] text-muted">
                      <span>
                        Request <Mono>{r.request_id ?? "—"}</Mono> · IP <Mono>{r.ip ?? "—"}</Mono>
                        {r.case_id && (
                          <>
                            {" "}
                            · Case <EntityLink type="case" id={r.case_id} />
                          </>
                        )}
                        {r.approval_id && (
                          <>
                            {" "}
                            · Approval <Mono>{r.approval_id}</Mono>
                          </>
                        )}
                      </span>
                      <span className="break-all">
                        Hash <Mono>{r.hash}</Mono>
                      </span>
                      <span className="break-all">
                        Previous hash <Mono>{r.prev_hash ?? "—"}</Mono>
                      </span>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
