"use client";

import { useEffect, useState } from "react";
import { api, type List } from "@/lib/api";
import { useApi } from "@/lib/merchant/hooks";
import type { Customer, Price, Product } from "@/lib/merchant/types";

/**
 * Resolves price ids to their price + product name. Loads the first 100 prices and products, then
 * fetches any price that wasn't among them (older or inactive versions) one by one.
 */
export function useCatalogNames(priceIds: string[], enabled = true) {
  const prices = useApi<List<Price>>(enabled ? "/v1/prices?limit=100" : null);
  const products = useApi<List<Product>>(enabled ? "/v1/products?limit=100" : null);
  const [extra, setExtra] = useState<Record<string, Price>>({});
  const priceMap = new Map<string, Price>((prices.data?.data ?? []).map((p) => [p.id, p]));
  for (const p of Object.values(extra)) priceMap.set(p.id, p);
  const productNames = new Map((products.data?.data ?? []).map((p) => [p.id, p.name]));
  const missingKey = prices.data ? [...new Set(priceIds.filter((id) => !priceMap.has(id)))].sort().join(",") : "";

  useEffect(() => {
    if (!missingKey) return;
    let alive = true;
    Promise.all(missingKey.split(",").map((id) => api<Price>(`/v1/prices/${id}`).catch(() => null))).then((rows) => {
      if (!alive) return;
      setExtra((e) => {
        const next = { ...e };
        for (const p of rows) if (p) next[p.id] = p;
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [missingKey]);

  return {
    loading: enabled && (!prices.data || !products.data),
    price: (id: string) => priceMap.get(id),
    productName: (productId?: string | null) => (productId ? productNames.get(productId) : undefined),
  };
}

const customerCache = new Map<string, Customer | null>();

/** Resolves customer ids on the current page to names/emails (needs customers.read). */
export function useCustomerNames(ids: (string | null | undefined)[], enabled: boolean) {
  const [, setTick] = useState(0);
  const key = enabled ? [...new Set(ids.filter((x): x is string => !!x && !customerCache.has(x)))].sort().join(",") : "";

  useEffect(() => {
    if (!key) return;
    let alive = true;
    Promise.all(
      key.split(",").map((id) =>
        api<List<Customer>>(`/v1/customers?search=${encodeURIComponent(id)}&limit=1`).then(
          (r) => customerCache.set(id, r.data.find((c) => c.id === id) ?? null),
          () => customerCache.set(id, null),
        ),
      ),
    ).then(() => alive && setTick((t) => t + 1));
    return () => {
      alive = false;
    };
  }, [key]);

  return (id?: string | null): Customer | null | undefined => (id ? customerCache.get(id) : undefined);
}

export function customerLabel(c: Customer | null | undefined, fallback?: string | null) {
  if (!c) return fallback ?? null;
  return c.name && c.email ? `${c.name} · ${c.email}` : c.name ?? c.email ?? c.id;
}
