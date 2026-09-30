"use client";

/**
 * Admin-console building blocks layered on the shared design system (components/ui.tsx):
 * denser key/value panels, entity links, reason-capturing dialogs, paging and query wrappers.
 */
import Link from "next/link";
import { ReactNode, useEffect, useState } from "react";
import { Button, Card, Chip, cx, Empty, ErrorNote, Field, Modal, Skeleton, StatusChip, Textarea } from "@/components/ui";
import { date, titleCase } from "@/lib/format";
import { resolveWallet, useDirectory, type Query } from "./data";

// ───────────────────────── Text bits ─────────────────────────

export function Mono({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("font-mono text-[12px] tracking-tight text-text-2", className)}>
      {children}
    </span>
  );
}

/** Short, copyable id: `tr_O1En…4R`. */
export function IdTag({ id, full }: { id?: string | null; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!id) return <span className="text-faint">—</span>;
  const short = full || id.length <= 16 ? id : `${id.slice(0, 9)}…${id.slice(-4)}`;
  return (
    <button
      type="button"
      title={copied ? "Copied" : `${id} — click to copy`}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(id).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="rounded-md font-mono text-[12px] tracking-tight text-text-2 hover:bg-surface-3 hover:text-text"
    >
      {copied ? "copied" : short}
    </button>
  );
}

export function Hash({ value, n = 10 }: { value?: string | null; n?: number }) {
  if (!value) return <span className="text-faint">—</span>;
  return (
    <Mono title={value} className="text-muted">
      {value.slice(0, n)}…{value.slice(-4)}
    </Mono>
  );
}

export function When({ at, rel }: { at?: string | null; rel?: boolean }) {
  if (!at) return <span className="text-faint">—</span>;
  return (
    <time dateTime={at} title={new Date(at).toISOString()} className="whitespace-nowrap text-text-2">
      {rel ? relTime(at) : date(at, true)}
    </time>
  );
}

/** Milliseconds until `iso` (negative when past). Admin screens render client-side only, after the session check. */
export function msUntil(iso: string) {
  return new Date(iso).getTime() - Date.now();
}

function relTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const future = diff < 0;
  const a = Math.abs(diff);
  const s = a < 3600 ? `${Math.max(1, Math.floor(a / 60))}m` : a < 86400 ? `${Math.floor(a / 3600)}h` : `${Math.floor(a / 86400)}d`;
  return future ? `in ${s}` : `${s} ago`;
}

export function Country({ code }: { code?: string | null }) {
  if (!code) return <span className="text-faint">—</span>;
  // A circular code avatar rather than an emoji flag: Windows renders flag emoji as bare letters.
  return (
    <span title={code} className="inline-grid h-6 min-w-6 place-items-center rounded-full border border-line bg-surface px-1 text-[10px] font-medium tracking-wide text-text-2">
      {code}
    </span>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="text-[12px] text-muted">{children}</span>;
}

export function Dash() {
  return <span className="text-faint">—</span>;
}

export function humanize(s?: string | null) {
  return s ? titleCase(s) : "";
}

// ───────────────────────── Entity links ─────────────────────────

export type EntityType = "user" | "org" | "organization" | "merchant" | "transfer" | "alert" | "case" | "approval" | "ledger_transaction" | "payout" | "wallet" | "payment" | "provider" | string;

export function entityHref(type: EntityType | null | undefined, id: string | null | undefined): string | null {
  if (!type || !id) return null;
  switch (type) {
    case "user":
      return `/admin/users/${id}`;
    case "org":
    case "organization":
    case "merchant":
      return `/admin/merchants/${id}`;
    case "transfer":
      return `/admin/transactions/${id}`;
    case "alert":
      return `/admin/alerts/${id}`;
    case "case":
      return `/admin/cases/${id}`;
    case "approval":
    case "approval_request":
      return `/admin/approvals`;
    case "ledger_transaction":
      return `/admin/ledger/transactions/${id}`;
    case "payout":
      return `/admin/payouts`;
    default:
      if (id.startsWith("usr_")) return `/admin/users/${id}`;
      if (id.startsWith("org_")) return `/admin/merchants/${id}`;
      if (id.startsWith("tr_")) return `/admin/transactions/${id}`;
      if (id.startsWith("alt_")) return `/admin/alerts/${id}`;
      if (id.startsWith("case_")) return `/admin/cases/${id}`;
      if (id.startsWith("ltx_")) return `/admin/ledger/transactions/${id}`;
      return null;
  }
}

export function EntityLink({ type, id, children, className }: { type?: EntityType | null; id?: string | null; children?: ReactNode; className?: string }) {
  const d = useDirectory();
  if (!id) return <Dash />;
  const href = entityHref(type ?? "", id);
  const org = id.startsWith("org_") ? d.orgs.get(id) : undefined;
  const body = children ?? (org ? <span className="whitespace-nowrap">{org.name}</span> : <IdTagText id={id} />);
  if (!href) return <span className={className}>{body}</span>;
  return (
    <Link href={href} onClick={(e) => e.stopPropagation()} className={cx("text-text underline decoration-line-strong underline-offset-4 hover:decoration-ink", className)}>
      {body}
    </Link>
  );
}

function IdTagText({ id }: { id: string }) {
  return <span className="font-mono text-[12px] tracking-tight">{id.length <= 16 ? id : `${id.slice(0, 9)}…${id.slice(-4)}`}</span>;
}

/** Resolves a user id (actor, assignee, requester) to a name when the role may read users. */
export function Person({ id, link = true }: { id?: string | null; link?: boolean }) {
  const d = useDirectory();
  if (!id) return <span className="text-muted">Unassigned</span>;
  if (id === "system" || id === "scheduler" || id === "seed") return <span className="text-text-2">{id === "system" ? "System" : titleCase(id)}</span>;
  const u = d.users.get(id);
  const label = u ? (
    <span className="whitespace-nowrap" title={u.platform_role ? `Platform staff · ${u.platform_role}` : undefined}>
      {u.name}
    </span>
  ) : (
    <IdTagText id={id} />
  );
  if (!link || !id.startsWith("usr_")) return label;
  return <EntityLink type="user" id={id}>{label}</EntityLink>;
}

/** Wallet id → handle, linked to the owning user or merchant. */
export function WalletRef({ id }: { id?: string | null }) {
  const d = useDirectory();
  useEffect(() => {
    if (id) resolveWallet(id);
  }, [id]);
  if (!id) return <Dash />;
  const w = d.wallets.get(id);
  if (!w) return <EntityLink id={id} />;
  const owner = w.owner_type === "user" ? d.users.get(w.owner_id) : undefined;
  return (
    <EntityLink type={w.owner_type === "user" ? "user" : "org"} id={w.owner_id}>
      <span className="whitespace-nowrap">{owner ? owner.name : w.handle}</span>
      {owner && <span className="ml-1 text-[11.5px] text-muted">{w.handle}</span>}
    </EntityLink>
  );
}

// ───────────────────────── Layout bits ─────────────────────────

export function Panel({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-inner bg-surface-2 p-5", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h3 className="text-[14px] font-medium text-text">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

/** Dense key/value grid for record details. */
export function KV({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cx("grid gap-x-6 gap-y-3", cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3")}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[12px] text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-[13.5px] text-text">{v === null || v === undefined || v === "" ? <Dash /> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number; hidden?: boolean }[] }) {
  return (
    <div role="tablist" className="mb-5 flex flex-wrap gap-1 rounded-full bg-surface p-1 shadow-card sm:inline-flex">
      {tabs
        .filter((t) => !t.hidden)
        .map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={t.value === value}
            onClick={() => onChange(t.value)}
            className={cx("inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition", t.value === value ? "bg-ink text-white" : "text-text-2 hover:bg-surface-2")}
          >
            {t.label}
            {t.count !== undefined && <span className={cx("rounded-full px-1.5 text-[11px]", t.value === value ? "bg-white/20" : "bg-surface-3 text-muted")}>{t.count}</span>}
          </button>
        ))}
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end gap-2.5">{children}</div>;
}

/** Compact select/input for filter bars. */
export const filterClass =
  "h-9 rounded-full border border-line bg-surface px-3.5 text-[13px] text-text outline-none transition focus:border-sage-500 focus:ring-4 focus:ring-sage-100";

export function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="pl-2 text-[11.5px] text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cx(filterClass, "appearance-none pr-8")}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterInput({
  label,
  value,
  onChange,
  placeholder,
  width = "w-40",
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: string;
  type?: "text" | "date" | "number";
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="pl-2 text-[11.5px] text-muted">{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cx(filterClass, width, "placeholder:text-faint")} />
    </label>
  );
}

export function Pager({ page, hasMore, onPrev, onNext, loading }: { page: number; hasMore: boolean; onPrev: () => void; onNext: () => void; loading?: boolean }) {
  if (page === 1 && !hasMore) return null;
  return (
    <div className="mt-4 flex items-center justify-end gap-2 text-[12.5px] text-muted">
      <span>Page {page}</span>
      <Button size="sm" variant="soft" onClick={onPrev} disabled={page === 1 || loading}>
        Previous
      </Button>
      <Button size="sm" variant="soft" onClick={onNext} disabled={!hasMore || loading}>
        Next
      </Button>
    </div>
  );
}

/** Shows a skeleton, the error, or the content of a query. */
export function Loadable<T>({ q, children, skeleton, empty }: { q: Query<T>; children: (data: T) => ReactNode; skeleton?: ReactNode; empty?: (data: T) => boolean }) {
  if (q.error && !q.data) return <ErrorNote error={q.error} />;
  if (!q.data) return <>{skeleton ?? <SkeletonRows />}</>;
  if (empty?.(q.data)) return <Empty title="Nothing here yet" />;
  return (
    <>
      {q.error ? (
        <div className="mb-3">
          <ErrorNote error={q.error} />
        </div>
      ) : null}
      {children(q.data)}
    </>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-10 w-72" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

/** Full-page state for missing permissions — the nav also hides these routes. */
export function NoAccess({ perm }: { perm: string }) {
  return (
    <Card>
      <Empty title="Not available for your role" icon={<span className="text-lg">⌀</span>}>
        This area needs the <Mono>{perm}</Mono> permission. Ask a super admin if you need access.
      </Empty>
    </Card>
  );
}

/** Small grey note explaining why an action is missing (read-only roles). */
export function ReadOnlyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-full bg-surface-2 px-3.5 py-1.5 text-[12px] text-muted">{children}</p>;
}

export function Notice({ tone = "sage", children }: { tone?: "sage" | "lemon" | "peach" | "sky"; children: ReactNode }) {
  const tones = { sage: "bg-sage-100 text-sage-700", lemon: "bg-lemon-soft text-lemon-ink", peach: "bg-peach-soft text-peach-ink", sky: "bg-sky-soft text-sky-ink" } as const;
  return (
    <div role="status" className={cx("rounded-inner px-4 py-3 text-[13px]", tones[tone])}>
      {children}
    </div>
  );
}

export function JsonBlock({ value, max = "max-h-80" }: { value: unknown; max?: string }) {
  let text: string;
  if (typeof value === "string") {
    try {
      text = JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      text = value;
    }
  } else text = JSON.stringify(value, null, 2);
  return <pre className={cx("overflow-auto rounded-[14px] bg-surface-3 p-3.5 font-mono text-[11.5px] leading-relaxed text-text-2", max)}>{text}</pre>;
}

export function Bool({ value, yes = "Yes", no = "No" }: { value: boolean | null | undefined; yes?: string; no?: string }) {
  return value ? <Chip tone="sage">{yes}</Chip> : <Chip tone="neutral">{no}</Chip>;
}

export { StatusChip };

// ───────────────────────── Dialogs ─────────────────────────

/**
 * Every consequential admin action records a reason (URS: "every action needs a recorded reason").
 * The dialog enforces a minimum length and shows what will happen before the call is made.
 */
export function ReasonDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel = "Confirm",
  label = "Reason",
  placeholder = "Describe the basis for this action. It is stored in the audit log.",
  minLength = 10,
  tone = "ink",
  onSubmit,
  children,
  canSubmit = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  label?: string;
  placeholder?: string;
  minLength?: number;
  tone?: "ink" | "danger" | "lemon";
  onSubmit: (reason: string) => Promise<unknown>;
  children?: ReactNode;
  canSubmit?: boolean;
}) {
  return open ? (
    <ReasonDialogBody
      onClose={onClose}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      label={label}
      placeholder={placeholder}
      minLength={minLength}
      tone={tone}
      onSubmit={onSubmit}
      canSubmit={canSubmit}
    >
      {children}
    </ReasonDialogBody>
  ) : null;
}

function ReasonDialogBody({
  onClose,
  title,
  description,
  confirmLabel,
  label,
  placeholder,
  minLength,
  tone,
  onSubmit,
  children,
  canSubmit,
}: {
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  label: string;
  placeholder: string;
  minLength: number;
  tone: "ink" | "danger" | "lemon";
  onSubmit: (reason: string) => Promise<unknown>;
  children?: ReactNode;
  canSubmit: boolean;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tooShort = reason.trim().length < minLength;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={tone} onClick={submit} loading={busy} disabled={tooShort || !canSubmit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {description && <div className="text-[13.5px] leading-relaxed text-text-2">{description}</div>}
        {children}
        <Field label={label} hint={tooShort ? `At least ${minLength} characters. Recorded in the audit log.` : "Recorded in the audit log with your name and time."}>
          <Textarea autoFocus value={reason} placeholder={placeholder} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  children,
  confirmLabel = "Confirm",
  tone = "ink",
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  confirmLabel?: string;
  tone?: "ink" | "danger" | "lemon";
  onConfirm: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!open) return null;
  return (
    <Modal
      open
      onClose={() => {
        setError(null);
        onClose();
      }}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={tone}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-[13.5px] leading-relaxed text-text-2">
        {children}
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}

/** Numbers in the reference style but compact enough for dense grids. */
export function Num({ value, suffix, className }: { value: number | null | undefined; suffix?: ReactNode; className?: string }) {
  if (value === null || value === undefined) return <Dash />;
  return (
    <span className={cx("numeral inline-flex items-baseline gap-1 text-[30px] font-light leading-none text-text", className)}>
      {value.toLocaleString("en-US")}
      {suffix && <span className="text-[12px] font-normal tracking-normal text-muted">{suffix}</span>}
    </span>
  );
}

export function SlaChip({ due, closed }: { due: string; closed?: boolean }) {
  if (closed) return <Chip tone="neutral">Closed</Chip>;
  const ms = msUntil(due);
  if (ms < 0) return <Chip tone="rose">Overdue · due {relTime(due)}</Chip>;
  if (ms < 86400_000) return <Chip tone="peach">Due {relTime(due)}</Chip>;
  return <Chip tone="sage">Due {relTime(due)}</Chip>;
}
