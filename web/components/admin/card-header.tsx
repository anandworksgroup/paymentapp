import type { ReactNode } from "react";

/**
 * Same look as CardHeader in components/ui, but the action slot never shrinks or wraps — dense admin
 * cards often carry a button or segmented control next to a long subtitle.
 */
export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-[19px] font-medium tracking-[-0.01em] text-text">{title}</h2>
        {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">{action}</div>}
    </div>
  );
}
