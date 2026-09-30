"use client";

import { cx } from "@/components/ui";
import { CheckDot } from "./shared";
import type { CloseCheck } from "./types";

/** The month-end close checklist (§230): blocking checks must pass; advisory ones only warn. */
export function CloseChecklist({ checks }: { checks: CloseCheck[] }) {
  return (
    <ul className="space-y-2">
      {checks.map((c) => {
        const state = c.passed ? "pass" : c.blocking ? "block" : "warn";
        return (
          <li key={c.key} className={cx("flex items-start gap-3 rounded-inner px-4 py-3.5", state === "block" ? "bg-rose-soft/60" : state === "warn" ? "bg-peach-soft/60" : "bg-surface-2")}>
            <CheckDot state={state} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] text-text">{c.label}</span>
                <span className="text-[11.5px] text-muted">{c.blocking ? "Required" : "Recommended"}</span>
              </div>
              {c.detail && <p className="mt-0.5 text-[12.5px] leading-relaxed text-text-2">{c.detail}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
