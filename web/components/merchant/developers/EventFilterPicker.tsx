"use client";

import { useState } from "react";
import { Segmented, cx } from "@/components/ui";
import { titleCase } from "@/lib/format";
import { EVENT_GROUPS } from "./shared";

/** Parses an enabled-events CSV into a set of patterns ("*", "payment.*", "invoice.paid"). */
export function parseEvents(csv: string) {
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Event filter for a webhook endpoint. "All events" sends "*"; otherwise each resource can be
 * subscribed whole (`payment.*`, which also covers future types) or type by type.
 */
export function EventFilterPicker({ value, onChange }: { value: string; onChange: (csv: string) => void }) {
  const patterns = parseEvents(value);
  const [mode, setMode] = useState<"all" | "some">(patterns.length === 0 || patterns.includes("*") ? "all" : "some");
  const selected = new Set(patterns.filter((p) => p !== "*"));
  const known = new Set(EVENT_GROUPS.flatMap((g) => [`${g.group}.*`, ...g.types]));
  const custom = [...selected].filter((p) => !known.has(p));

  const emit = (next: Set<string>) => onChange([...next].join(","));
  const toggleGroup = (group: string, types: string[], on: boolean) => {
    const next = new Set(selected);
    types.forEach((t) => next.delete(t));
    if (on) next.add(`${group}.*`);
    else next.delete(`${group}.*`);
    emit(next);
  };
  const toggleType = (group: string, types: string[], t: string, on: boolean) => {
    const next = new Set(selected);
    if (next.has(`${group}.*`)) {
      // Expanding a wildcard into individual types, minus the one being unticked.
      next.delete(`${group}.*`);
      types.forEach((x) => next.add(x));
    }
    if (on) next.add(t);
    else next.delete(t);
    if (types.every((x) => next.has(x))) {
      types.forEach((x) => next.delete(x));
      next.add(`${group}.*`);
    }
    emit(next);
  };

  return (
    <div className="space-y-3">
      <Segmented<"all" | "some">
        value={mode}
        onChange={(m) => {
          setMode(m);
          onChange(m === "all" ? "*" : [...selected].join(","));
        }}
        options={[{ value: "all", label: "All events" }, { value: "some", label: "Selected events" }]}
      />
      {mode === "all" ? (
        <p className="text-[12.5px] text-muted">This endpoint receives every event, including types added in the future.</p>
      ) : (
        <>
          <p className="text-[12.5px] text-muted">
            {selected.size ? `${selected.size} pattern${selected.size === 1 ? "" : "s"} selected.` : "Pick at least one event."} Ticking a whole group subscribes to <code className="font-mono">group.*</code>, which also covers new types.
          </p>
          <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {EVENT_GROUPS.map(({ group, types }) => {
              const whole = selected.has(`${group}.*`);
              const count = whole ? types.length : types.filter((t) => selected.has(t)).length;
              return (
                <fieldset key={group} className={cx("rounded-inner p-3 transition", count ? "bg-sage-100/60" : "bg-surface-2")}>
                  <legend className="sr-only">{titleCase(group)} events</legend>
                  <label className="flex items-center gap-2 text-[13px] font-medium text-text">
                    <input type="checkbox" className="h-4 w-4 accent-ink" checked={whole} onChange={(e) => toggleGroup(group, types, e.target.checked)} />
                    <span>{titleCase(group)}</span>
                    <code className="ml-auto font-mono text-[11.5px] font-normal text-muted">{group}.*</code>
                  </label>
                  <div className="mt-1.5 space-y-0.5 pl-6">
                    {types.map((t) => (
                      <label key={t} className="flex items-center gap-1.5 text-[12.5px] text-text-2">
                        <input type="checkbox" className="h-3.5 w-3.5 accent-ink" checked={whole || selected.has(t)} onChange={(e) => toggleType(group, types, t, e.target.checked)} />
                        <span className="font-mono">{t}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
          {custom.length > 0 && (
            <p className="text-[12.5px] text-muted">Also subscribed: {custom.map((c) => <code key={c} className="mr-1 font-mono">{c}</code>)}</p>
          )}
        </>
      )}
    </div>
  );
}
