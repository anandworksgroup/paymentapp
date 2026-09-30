"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type List } from "@/lib/api";
import { money } from "@/lib/format";
import { ALL_NAV_ITEMS } from "@/lib/merchant/nav";
import type { Customer, Payment } from "@/lib/merchant/types";
import { useDebounced } from "@/lib/merchant/hooks";
import { cx, Spinner, StatusChip } from "@/components/ui";
import { useMerchant } from "./context";
import { Icon } from "./icons";

type Item = { id: string; group: string; label: string; hint?: string; icon: string; run: () => void; chip?: string };

/** ⌘K palette (§331): search customers and payments, jump to pages, run quick actions. */
export function CommandPalette({ open, onClose, onCopilot }: { open: boolean; onClose: () => void; onCopilot: () => void }) {
  if (!open) return null;
  return <PaletteBody onClose={onClose} onCopilot={onCopilot} />;
}

function PaletteBody({ onClose, onCopilot }: { onClose: () => void; onCopilot: () => void }) {
  const router = useRouter();
  const { can } = useMerchant();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const term = useDebounced(q.trim(), 220);
  const [remote, setRemote] = useState<{ term: string; customers: Customer[]; payments: Payment[] }>({ term: "", customers: [], payments: [] });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (term.length < 2) return;
    let alive = true;
    const enc = encodeURIComponent(term);
    Promise.all([
      can("customers.read") ? api<List<Customer>>(`/v1/customers?search=${enc}&limit=5`).then((r) => r.data, () => []) : Promise.resolve([] as Customer[]),
      can("payments.read") && term.length > 2 ? api<List<Payment>>(`/v1/payments?search=${enc}&limit=5`).then((r) => r.data, () => []) : Promise.resolve([] as Payment[]),
    ]).then(([customers, payments]) => alive && setRemote({ term, customers, payments }));
    return () => {
      alive = false;
    };
  }, [term, can]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const items = useMemo<Item[]>(() => {
    const lower = q.trim().toLowerCase();
    const actions: Item[] = [
      can("checkout.write") && { id: "a-link", group: "Quick actions", label: "Create payment link", icon: "link", run: () => go("/payment-links?new=1") },
      can("products.write") && { id: "a-product", group: "Quick actions", label: "Create product", icon: "box", run: () => go("/products?new=1") },
      can("developers.read") && { id: "a-logs", group: "Quick actions", label: "Open API logs", icon: "list", run: () => go("/developers/logs") },
      can("customers.write") && { id: "a-customer", group: "Quick actions", label: "Create customer", icon: "users", run: () => go("/customers?new=1") },
      can("copilot.use") && { id: "a-copilot", group: "Quick actions", label: "Ask the copilot", icon: "sparkle", run: onCopilot },
    ].filter(Boolean) as Item[];
    const pages: Item[] = ALL_NAV_ITEMS.filter((n) => can(n.perm)).map((n) => ({
      id: `p-${n.href}`, group: "Go to", label: n.label, hint: n.section, icon: n.icon, run: () => go(n.href),
    }));
    const match = (s: string) => !lower || s.toLowerCase().includes(lower);
    const out = [...actions.filter((a) => match(a.label)), ...pages.filter((p) => match(p.label) || match(p.hint ?? "")).slice(0, lower ? 8 : 6)];
    if (remote.term && remote.term === term) {
      out.push(
        ...remote.customers.map((c) => ({ id: c.id, group: "Customers", label: c.name || c.email || c.id, hint: c.email ?? c.id, icon: "users", run: () => go(`/customers/${c.id}`) })),
        ...remote.payments.map((p) => ({ id: p.id, group: "Payments", label: money(p.amount, p.currency, { code: true }), hint: `${p.customer_email ?? ""} · ${p.id}`, icon: "card", chip: p.status, run: () => go(`/payments/${p.id}`) })),
      );
    }
    return out;
    // go/onCopilot are stable enough for a transient dialog
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, remote, term, can]);

  const active = Math.min(cursor, Math.max(0, items.length - 1));
  const searching = term.length >= 2 && remote.term !== term;

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(Math.min(items.length - 1, active + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor(Math.max(0, active - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); items[active]?.run(); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-[rgba(29,31,30,0.28)] p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()} className="card w-full max-w-xl overflow-hidden shadow-float">
        <div className="flex items-center gap-3 border-b border-line px-5">
          <Icon name="search" className="text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setCursor(0); }}
            onKeyDown={onKey}
            placeholder="Search customers, payments (id, email, last 4) or pages"
            aria-label="Search"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `pal-${items[active].id}` : undefined}
            className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint focus-visible:outline-none"
          />
          {searching && <Spinner className="text-muted" />}
        </div>
        <ul id="palette-list" ref={listRef} role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
          {items.length === 0 && <li className="px-4 py-8 text-center text-[13px] text-muted">{searching ? "Searching…" : "No matches."}</li>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={it.id} role="presentation">
                {header && <div className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">{header}</div>}
                <div
                  id={`pal-${it.id}`}
                  data-idx={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setCursor(i)}
                  onClick={it.run}
                  className={cx("flex cursor-pointer items-center gap-3 rounded-[14px] px-3 py-2.5 text-[14px]", i === active ? "bg-surface-2" : "")}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-3 text-text-2"><Icon name={it.icon} size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-text">{it.label}</span>
                    {it.hint && <span className="block truncate text-[12px] text-muted">{it.hint}</span>}
                  </span>
                  {it.chip && <StatusChip status={it.chip} />}
                  {i === active && <Icon name="right" size={15} className="text-muted" />}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-4 border-t border-line px-5 py-2.5 text-[11.5px] text-muted">
          <span>↑↓ to move</span><span>Enter to open</span><span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}
