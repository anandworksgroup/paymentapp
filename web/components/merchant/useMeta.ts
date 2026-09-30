"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Country, Meta } from "@/lib/merchant/types";

let cache: Promise<Meta> | null = null;

/** `/v1/meta` (countries, currencies, test cards) — public and cached for the tab's lifetime. */
export function loadMeta() {
  cache ??= api<Meta>("/v1/meta", { anonymous: true }).catch((e) => {
    cache = null;
    throw e;
  });
  return cache;
}

export function useMeta() {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    let alive = true;
    loadMeta().then((m) => alive && setMeta(m), () => {});
    return () => {
      alive = false;
    };
  }, []);
  return meta;
}

export function useCountries(): Country[] {
  return useMeta()?.countries ?? [];
}
