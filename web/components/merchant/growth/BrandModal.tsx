"use client";

import { useState } from "react";
import { api, type List } from "@/lib/api";
import { useApi } from "@/lib/merchant/hooks";
import type { Product } from "@/lib/merchant/types";
import { Button, ErrorNote, Field, Input, Modal } from "@/components/ui";
import { useToast } from "../context";
import { Loaded } from "../common";
import { CheckField } from "../catalog/fields";
import type { Brand } from "./types";

const HEX = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function urlOk(v: string) {
  if (!v) return true;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** The checkout header as buyers see it for this brand. */
export function BrandBadge({ name, color, logo, size = 40 }: { name: string; color?: string | null; logo?: string | null; size?: number }) {
  if (logo && urlOk(logo))
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary merchant-hosted logo URLs, not optimisable assets
    return <img src={logo} alt="" width={size} height={size} className="shrink-0 rounded-full border border-line bg-surface object-cover" style={{ width: size, height: size }} />;
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-full bg-ink text-white" style={{ width: size, height: size, fontSize: size * 0.36, background: color && HEX.test(color) ? color : undefined }}>
      {(name.trim() || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

export function BrandModal({ brand, onClose, onSaved }: { brand?: Brand; onClose: () => void; onSaved: (b: Brand) => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: brand?.name ?? "",
    color: brand?.color ?? "#4E8F55",
    logo_url: brand?.logo_url ?? "",
    support_email: brand?.support_email ?? "",
    website: brand?.website ?? "",
  });
  const [active, setActive] = useState(brand?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const errors = {
    color: f.color && !HEX.test(f.color) ? "Use a #RRGGBB hex colour." : null,
    logo: !urlOk(f.logo_url.trim()) ? "Enter a full https:// URL." : null,
    email: f.support_email.trim() && !EMAIL.test(f.support_email.trim()) ? "Enter a valid email address." : null,
    website: !urlOk(f.website.trim()) ? "Enter a full https:// URL." : null,
  };
  const invalid = !f.name.trim() || Object.values(errors).some(Boolean);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    // PATCH only changes fields it receives. A field the merchant emptied is sent as "" so it is really
    // cleared; one that was never set stays absent (null), so checkout keeps falling back to the org's value.
    const opt = (v: string, before?: string | null) => v.trim() || (brand && before ? "" : undefined);
    const body = {
      name: f.name.trim(),
      color: opt(f.color, brand?.color),
      logo_url: opt(f.logo_url, brand?.logo_url),
      support_email: opt(f.support_email, brand?.support_email),
      website: opt(f.website, brand?.website),
      active: brand ? active : undefined,
    };
    try {
      const b = brand ? await api<Brand>(`/v1/brands/${brand.id}`, { method: "PATCH", body }) : await api<Brand>("/v1/brands", { body });
      toast(brand ? "Brand updated" : `Brand ${b.name} created`);
      onSaved(b);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={brand ? `Edit ${brand.name}` : "New brand"} wide>
      <form onSubmit={submit} className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Field label="Brand name" hint="Shown to buyers at checkout, on receipts and in the customer portal.">
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} required autoFocus maxLength={120} />
          </Field>
          <Field label="Colour" error={errors.color}>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Pick a colour"
                value={HEX.test(f.color) ? f.color : "#2d2e30"}
                onChange={(e) => set("color", e.target.value.toUpperCase())}
                className="h-11 w-14 shrink-0 cursor-pointer rounded-field border border-line bg-surface p-1"
              />
              <Input value={f.color} onChange={(e) => set("color", e.target.value)} placeholder="#4E8F55" className="font-mono uppercase" maxLength={7} />
            </div>
          </Field>
          <Field label="Logo URL (optional)" error={errors.logo} hint="A square image works best.">
            <Input value={f.logo_url} onChange={(e) => set("logo_url", e.target.value)} placeholder="https://cdn.example.com/logo.png" inputMode="url" />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Support email (optional)" error={errors.email}>
              <Input type="email" value={f.support_email} onChange={(e) => set("support_email", e.target.value)} placeholder="help@brand.example" />
            </Field>
            <Field label="Website (optional)" error={errors.website}>
              <Input value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://brand.example" inputMode="url" />
            </Field>
          </div>
          {brand && <CheckField label="Active" hint="Inactive brands fall back to your organization's name and look at checkout." checked={active} onChange={setActive} />}
        </div>

        <div className="space-y-3">
          <div className="text-[12.5px] font-medium text-text-2">Checkout preview</div>
          <div className="sage-gradient rounded-inner p-5">
            <div className="flex items-center gap-3">
              <BrandBadge name={f.name || "Brand"} color={f.color} logo={f.logo_url.trim()} />
              <div className="min-w-0">
                <div className="truncate text-[15px] font-medium text-text">{f.name || "Brand name"}</div>
                <div className="text-[12.5px] text-text-2">← Back</div>
              </div>
            </div>
            <div className="mt-5 text-[13px] text-text-2">Pay {f.name || "Brand name"}</div>
            <div className="numeral text-[34px] font-light tracking-[-0.03em] text-text">$29<span className="ml-1.5 text-[12px] text-muted">USD</span></div>
            <div className="mt-4 flex h-11 items-center justify-center rounded-full bg-ink text-[13.5px] text-white" aria-hidden>Pay $29.00 USD</div>
          </div>
          <p className="text-[12px] text-muted">
            {f.support_email.trim() ? <>Buyers who need help are pointed to <span className="text-text-2">{f.support_email.trim()}</span>.</> : "Without a support email, your organization's support email is shown."}
          </p>
        </div>

        <div className="md:col-span-2">
          <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={invalid}>{brand ? "Save changes" : "Create brand"}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

type BrandedProduct = Product & { brand_id?: string | null };

/** Which products carry a brand (PATCH /v1/products/{id} { brand }). Needs products.write. */
export function BrandProductsModal({ brand, brands, onClose, onSaved }: { brand: Brand; brands: Brand[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const products = useApi<List<BrandedProduct>>("/v1/products?limit=100");
  const rows = (products.data?.data ?? []).filter((p) => p.status !== "archived");
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const initial = new Set(rows.filter((p) => p.brand_id === brand.id).map((p) => p.id));
  const selected = picked ?? initial;
  const changes = rows.filter((p) => selected.has(p.id) !== (p.brand_id === brand.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const brandName = (id?: string | null) => brands.find((b) => b.id === id)?.name;

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const p of changes) await api(`/v1/products/${p.id}`, { method: "PATCH", body: { brand: selected.has(p.id) ? brand.id : "" } });
      toast(`${changes.length} product${changes.length === 1 ? "" : "s"} updated`);
      onSaved();
    } catch (err) {
      setError(err);
      products.reload();
      setPicked(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Products sold as ${brand.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!changes.length} onClick={save}>{changes.length ? `Save ${changes.length} change${changes.length === 1 ? "" : "s"}` : "No changes"}</Button>
        </>
      }
    >
      <p className="mb-4 text-[13px] text-muted">A product carries one brand at a time; ticking a product that uses another brand moves it to {brand.name}.</p>
      <Loaded data={products.data} error={products.error} onRetry={products.reload}>
        {() =>
          rows.length === 0 ? (
            <p className="text-[13px] text-muted">No products yet.</p>
          ) : (
            <ul className="max-h-[50vh] space-y-1.5 overflow-auto">
              {rows.map((p) => (
                <li key={p.id}>
                  <CheckField
                    label={p.name}
                    hint={p.brand_id && p.brand_id !== brand.id ? `Currently ${brandName(p.brand_id) ?? p.brand_id}` : p.brand_id === brand.id ? `Uses ${brand.name}` : "Uses your organization's name"}
                    checked={selected.has(p.id)}
                    onChange={(v) => toggle(p.id, v)}
                  />
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
      <div aria-live="assertive" className="mt-3">{error ? <ErrorNote error={error} /> : null}</div>
    </Modal>
  );
}
