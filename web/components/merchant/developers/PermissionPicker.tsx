"use client";

import { useEffect, useRef } from "react";
import { ALL_MERCHANT_PERMISSIONS, permissionGroups } from "@/lib/merchant/permissions";
import { titleCase } from "@/lib/format";
import { cx } from "@/components/ui";

const GROUP_LABELS: Record<string, string> = { org: "Organization", developers: "Developers", copilot: "Copilot" };

/** Restricted-key permission picker, grouped by resource with a select-all per group. */
export function PermissionPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const groups = permissionGroups(ALL_MERCHANT_PERMISSIONS);
  const selected = new Set(value);
  const toggle = (perms: string[], on: boolean) => {
    const next = new Set(selected);
    for (const p of perms) {
      if (on) next.add(p);
      else next.delete(p);
    }
    onChange(ALL_MERCHANT_PERMISSIONS.filter((p) => next.has(p)));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted">
        <span>{value.length} of {ALL_MERCHANT_PERMISSIONS.length} permissions selected</span>
        <span className="flex gap-1">
          <button type="button" onClick={() => onChange(ALL_MERCHANT_PERMISSIONS.filter((p) => p.endsWith(".read")))} className="rounded-full bg-surface-2 px-2.5 py-1 hover:bg-surface-3">Read-only</button>
          <button type="button" onClick={() => onChange([])} className="rounded-full bg-surface-2 px-2.5 py-1 hover:bg-surface-3">Clear</button>
        </span>
      </div>
      <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {Object.entries(groups).map(([group, perms]) => {
          const count = perms.filter((p) => selected.has(p)).length;
          return (
            <fieldset key={group} className={cx("rounded-inner p-3 transition", count ? "bg-sage-100/60" : "bg-surface-2")}>
              <legend className="sr-only">{GROUP_LABELS[group] ?? titleCase(group)} permissions</legend>
              <GroupToggle label={GROUP_LABELS[group] ?? titleCase(group)} all={count === perms.length} some={count > 0 && count < perms.length} onChange={(on) => toggle(perms, on)} />
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 pl-6">
                {perms.map((p) => (
                  <label key={p} className="inline-flex items-center gap-1.5 text-[12.5px] text-text-2">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-ink" checked={selected.has(p)} onChange={(e) => toggle([p], e.target.checked)} />
                    <span className="font-mono">{p.slice(group.length + 1)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}

function GroupToggle({ label, all, some, onChange }: { label: string; all: boolean; some: boolean; onChange: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);
  return (
    <label className="flex items-center gap-2 text-[13px] font-medium text-text">
      <input ref={ref} type="checkbox" className="h-4 w-4 accent-ink" checked={all} onChange={(e) => onChange(e.target.checked)} aria-label={`Select all ${label} permissions`} />
      {label}
    </label>
  );
}
