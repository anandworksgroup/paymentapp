"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { useCursorList } from "@/lib/merchant/hooks";
import { date, titleCase } from "@/lib/format";
import { Button, Card, CardHeader, Chip, Empty, ErrorNote, Field, Modal, PageHeader, Segmented, Table, Textarea } from "@/components/ui";
import { useMerchant, useToast } from "@/components/merchant/context";
import { Help, ListSkeleton, Loaded, NoAccess, Pager } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { StateChip } from "@/components/merchant/growth/helpers";
import {
  downloadTemplate, guessFormat, IMPORT_COLUMNS, ImportCounts, ImportResults, inspectColumns, StepDots, type ImportFormat, type ImportType,
} from "@/components/merchant/growth/ImportParts";
import type { ImportJob } from "@/components/merchant/growth/types";

const MAX_BYTES = 5_000_000;

export default function ImportsPage() {
  const { can } = useMerchant();
  const types = ([["customers", "customers.write"], ["products", "products.write"]] as const).filter(([, p]) => can(p)).map(([t]) => t);
  const history = useCursorList<ImportJob>(can("customers.read") ? "/v1/imports" : null, 20);
  const [viewing, setViewing] = useState<ImportJob | null>(null);

  if (!types.length) return <NoAccess what="imports" />;

  return (
    <>
      <PageHeader
        title="Imports"
        subtitle="Bring customers or products over from a spreadsheet or another platform. Every file is previewed before anything is created."
      />
      <Wizard types={types} onFinished={history.reload} />

      {can("customers.read") && (
        <Card className="mt-5">
          <CardHeader title="Import history" subtitle="Previews and completed imports, newest first" />
          <Loaded data={history.data} error={history.error} onRetry={history.reload} skeleton={<ListSkeleton rows={4} />}>
            {() => (
              <>
                <Table
                  rows={history.rows}
                  rowKey={(j) => j.id}
                  onRowClick={setViewing}
                  empty={<Empty title="No imports yet" icon={<Icon name="upload" />}>Your previews and imports will be listed here.</Empty>}
                  columns={[
                    { key: "type", header: "Type", render: (j) => <span className="text-text">{titleCase(j.type)}</span> },
                    { key: "mode", header: "Run", render: (j) => (j.dry_run ? <Chip tone="lemon-soft">Preview</Chip> : <Chip tone="ink">Import</Chip>) },
                    { key: "status", header: "Status", render: (j) => <StateChip status={j.status} /> },
                    { key: "counts", header: "Rows", render: (j) => <ImportCounts job={j} /> },
                    { key: "format", header: "Format", render: (j) => <span className="uppercase text-text-2">{j.format}</span> },
                    { key: "created", header: "When", align: "right", render: (j) => <span className="whitespace-nowrap text-muted">{date(j.created_at, true)}</span> },
                  ]}
                />
                <Pager page={history.page} hasPrev={history.hasPrev} hasMore={history.hasMore} onPrev={history.prev} onNext={history.next} loading={history.loading} />
              </>
            )}
          </Loaded>
        </Card>
      )}

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `${titleCase(viewing.type)} ${viewing.dry_run ? "preview" : "import"} · ${date(viewing.created_at, true)}` : ""} wide>
        {viewing && (
          <div className="space-y-4">
            <ImportCounts job={viewing} />
            <ImportResults key={viewing.id} job={viewing} />
          </div>
        )}
      </Modal>
    </>
  );
}

function Wizard({ types, onFinished }: { types: ImportType[]; onFinished: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<ImportType>(types[0]);
  const [format, setFormat] = useState<ImportFormat>("csv");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportJob | null>(null);
  const [result, setResult] = useState<ImportJob | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const spec = IMPORT_COLUMNS[type];
  const columns = inspectColumns(format, content);
  const missing = columns ? spec.required.filter((c) => !columns.includes(c)) : [];
  const unknown = columns ? columns.filter((c) => c && !spec.columns.includes(c)) : [];
  const tooBig = content.length > MAX_BYTES;
  const step: 0 | 1 | 2 = result ? 2 : preview ? 1 : 0;

  const reset = () => {
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const pickFile = async (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setFileError("That file is larger than 5 MB. Split it into smaller files.");
      return;
    }
    try {
      const text = await file.text();
      setContent(text.replace(/^﻿/, ""));
      setFileName(file.name);
      setFormat(guessFormat(file.name, text));
      reset();
    } catch {
      setFileError("We couldn't read that file. Save it as UTF-8 CSV or JSON and try again.");
    }
  };

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? "preview" : "commit");
    setError(null);
    try {
      const job = await api<ImportJob>("/v1/imports", { body: { type, format, content, dry_run: dryRun } });
      if (dryRun) setPreview(job);
      else {
        setResult(job);
        toast(`${job.imported.toLocaleString()} ${type} imported`);
      }
      onFinished();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const startOver = () => {
    setContent("");
    setFileName(null);
    if (fileRef.current) fileRef.current.value = "";
    reset();
  };

  return (
    <Card>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <StepDots step={step} />
        {step > 0 && <Button size="sm" variant="ghost" onClick={startOver}>Start a new import</Button>}
      </div>

      {step === 0 && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            {types.length > 1 && (
              <div>
                <div className="mb-1.5 text-[12.5px] font-medium text-text-2">What are you importing?</div>
                <Segmented<ImportType> value={type} onChange={(t) => { setType(t); reset(); }} options={types.map((t) => ({ value: t, label: titleCase(t) }))} />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json" className="sr-only" id="import-file" onChange={(e) => pickFile(e.target.files?.[0])} />
              <label htmlFor="import-file" className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-medium text-white transition hover:bg-ink-2 focus-within:ring-4 focus-within:ring-sage-100">
                <Icon name="upload" size={16} /> Choose a file
              </label>
              <span className="text-[13px] text-muted">{fileName ? <>Loaded <span className="text-text">{fileName}</span></> : "CSV or JSON, up to 5 MB and 10,000 rows — or paste below."}</span>
            </div>
            {fileError && <ErrorNote error={{ message: fileError }} />}
            <Field label={`Or paste ${format.toUpperCase()}`} hint={format === "json" ? "A JSON array of objects using the column names as keys." : "The first line must be the column names."}>
              <Textarea
                value={content}
                onChange={(e) => { setContent(e.target.value); setFileName(null); }}
                spellCheck={false}
                placeholder={format === "json" ? `[{ "email": "ada@example.com", "name": "Ada" }]` : spec.columns.join(",")}
                className="min-h-48 font-mono text-[12.5px]"
              />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented<ImportFormat> value={format} onChange={setFormat} options={[{ value: "csv", label: "CSV" }, { value: "json", label: "JSON" }]} />
              <Button icon={<Icon name="search" size={16} />} loading={busy === "preview"} disabled={!content.trim() || tooBig || missing.length > 0} onClick={() => run(true)}>
                Preview import
              </Button>
            </div>
            <div aria-live="polite" className="space-y-2">
              {tooBig && <ErrorNote error={{ message: "That's more than 5 MB. Split the data into smaller imports." }} />}
              {missing.length > 0 && <ErrorNote error={{ message: `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.` }} />}
              {unknown.length > 0 && (
                <p className="rounded-inner bg-lemon-soft px-4 py-3 text-[12.5px] text-lemon-ink">
                  These columns aren&apos;t used and will be ignored: {unknown.join(", ")}.
                </p>
              )}
              {error ? <ErrorNote error={error} /> : null}
            </div>
          </div>

          <aside className="min-w-0 space-y-3 rounded-inner bg-surface-2 p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[15px] font-medium text-text">{titleCase(type)} columns</h3>
              <Button size="sm" variant="soft" icon={<Icon name="download" size={14} />} onClick={() => downloadTemplate(type)}>CSV template</Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {spec.columns.map((c) => (
                <Chip key={c} tone={spec.required.includes(c) ? "lemon" : "neutral"} className="font-mono">{c}{spec.required.includes(c) ? " *" : ""}</Chip>
              ))}
            </div>
            <ul className="space-y-2 text-[12.5px] leading-relaxed text-text-2">
              {spec.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
            <Help>* required. Nothing is created until you confirm the preview.</Help>
          </aside>
        </div>
      )}

      {step === 1 && preview && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Rows" value={preview.total} />
            <Tile label="Ready to import" value={preview.valid} tone="sage" />
            <Tile label="Duplicates (skipped)" value={preview.duplicates} tone={preview.duplicates ? "lemon" : undefined} />
            <Tile label="Invalid (not imported)" value={preview.invalid} tone={preview.invalid ? "peach" : undefined} />
          </div>
          <ImportResults key={preview.id} job={preview} />
          <div className="flex flex-col-reverse items-stretch justify-between gap-3 border-t border-line pt-4 sm:flex-row sm:items-center">
            <p className="text-[12.5px] text-muted">
              {preview.valid > 0
                ? `Importing creates ${preview.valid.toLocaleString()} ${type}. Duplicate and invalid rows are left out — fix them in your file and import them separately.`
                : "No row is ready to import. Fix the errors in your file and preview again."}
            </p>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" onClick={() => reset()}>Back</Button>
              <Button loading={busy === "commit"} disabled={preview.valid === 0} onClick={() => run(false)}>
                Import {preview.valid.toLocaleString()} {type}
              </Button>
            </div>
          </div>
          <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        </div>
      )}

      {step === 2 && result && (
        <div className="space-y-5">
          <div className="flex items-start gap-4 rounded-inner sage-gradient p-5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/70 text-sage-700"><Icon name="check" size={20} /></span>
            <div>
              <div className="text-[17px] text-text">{result.imported.toLocaleString()} {type} imported</div>
              <div className="mt-0.5 text-[13px] text-text-2">
                {result.duplicates ? `${result.duplicates.toLocaleString()} duplicate${result.duplicates === 1 ? "" : "s"} skipped. ` : ""}
                {result.invalid ? `${result.invalid.toLocaleString()} invalid row${result.invalid === 1 ? "" : "s"} not imported. ` : ""}
                Rows were checked again at import time.
              </div>
            </div>
          </div>
          <ImportResults key={result.id} job={result} />
        </div>
      )}
    </Card>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "sage" | "lemon" | "peach" }) {
  const cls = tone === "sage" ? "sage-gradient" : tone === "lemon" ? "bg-lemon-soft" : tone === "peach" ? "bg-peach-soft" : "bg-surface-2";
  return (
    <div className={`rounded-inner p-4 ${cls}`}>
      <div className="text-[12.5px] text-text-2">{label}</div>
      <div className="numeral mt-1.5 text-[26px] text-text">{value.toLocaleString()}</div>
    </div>
  );
}
