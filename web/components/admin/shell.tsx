"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { Chip, cx, Skeleton, Spinner } from "@/components/ui";
import { adminApi, useAdminQuery, useDirectory } from "./data";
import { Icons } from "./icons";
import { NoAccess, PageSkeleton } from "./kit";
import { isActive, NAV } from "./nav";
import { AdminSessionProvider, ROLE_LABELS, useAdmin } from "./session";
import type { Overview, SearchResult } from "./types";

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <AdminSessionProvider>
      <Chrome>{children}</Chrome>
    </AdminSessionProvider>
  );
}

function Chrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, signedOut } = useAdmin();
  const isLogin = pathname === "/admin/login";

  useEffect(() => {
    if (status === "anonymous" && !isLogin) router.replace(signedOut ? "/admin/login" : `/admin/login?next=${encodeURIComponent(pathname)}`);
  }, [status, signedOut, isLogin, pathname, router]);

  if (isLogin) return <>{children}</>;
  if (status !== "ready") {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex items-center gap-3 text-[13px] text-muted">
          <Spinner /> Checking your staff session…
        </div>
      </div>
    );
  }
  return <Frame>{children}</Frame>;
}

function Frame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }
  return (
    <div className="flex min-h-screen w-full">
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-40 w-[252px] shrink-0 p-3 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Sidebar />
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-[rgba(29,31,30,0.2)] lg:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setOpen(true)} />
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 pb-16 pt-2 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const { canAny, can } = useAdmin();
  const overview = useAdminQuery<Overview>(can("admin.overview") ? "/overview" : null);
  const o = overview.data;
  const reloadBadges = overview.reload;
  useEffect(() => {
    window.addEventListener("pa:admin-changed", reloadBadges);
    return () => window.removeEventListener("pa:admin-changed", reloadBadges);
  }, [reloadBadges]);
  const badges: Record<string, number | undefined> = {
    alerts: o && can("admin.aml.read") ? o.aml_alerts_open + o.sanctions_alerts_open : undefined,
    cases: o && can("admin.aml.read") ? o.open_cases : undefined,
    approvals: o ? o.pending_approvals : undefined,
    recon: o ? o.recon_exceptions_open : undefined,
  };
  return (
    <nav aria-label="Admin" className="glass flex h-full flex-col overflow-y-auto rounded-card p-3 shadow-card">
      <Link href="/admin" className="mb-4 flex items-center gap-2.5 px-2.5 pt-2">
        <span className="grid h-9 w-9 place-items-center rounded-full sage-gradient text-[15px] font-medium text-sage-700">◎</span>
        <span className="leading-tight">
          <span className="block text-[14px] font-medium text-text">Monetization Platform</span>
          <span className="block text-[11.5px] text-muted">Admin, risk &amp; audit</span>
        </span>
      </Link>
      <ul className="space-y-0.5">
        {NAV.filter((n) => canAny(...n.perms)).map((n) => {
          const active = isActive(pathname, n.href);
          const count = n.badge ? badges[n.badge] : undefined;
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex h-10 items-center gap-3 rounded-full px-3.5 text-[13.5px] transition",
                  active ? "bg-ink text-white" : "text-text-2 hover:bg-white/70 hover:text-text",
                )}
              >
                <span className={active ? "text-white" : "text-muted"}>{Icons[n.icon as keyof typeof Icons]}</span>
                <span className="flex-1">{n.label}</span>
                {!!count && (
                  <span className={cx("min-w-6 rounded-full px-1.5 text-center text-[11px] font-medium leading-5", active ? "bg-white/20 text-white" : n.badge === "alerts" ? "bg-peach-soft text-peach-ink" : "bg-lemon-soft text-lemon-ink")}>
                    {count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto px-2.5 pb-1 pt-5 text-[11.5px] leading-relaxed text-faint">
        Risk signals are prompts for review, not findings of wrongdoing. Every action is recorded.
      </div>
    </nav>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { me, role, logout, can } = useAdmin();
  return (
    <header className="sticky top-0 z-20 px-4 pb-3 pt-3 sm:px-6 lg:px-8">
      <div className="glass mx-auto flex max-w-[1320px] items-center gap-3 rounded-full px-2.5 py-2 shadow-card">
        <button onClick={onMenu} aria-label="Open navigation" className="grid h-9 w-9 place-items-center rounded-full text-text-2 hover:bg-surface-2 lg:hidden">
          {Icons.menu}
        </button>
        {can("admin.users.read") ? <GlobalSearch /> : <div className="flex-1 px-3 text-[13px] text-muted">Search isn&apos;t available for your role</div>}
        <Chip tone="lemon" className="!hidden md:!inline-flex">
          Sandbox data
        </Chip>
        <span title="Your platform role" className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full bg-ink px-3 text-[12px] font-medium text-white">
          <span className="h-1.5 w-1.5 rounded-full bg-lemon" />
          {ROLE_LABELS[role ?? ""] ?? role}
        </span>
        <span className="hidden max-w-40 truncate text-[13px] text-text-2 md:inline">{me?.user.name}</span>
        <button
          onClick={() => void logout()}
          title="Sign out"
          aria-label="Sign out"
          className="grid h-9 w-9 place-items-center rounded-full text-text-2 hover:bg-surface-2"
        >
          {Icons.logout}
        </button>
      </div>
    </header>
  );
}

type Hit = { href: string; label: string; sub: string; group: string; userId?: string };

function GlobalSearch() {
  const router = useRouter();
  const dir = useDirectory();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ q: string; hits: Hit[]; error: string | null }>({ q: "", hits: [], error: null });
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const term = q.trim();

  useEffect(() => {
    if (term.length < 3) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const r = await adminApi<SearchResult>(`/search?q=${encodeURIComponent(term)}`);
        if (alive) setState({ q: term, hits: toHits(r), error: null });
      } catch (e) {
        if (alive) setState({ q: term, hits: [], error: (e as Error).message });
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [term]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        box.current?.querySelector("input")?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const loading = term.length >= 3 && state.q !== term;
  const hits = state.q === term ? state.hits : [];
  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    router.push(h.href);
  };

  return (
    <div ref={box} className="relative min-w-[120px] flex-1">
      <div className="flex h-9 items-center gap-2 rounded-full bg-surface-2 px-3.5 text-muted focus-within:ring-4 focus-within:ring-sage-100">
        {Icons.search}
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && hits[active]) go(hits[active]);
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search users, merchants, IDs, emails, IPs…  ( / )"
          aria-label="Global search"
          className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-text outline-none placeholder:text-faint"
        />
        {loading && <Spinner className="h-3.5 w-3.5" />}
      </div>
      {open && term.length > 0 && (
        <div className="card absolute left-0 right-0 top-11 z-50 max-h-[70vh] overflow-auto p-2 shadow-float sm:right-auto sm:w-[520px]">
          {term.length < 3 ? (
            <p className="px-3 py-2.5 text-[12.5px] text-muted">Type at least 3 characters.</p>
          ) : loading && hits.length === 0 ? (
            <div className="space-y-1.5 p-1">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : state.error ? (
            <p className="px-3 py-2.5 text-[12.5px] text-rose-ink">{state.error}</p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-2.5 text-[12.5px] text-muted">No matches for “{term}”. Search matches exact ids, emails, wallet handles, IPs and names.</p>
          ) : (
            <ul>
              {hits.map((h, i) => (
                <li key={h.href + i}>
                  {(i === 0 || hits[i - 1].group !== h.group) && <div className="px-3 pb-1 pt-2 text-[11px] uppercase tracking-[0.08em] text-faint">{h.group}</div>}
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(h)}
                    className={cx("flex w-full items-center justify-between gap-3 rounded-[14px] px-3 py-2 text-left", i === active ? "bg-surface-2" : "")}
                  >
                    <span className="min-w-0 truncate text-[13.5px] text-text">{(h.userId && dir.users.get(h.userId)?.name) || h.label}</span>
                    <span className="shrink-0 text-[12px] text-muted">{h.sub}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function toHits(r: SearchResult): Hit[] {
  const hits: Hit[] = [];
  r.users.forEach((u) => hits.push({ group: "Users", href: `/admin/users/${u.id}`, label: u.name, sub: `${u.email} · ${u.status.toLowerCase()}` }));
  r.merchants.forEach((m) => hits.push({ group: "Merchants", href: `/admin/merchants/${m.id}`, label: m.name, sub: m.status.replace(/_/g, " ").toLowerCase() }));
  r.wallets.forEach((w) => hits.push({ group: "Wallets", href: w.owner_type === "user" ? `/admin/users/${w.owner_id}` : `/admin/merchants/${w.owner_id}`, label: w.handle, sub: w.id }));
  r.transfers.forEach((t) => hits.push({ group: "Transfers", href: `/admin/transactions/${t.id}`, label: `${t.type} · ${t.status.toLowerCase()}`, sub: t.id }));
  r.payments.forEach((p) => hits.push({ group: "Payments", href: `/admin/merchants/${p.org_id}`, label: `${p.id} · ${p.status.toLowerCase()}`, sub: p.currency }));
  r.cases.forEach((c) => hits.push({ group: "Cases", href: `/admin/cases/${c.id}`, label: c.title, sub: c.status.toLowerCase() }));
  r.devices.forEach((d) => hits.push({ group: "Devices", href: `/admin/users/${d.user_id}`, label: d.platform ?? d.id, sub: d.id }));
  const ipUsers = [...new Set(r.ip_sessions.map((s) => s.user_id))];
  ipUsers.forEach((u) => hits.push({ group: "Sessions from this IP", href: `/admin/users/${u}`, label: u, sub: "signed in from this IP", userId: u }));
  r.invoices.forEach((i) => hits.push({ group: "Invoices", href: `/admin/merchants/${i.org_id}`, label: i.number, sub: i.status }));
  r.subscriptions.forEach((s) => hits.push({ group: "Subscriptions", href: `/admin/merchants/${s.org_id}`, label: s.id, sub: s.status }));
  return hits;
}

/** Page-level permission gate. The nav hides these routes too; the API is the real enforcement. */
export function Guard({ perm, any, children }: { perm?: string; any?: string[]; children: ReactNode }) {
  const { can, canAny, status } = useAdmin();
  if (status !== "ready") return <PageSkeleton />;
  const ok = perm ? can(perm) : any ? canAny(...any) : true;
  if (!ok) return <NoAccess perm={perm ?? (any ?? []).join(" or ")} />;
  // Pages read their initial filters from the URL (useSearchParams), which needs a Suspense boundary.
  return <Suspense fallback={<PageSkeleton />}>{children}</Suspense>;
}
