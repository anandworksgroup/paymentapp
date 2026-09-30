"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, session } from "@/lib/api";
import { NAV } from "@/lib/merchant/nav";
import { useFeatures, useIncidents } from "@/lib/merchant/platform";
import { cx } from "@/components/ui";
import { useMerchant } from "./context";
import { Icon } from "./icons";
import { CommandPalette } from "./CommandPalette";
import { CopilotPanel } from "./Copilot";
import { IncidentBanner, RecentIncidents } from "./ops/IncidentBanner";

export function Shell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const [copilot, setCopilot] = useState(false);
  const pathname = usePathname();
  const { live, org } = useMerchant();
  const incidents = useIncidents();
  const { on } = useFeatures(org.id);
  const copilotOn = on("copilot");

  // ⌘K / Ctrl+K opens the command palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the mobile drawer after navigating.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setDrawer(false);
  }

  return (
    <div className={cx("min-h-screen", !live && "border-t-[3px] border-lemon")}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <div className="lg:flex">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block lg:w-[264px] lg:shrink-0">
          <div className="sticky top-0 h-screen overflow-y-auto p-4 pr-2">
            <Sidebar />
          </div>
        </aside>

        {/* Mobile drawer */}
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <div className="absolute inset-0 bg-[rgba(29,31,30,0.28)] backdrop-blur-sm" onClick={() => setDrawer(false)} />
            <div className="absolute inset-y-0 left-0 w-[284px] max-w-[86vw] overflow-y-auto p-3">
              <Sidebar onClose={() => setDrawer(false)} />
            </div>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <Header onMenu={() => setDrawer(true)} onSearch={() => setPalette(true)} onCopilot={copilotOn ? () => setCopilot(true) : undefined} statusSlot={<RecentIncidents recent={incidents.recent} />} />
          <main id="main" className="mx-auto w-full max-w-[1320px] px-4 pb-16 pt-2 sm:px-6 lg:px-8">
            <IncidentBanner active={incidents.active} />
            {children}
          </main>
        </div>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} onCopilot={copilotOn ? () => { setPalette(false); setCopilot(true); } : undefined} />
      <CopilotPanel open={copilot && copilotOn} onClose={() => setCopilot(false)} />
    </div>
  );
}

function Sidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const { can, org } = useMerchant();
  const { on } = useFeatures(org.id);
  const isActive = (href: string) => (href === "/developers" || href === "/settings" ? pathname === href : pathname === href || pathname.startsWith(href + "/"));
  return (
    <nav aria-label="Main" className="glass flex min-h-full flex-col rounded-card p-3 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <OrgSwitcher />
        {onClose && (
          <button aria-label="Close navigation" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      <div className="flex-1 space-y-4">
        {NAV.map((section, i) => {
          const items = section.items.filter((it) => can(it.perm) && on(it.flag));
          if (!items.length) return null;
          return (
            <div key={i}>
              {section.label && <div className="mb-1 px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">{section.label}</div>}
              <ul className="space-y-0.5">
                {items.map((it) => {
                  const active = isActive(it.href);
                  return (
                    <li key={it.href}>
                      <Link
                        href={it.href}
                        aria-current={active ? "page" : undefined}
                        className={cx(
                          "flex h-9 items-center gap-2.5 rounded-full px-3 text-[13.5px] transition",
                          active ? "bg-ink text-white" : "text-text-2 hover:bg-white/80 hover:text-text",
                        )}
                      >
                        <Icon name={it.icon} size={17} />
                        {it.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function OrgSwitcher() {
  const { me, org, switchOrg } = useMerchant();
  const [open, setOpen] = useState(false);
  const ref = useOutside<HTMLDivElement>(() => setOpen(false));
  const initials = org.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 rounded-[18px] p-1.5 text-left transition hover:bg-white/70"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full sage-gradient text-[12.5px] font-medium text-sage-700">{initials}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-text">{org.name}</span>
          <span className="block truncate text-[11.5px] text-muted">{org.role} · {org.default_currency}</span>
        </span>
        <Icon name="chevron" size={16} className="text-muted" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 rounded-inner bg-surface p-1.5 shadow-float" role="listbox" aria-label="Organizations">
          {me.organizations.map((o) => (
            <button
              key={o.id}
              role="option"
              aria-selected={o.id === org.id}
              onClick={() => { setOpen(false); if (o.id !== org.id) switchOrg(o.id); }}
              className={cx("flex w-full items-center justify-between gap-2 rounded-[12px] px-3 py-2 text-left text-[13px] hover:bg-surface-2", o.id === org.id && "bg-surface-2")}
            >
              <span className="truncate">{o.name}</span>
              {o.id === org.id && <Icon name="check" size={15} className="text-sage-700" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Header({ onMenu, onSearch, onCopilot, statusSlot }: { onMenu: () => void; onSearch: () => void; onCopilot?: () => void; statusSlot?: ReactNode }) {
  const { can } = useMerchant();
  return (
    <header className="sticky top-0 z-30 bg-gradient-to-b from-bg via-bg/90 to-transparent px-4 pb-4 pt-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1320px] items-center gap-2 sm:gap-3">
        <button aria-label="Open navigation" onClick={onMenu} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface shadow-card lg:hidden">
          <Icon name="menu" />
        </button>
        <button
          onClick={onSearch}
          className="glass flex h-10 w-10 shrink-0 items-center justify-center gap-2.5 rounded-full text-left text-[13px] text-muted shadow-card transition hover:text-text-2 sm:w-auto sm:min-w-0 sm:max-w-sm sm:flex-1 sm:shrink sm:justify-start sm:px-4"
          aria-label="Search and quick actions (Control K)"
        >
          <Icon name="search" size={16} />
          <span className="hidden truncate sm:inline">Search customers, payments…</span>
          <kbd className="ml-auto hidden rounded-md bg-surface-3 px-1.5 py-0.5 font-sans text-[11px] text-text-2 sm:inline">Ctrl K</kbd>
        </button>
        <div className="ml-auto flex items-center gap-2">
          {statusSlot}
          <ModeToggle />
          {can("copilot.use") && onCopilot && (
            <button onClick={onCopilot} className="flex h-10 items-center gap-2 rounded-full bg-ink px-3.5 text-[13px] font-medium text-white shadow-card transition hover:bg-ink-2" aria-label="Open copilot">
              <Icon name="sparkle" size={16} />
              <span className="hidden sm:inline">Copilot</span>
            </button>
          )}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

/** Always-visible test/live indicator. Live stays disabled until the org is in production. */
function ModeToggle() {
  const { live, setLive, canGoLive } = useMerchant();
  return (
    <div className="glass flex h-10 items-center gap-2 rounded-full pl-1.5 pr-3 shadow-card">
      <span className={cx("rounded-full px-2.5 py-1 text-[11.5px] font-semibold", live ? "bg-ink text-white" : "bg-lemon text-lemon-ink")}>
        {live ? "Live" : "Test mode"}
      </span>
      <label className={cx("flex items-center gap-2 text-[12.5px]", canGoLive ? "cursor-pointer text-text-2" : "cursor-not-allowed text-faint")} title={canGoLive ? undefined : "Live mode unlocks after go-live"}>
        <span className="hidden md:inline">Live</span>
        <input
          type="checkbox"
          role="switch"
          aria-label={canGoLive ? "Live mode" : "Live mode (available after go-live)"}
          checked={live}
          disabled={!canGoLive}
          onChange={(e) => setLive(e.target.checked)}
          className="peer sr-only"
        />
        <span aria-hidden className={cx("relative h-5 w-9 rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-sage-700", live ? "bg-ink" : "bg-surface-3")}>
          <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", live ? "left-[18px]" : "left-0.5")} />
        </span>
      </label>
    </div>
  );
}

function UserMenu() {
  const { me } = useMerchant();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useOutside<HTMLDivElement>(() => setOpen(false));
  const initials = me.user.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const signOut = async () => {
    try {
      await api("/v1/auth/logout", { method: "POST", noOrg: true });
    } catch {
      /* the local session is cleared regardless */
    }
    session.clear();
    router.replace("/login");
  };
  return (
    <div ref={ref} className="relative">
      <button aria-label="Account menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="grid h-10 w-10 place-items-center rounded-full bg-peach-soft text-[13px] font-medium text-peach-ink shadow-card">
        {initials}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-64 rounded-inner bg-surface p-2 shadow-float">
          <div className="px-3 py-2">
            <div className="truncate text-[14px] font-medium">{me.user.name}</div>
            <div className="truncate text-[12px] text-muted">{me.user.email}</div>
          </div>
          <div className="my-1 h-px bg-line" />
          <Link role="menuitem" href="/settings/security" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-[12px] px-3 py-2 text-[13px] text-text-2 hover:bg-surface-2">
            <Icon name="lock" size={16} /> Security
          </Link>
          <button role="menuitem" onClick={signOut} className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-[13px] text-text-2 hover:bg-surface-2">
            <Icon name="logout" size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function useOutside<T extends HTMLElement>(onOutside: () => void) {
  const ref = useRef<T>(null);
  const cb = useRef(onOutside);
  useEffect(() => {
    cb.current = onOutside;
  });
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && cb.current();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, []);
  return ref;
}
