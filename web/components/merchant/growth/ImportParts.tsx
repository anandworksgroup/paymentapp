"use client";

import Link from "next/link";
import { useState } from "react";
import { Chip, Segmented, Table } from "@/components/ui";
import { Icon } from "../icons";
import { downloadText, StateChip } from "./helpers";
import type { ImportJob, ImportRowResult } from "./types";

export type ImportType = "customers" | "products";
export type ImportFormat = "csv" | "json";

/** Column sets the importer reads (backend Modules/Operations ImportService). */
export const IMPORT_COLUMNS: Record<ImportType, { columns: string[]; required: string[]; notes: string[] }> = {
  customers: {
    columns: ["email", "name", "country", "phone", "external_id", "tax_id", "customer_type"],
    required: ["email"],
    notes: [
      "email is required and must be unique — rows matching an existing customer's email or external_id are marked duplicate and skipped.",
      "country is a 2-letter ISO code (GB, DE, IN…). customer_type is b2c (default) or b2b.",
    ],
  },
  products: {
    columns: ["name", "description", "type", "tax_category", "price_amount", "currency", "interval", "interval_count", "trial_days"],
    required: ["name", "price_amount"],
    notes: [
      "price_amount is in minor units: 2900 means $29.00, 500 means ¥500 for JPY. Each row creates a product with one price.",
      "Leave interval blank for a one-time price, or use day, week, month or year for a subscription. A product name that already exists is a duplicate.",
      "type defaults to saas and tax_category to digital_service (also saas, ebook, general).",
    ],
  },
};

const TEMPLATES: Record<ImportType, string> = {
  customers: [
    "email,name,country,phone,external_id,tax_id,customer_type",
    "ada@example.com,Ada Lovelace,GB,+44 20 7946 0000,crm-1001,,b2c",
    "billing@acme.example,Acme GmbH,DE,,crm-1002,DE123456789,b2b",
  ].join("\r\n"),
  products: [
    "name,description,type,tax_category,price_amount,currency,interval,interval_count,trial_days",
    "Pro plan,Monthly access to every Pro feature,saas,saas,2900,USD,month,1,14",
    "Template bundle,One-off download of 40 templates,download,digital_service,4900,USD,,,",
  ].join("\r\n"),
};

export function downloadTemplate(type: ImportType) {
  downloadText(`${type}-import-template.csv`, TEMPLATES[type] + "\r\n");
}

/** Reads the header of pasted CSV / keys of the first JSON object, to flag missing or unknown columns early. */
export function inspectColumns(format: ImportFormat, content: string): string[] | null {
  const text = content.replace(/^﻿/, "").trim();
  if (!text) return null;
  if (format === "json") {
    try {
      const rows = JSON.parse(text);
      if (!Array.isArray(rows) || rows.length === 0 || typeof rows[0] !== "object" || rows[0] === null) return null;
      return Object.keys(rows[0]).map((k) => k.trim().toLowerCase());
    } catch {
      return null;
    }
  }
  const first = text.split(/\r?\n/)[0];
  return first.split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
}

export function guessFormat(name: string, content: string): ImportFormat {
  if (/\.json$/i.test(name)) return "json";
  if (/\.csv$/i.test(name)) return "csv";
  return content.trimStart().startsWith("[") ? "json" : "csv";
}

const PREVIEW_FILTERS = ["all", "valid", "invalid", "duplicate"] as const;
const COMMIT_FILTERS = ["all", "imported", "skipped", "failed"] as const;
const LIMIT = 200;

/** Per-row outcome of a preview (valid / invalid / duplicate) or a committed run (imported / skipped / failed). */
export function ImportResults({ job }: { job: ImportJob }) {
  const rows = job.results ?? [];
  const filters = job.dry_run ? PREVIEW_FILTERS : COMMIT_FILTERS;
  const [filter, setFilter] = useState<string>("all");
  const count = (f: string) => (f === "all" ? rows.length : rows.filter((r) => r.status === f).length);
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const visible = shown.slice(0, LIMIT);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented value={filter} onChange={setFilter} options={filters.map((f) => ({ value: f, label: `${f[0].toUpperCase()}${f.slice(1)} · ${count(f)}` }))} />
        {shown.length > LIMIT && <span className="text-[12px] text-muted">Showing the first {LIMIT} of {shown.length.toLocaleString()} rows</span>}
      </div>
      <Table<ImportRowResult>
        rows={visible}
        rowKey={(r) => String(r.row)}
        empty={<p className="rounded-inner bg-surface-2 px-4 py-6 text-center text-[13px] text-muted">No rows in this group.</p>}
        columns={[
          { key: "row", header: "Row", render: (r) => <span className="numeral text-muted">{r.row}</span> },
          { key: "key", header: job.type === "customers" ? "Email" : "Name", render: (r) => <span className="block max-w-[260px] truncate text-text">{r.key || <span className="text-faint">(blank)</span>}</span> },
          { key: "status", header: "Result", render: (r) => <StateChip status={r.status} /> },
          {
            key: "detail",
            header: "Details",
            render: (r) =>
              r.errors?.length ? (
                <ul className="space-y-0.5 text-[12.5px] text-rose-ink">
                  {r.errors.map((e) => <li key={e}>{e}</li>)}
                </ul>
              ) : r.status === "duplicate" || r.status === "skipped" ? (
                <span className="text-[12.5px] text-muted">{job.type === "customers" ? "Already a customer (email or external id), or repeated in this file" : "A product with this name exists, or it's repeated in this file"}</span>
              ) : r.id ? (
                <Link href={job.type === "customers" ? `/customers/${r.id}` : `/products/${r.id}`} className="font-mono text-[12px] text-text-2 underline-offset-4 hover:underline">{r.id}</Link>
              ) : (
                <span className="text-[12.5px] text-muted">Ready to import</span>
              ),
          },
        ]}
      />
    </div>
  );
}

/** Four small counters used on the preview and in the history list. */
export function ImportCounts({ job }: { job: ImportJob }) {
  return (
    <span className="flex flex-wrap gap-1">
      <Chip tone="neutral">{job.total.toLocaleString()} rows</Chip>
      {job.dry_run ? (
        <>
          <Chip tone="sage">{job.valid.toLocaleString()} valid</Chip>
          {job.invalid > 0 && <Chip tone="rose">{job.invalid.toLocaleString()} invalid</Chip>}
          {job.duplicates > 0 && <Chip tone="lemon">{job.duplicates.toLocaleString()} duplicate</Chip>}
        </>
      ) : (
        <>
          <Chip tone="sage">{job.imported.toLocaleString()} imported</Chip>
          {job.duplicates > 0 && <Chip tone="neutral">{job.duplicates.toLocaleString()} skipped</Chip>}
          {job.invalid > 0 && <Chip tone="rose">{job.invalid.toLocaleString()} failed</Chip>}
        </>
      )}
    </span>
  );
}

export function StepDots({ step }: { step: 0 | 1 | 2 }) {
  const labels = ["Upload", "Preview", "Import"];
  return (
    <ol className="flex flex-wrap items-center gap-2 text-[12.5px]" aria-label="Import steps">
      {labels.map((l, i) => (
        <li key={l} className="flex items-center gap-2" aria-current={i === step ? "step" : undefined}>
          <span className={i < step ? "grid h-6 w-6 place-items-center rounded-full bg-sage-100 text-sage-700" : i === step ? "grid h-6 w-6 place-items-center rounded-full bg-ink text-white" : "grid h-6 w-6 place-items-center rounded-full bg-surface-3 text-muted"}>
            {i < step ? <Icon name="check" size={13} /> : i + 1}
          </span>
          <span className={i === step ? "text-text" : "text-muted"}>{l}</span>
          {i < labels.length - 1 && <span aria-hidden className="mx-1 h-px w-6 bg-line" />}
        </li>
      ))}
    </ol>
  );
}
