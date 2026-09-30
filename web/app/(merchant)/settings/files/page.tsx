"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { date, titleCase } from "@/lib/format";
import { qs, useCursorList } from "@/lib/merchant/hooks";
import { Button, Card, Chip, Empty, ErrorNote, PageHeader, Table } from "@/components/ui";
import { useMerchant } from "@/components/merchant/context";
import { FilterBar, FilterSelect, Help, ListSkeleton, Loaded, Mono, NoAccess, Pager } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { SettingsNav } from "@/components/merchant/settings/shared";
import { UploadFileModal } from "@/components/merchant/ops/UploadFileModal";
import { bytes } from "@/components/merchant/ops/shared";
import { FILE_PURPOSES, type FileLink, type StoredFile } from "@/components/merchant/ops/types";
import { apiUrl } from "@/components/merchant/ops/upload";

const PURPOSE = Object.fromEntries(FILE_PURPOSES.map((p) => [p.value, p.label])) as Record<string, string>;
const TYPE_LABEL: Record<string, string> = { "application/pdf": "PDF", "image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WebP", "text/csv": "CSV", "text/plain": "Text" };

function ScanChip({ status }: { status: string }) {
  if (status === "clean") return <Chip tone="sage"><Icon name="shield" size={12} /> Clean</Chip>;
  if (status === "infected") return <Chip tone="rose">Rejected</Chip>;
  return <Chip tone="neutral">Not scanned</Chip>;
}

export default function FilesPage() {
  const { can, live } = useMerchant();
  const allowed = can("compliance.read");
  const canUpload = FILE_PURPOSES.some((p) => can(p.perm));
  const [purpose, setPurpose] = useState("");
  const list = useCursorList<StoredFile>(allowed ? `/v1/files${qs({ purpose })}` : null);
  const [uploading, setUploading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<unknown>(null);

  if (!allowed) return <NoAccess what="files" />;

  const open = async (f: StoredFile) => {
    setOpening(f.id);
    setOpenError(null);
    try {
      // The signed link is the credential (valid 5 minutes) and is served as an attachment, so following
      // it downloads the file without leaving the page.
      const link = await api<FileLink>(`/v1/files/${f.id}/link`, { method: "POST" });
      window.location.assign(apiUrl(link.url));
    } catch (e) {
      setOpenError(e);
    } finally {
      setOpening(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Files"
        subtitle="Verification documents, tax documents and dispute evidence you've shared with us."
        actions={canUpload && <Button icon={<Icon name="upload" size={16} />} onClick={() => setUploading(true)}>Upload file</Button>}
      />
      <SettingsNav current="/settings/files" />
      <Card>
        <FilterBar>
          <FilterSelect label="Purpose" value={purpose} onChange={setPurpose} options={[{ value: "", label: "All purposes" }, ...FILE_PURPOSES.map((p) => ({ value: p.value, label: p.label }))]} />
          <span className="ml-auto text-[12px] text-muted">{live ? "Live" : "Test"} mode files</span>
        </FilterBar>
        {openError ? <div className="mb-3"><ErrorNote error={openError} /></div> : null}
        <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<ListSkeleton rows={4} />}>
          {() => (
            <Table
              rows={list.rows}
              rowKey={(f) => f.id}
              empty={
                <Empty title={purpose ? "No files for this purpose" : "No files yet"} icon={<Icon name="file" />} action={canUpload && !purpose ? <Button onClick={() => setUploading(true)}>Upload file</Button> : undefined}>
                  Documents you upload for verification, tax or disputes appear here.
                </Empty>
              }
              columns={[
                {
                  key: "name", header: "File",
                  render: (f) => (
                    <span className="flex min-w-[200px] flex-col">
                      <span className="text-text">{f.file_name}</span>
                      <Mono copy={false} className="text-[11.5px]">{f.id}</Mono>
                    </span>
                  ),
                },
                { key: "purpose", header: "Purpose", render: (f) => <span className="text-text-2">{PURPOSE[f.purpose] ?? titleCase(f.purpose)}</span> },
                { key: "type", header: "Type", render: (f) => <Chip tone="lemon-soft">{TYPE_LABEL[f.content_type] ?? f.content_type}</Chip> },
                { key: "size", header: "Size", align: "right", render: (f) => <span className="numeral whitespace-nowrap text-text-2">{bytes(f.size)}</span> },
                { key: "scan", header: "Scan", render: (f) => <ScanChip status={f.scan_status} /> },
                { key: "date", header: "Uploaded", render: (f) => <span className="whitespace-nowrap text-muted">{date(f.created_at, true)}</span> },
                {
                  key: "open", header: "", align: "right",
                  render: (f) => <Button size="sm" variant="soft" loading={opening === f.id} onClick={() => open(f)} icon={<Icon name="download" size={14} />}>Download</Button>,
                },
              ]}
            />
          )}
        </Loaded>
        <Pager page={list.page} hasPrev={list.hasPrev} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
        <div className="mt-4 space-y-1.5">
          <Help>
            Only PDF, PNG, JPEG, WebP, plain-text and CSV files up to 10 MB are accepted; the type is detected from the content, and anything else is rejected as unsupported. Files are encrypted at rest and fingerprinted with SHA-256.
          </Help>
          <Help>&quot;Download&quot; creates a private signed link that works for 5 minutes; every link is recorded in the audit log. Malware scanning shows &quot;Not scanned&quot; until a scanner is connected.</Help>
        </div>
      </Card>
      {uploading && <UploadFileModal onClose={() => setUploading(false)} onDone={() => list.reload()} />}
    </>
  );
}
