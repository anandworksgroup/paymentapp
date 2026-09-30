"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { API_URL, ApiError } from "@/lib/api";
import { Button, Card, Chip, Empty, ErrorNote, Modal, PageHeader, StatusChip, Table } from "@/components/ui";
import { adminApi, qs, usePagedList } from "@/components/admin/data";
import { EntityLink, FilterBar, FilterInput, FilterSelect, Hash, IdTag, KV, Loadable, Mono, Notice, Pager, Person, When, humanize } from "@/components/admin/kit";
import type { FileLink, StoredFile } from "@/components/admin/ops-types";
import { useAdmin } from "@/components/admin/session";
import { Guard } from "@/components/admin/shell";

/** FileService.Purposes on the API. */
const PURPOSES = ["kyb_document", "kyc_document", "dispute_evidence", "tax_document"];
const PII_PURPOSES = new Set(["kyc_document"]);
const PURPOSE_LABELS: Record<string, string> = {
  kyb_document: "Business (KYB) document",
  kyc_document: "Identity (KYC) document",
  dispute_evidence: "Dispute evidence",
  tax_document: "Tax document",
};
const purposeLabel = (p: string) => PURPOSE_LABELS[p] ?? humanize(p);

function size(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function FilesPage() {
  return (
    <Guard perm="admin.merchants.read">
      <Files />
    </Guard>
  );
}

function Files() {
  const params = useSearchParams();
  const { can } = useAdmin();
  const canPii = can("admin.pii.unmask");
  const [org, setOrg] = useState(params.get("org") ?? "");
  const [user, setUser] = useState(params.get("user") ?? "");
  const [purpose, setPurpose] = useState("");
  const [applied, setApplied] = useState({ org: org.trim(), user: user.trim() });
  const [opening, setOpening] = useState<StoredFile | null>(null);

  const list = usePagedList<StoredFile>(`/files${qs(applied)}`, 50);
  const rows = list.rows.filter((f) => !purpose || f.purpose === purpose);

  return (
    <>
      <PageHeader
        eyebrow="Documents"
        title="Files"
        subtitle="Uploads from merchants and wallet users: KYC and business documents, dispute evidence and more. Opening a file issues a short-lived signed link and records your access."
      />
      <div className="mb-5">
        <Notice tone="sky">
          Every file you open is written to the data access log with your name, time and IP.{" "}
          {canPii ? "Your role can open identity documents." : (
            <>
              Identity documents (<Mono>kyc_document</Mono>) need the <Mono>admin.pii.unmask</Mono> permission, which your role does not have.
            </>
          )}
        </Notice>
      </div>
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setApplied({ org: org.trim(), user: user.trim() });
          }}
        >
          <FilterBar>
            <FilterInput label="Org id" value={org} onChange={setOrg} placeholder="org_…" width="w-48" />
            <FilterInput label="User id" value={user} onChange={setUser} placeholder="usr_…" width="w-48" />
            <Button size="sm" type="submit" className="h-9">
              Apply
            </Button>
            <FilterSelect
              label="Purpose (this page)"
              value={purpose}
              onChange={setPurpose}
              options={[{ value: "", label: "Any purpose" }, ...PURPOSES.map((p) => ({ value: p, label: purposeLabel(p) }))]}
            />
          </FilterBar>
        </form>
        <Loadable q={list}>
          {() => (
            <>
              <Table
                rows={rows}
                rowKey={(r) => r.id}
                empty={<Empty title={list.rows.length ? "No files with this purpose on this page" : "No files"}>{list.rows.length ? "Try the next page or another purpose." : "Uploaded documents appear here."}</Empty>}
                columns={[
                  {
                    key: "name",
                    header: "File",
                    render: (r) => (
                      <div className="min-w-0 max-w-[280px]">
                        <div className="truncate font-medium text-text" title={r.file_name}>
                          {r.file_name}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] text-muted">{r.content_type}</span>
                          <IdTag id={r.id} />
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: "purpose",
                    header: "Purpose",
                    render: (r) => (PII_PURPOSES.has(r.purpose) ? <Chip tone="peach">{purposeLabel(r.purpose)} · PII</Chip> : <Chip>{purposeLabel(r.purpose)}</Chip>),
                  },
                  {
                    key: "owner",
                    header: "Owner",
                    render: (r) => (r.org_id ? <EntityLink type="org" id={r.org_id} /> : r.user_id ? <Person id={r.user_id} /> : <span className="text-faint">—</span>),
                  },
                  { key: "size", header: "Size", align: "right", render: (r) => <span className="text-text-2">{size(r.size)}</span> },
                  { key: "scan", header: "Malware scan", render: (r) => (r.scan_status === "not_scanned" ? <Chip>Not scanned</Chip> : <StatusChip status={r.scan_status === "clean" ? "clear" : r.scan_status} />) },
                  { key: "mode", header: "Mode", render: (r) => <StatusChip status={r.livemode ? "live" : "test"} /> },
                  { key: "sha", header: "SHA-256", render: (r) => <Hash value={r.sha256} n={8} /> },
                  { key: "at", header: "Uploaded", render: (r) => <When at={r.created_at} /> },
                  {
                    key: "open",
                    header: "",
                    align: "right",
                    render: (r) => (
                      <Button size="sm" variant={PII_PURPOSES.has(r.purpose) && !canPii ? "ghost" : "soft"} onClick={() => setOpening(r)} aria-label={`Open ${r.file_name}${PII_PURPOSES.has(r.purpose) && !canPii ? " (needs admin.pii.unmask)" : ""}`}>
                        Open
                      </Button>
                    ),
                  },
                ]}
              />
              <Pager page={list.page} hasMore={list.hasMore} onPrev={list.prev} onNext={list.next} loading={list.loading} />
            </>
          )}
        </Loadable>
      </Card>
      {opening && <OpenDialog f={opening} onClose={() => setOpening(null)} />}
    </>
  );
}

/** Confirms, requests the signed link, then offers it. Staff access is logged by the API. */
function OpenDialog({ f, onClose }: { f: StoredFile; onClose: () => void }) {
  const { guard } = useAdmin();
  const [link, setLink] = useState<FileLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const pii = PII_PURPOSES.has(f.purpose);

  const request = async () => {
    setBusy(true);
    setError(null);
    try {
      setLink(await guard(() => adminApi<FileLink>(`/files/${f.id}/link`, { method: "POST" })));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && e.code === "permission_denied") {
        setError(
          new ApiError(
            403,
            e.code,
            pii
              ? "Access denied: identity documents can only be opened by roles with the admin.pii.unmask permission. No link was issued. Ask a compliance admin if you need this document."
              : `Access denied: ${e.message}`,
            e.requestId,
          ),
        );
      } else setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={link ? "Signed link ready" : "Open file"}
      footer={
        link ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <a
              href={`${API_URL}${link.url}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-ink px-5 text-[14px] font-medium text-white hover:bg-ink-2"
            >
              Download {link.file.file_name}
            </a>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={request} loading={busy}>
              Issue signed link
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <KV
          items={[
            ["File", <span key="n" className="break-all">{f.file_name}</span>],
            ["Purpose", purposeLabel(f.purpose)],
            ["Owner", f.org_id ? <EntityLink key="o" type="org" id={f.org_id} /> : <Person key="u" id={f.user_id} />],
            ["Size", size(f.size)],
          ]}
        />
        {link ? (
          <Notice tone="sage">
            Link issued. Anyone holding it can download the file until <When at={link.expires_at} /> (5 minutes). If it expires, close this and open the file again. Your access is recorded in the data access log.
          </Notice>
        ) : (
          <p className="text-[13.5px] leading-relaxed text-text-2">
            The platform issues a signed download link valid for 5 minutes. Opening is recorded in the data access log (<Mono>download_link</Mono>) and the audit log (<Mono>file.link</Mono>).
            {pii && <span className="mt-2 block text-peach-ink">This is an identity document. Only open it when you need it for a review, and don&apos;t save copies outside the platform.</span>}
          </p>
        )}
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
