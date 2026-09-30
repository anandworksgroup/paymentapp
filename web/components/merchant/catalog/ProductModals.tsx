"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { Product } from "@/lib/merchant/types";
import { Button, ErrorNote, Field, Input, Modal, Segmented, Select, Textarea } from "@/components/ui";
import { titleCase } from "@/lib/format";
import { useToast } from "../context";
import { DELIVERY_TYPES, PRODUCT_TYPES, TAX_CATEGORIES } from "./fields";

/** New product. Prices are added on the product page afterwards. */
export function ProductCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Product) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("saas");
  const [taxCategory, setTaxCategory] = useState("digital_service");
  const [delivery, setDelivery] = useState("access");
  const [features, setFeatures] = useState("");
  const [status, setStatus] = useState<"active" | "draft">("active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api<Product>("/v1/products", {
        body: {
          name: name.trim(),
          description: description.trim() || undefined,
          type,
          tax_category: taxCategory,
          delivery_type: delivery,
          features: features.split(",").map((f) => f.trim()).filter(Boolean).join(",") || undefined,
          status,
        },
      });
      toast("Product created");
      onCreated(p);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Create product" wide>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus maxLength={200} placeholder="Acme Writer Pro" />
        </Field>
        <Field label="Description (optional)" hint="Shown to buyers on checkout and invoices.">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Product type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{t === "saas" ? "SaaS" : t === "api" ? "API" : titleCase(t)}</option>)}
            </Select>
          </Field>
          <Field label="Tax category" hint="Decides the tax rate in each country.">
            <Select value={taxCategory} onChange={(e) => setTaxCategory(e.target.value)}>
              {TAX_CATEGORIES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Delivery">
            <Select value={delivery} onChange={(e) => setDelivery(e.target.value)}>
              {DELIVERY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Features (optional)" hint="Comma-separated entitlement keys granted on purchase, e.g. export,api,priority_support">
          <Input value={features} onChange={(e) => setFeatures(e.target.value)} />
        </Field>
        <div role="group" aria-labelledby="product-status-label" className="flex flex-wrap items-center gap-3">
          <span className="text-[12.5px] font-medium text-text-2" id="product-status-label">Status</span>
          <Segmented<"active" | "draft"> value={status} onChange={setStatus} options={[{ value: "active", label: "Active" }, { value: "draft", label: "Draft" }]} />
          <span className="text-[12px] text-muted">{status === "draft" ? "Drafts can't be bought until activated." : "Can be sold as soon as it has a price."}</span>
        </div>
        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!name.trim()}>Create product</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Edit name, description and tax category. PATCH only changes the fields that are sent. */
export function ProductEditModal({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: (p: Product) => void }) {
  const toast = useToast();
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? "");
  const [taxCategory, setTaxCategory] = useState(product.tax_category);
  const [features, setFeatures] = useState(product.features_csv ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api<Product>(`/v1/products/${product.id}`, {
        method: "PATCH",
        body: { name: name.trim(), description: description.trim(), tax_category: taxCategory, features: features.split(",").map((f) => f.trim()).filter(Boolean).join(",") },
      });
      toast("Product updated");
      onSaved(p);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Edit product">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </Field>
        <Field label="Tax category" hint="Applies to future checkouts and invoices; past orders keep the tax they were charged.">
          <Select value={taxCategory} onChange={(e) => setTaxCategory(e.target.value)}>
            {TAX_CATEGORIES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Features" hint="Comma-separated entitlement keys">
          <Input value={features} onChange={(e) => setFeatures(e.target.value)} />
        </Field>
        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!name.trim()}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
