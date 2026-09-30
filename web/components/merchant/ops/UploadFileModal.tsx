"use client";

import { useRef, useState } from "react";
import { Button, ErrorNote, Field, Modal, Select, cx } from "@/components/ui";
import { useMerchant, useToast } from "../context";
import { Icon } from "../icons";
import { bytes } from "./shared";
import { FILE_PURPOSES, type StoredFile } from "./types";
import { uploadFile } from "./upload";

const MAX = 10 * 1024 * 1024;
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,application/pdf,image/png,image/jpeg,image/webp,text/plain,text/csv";

export function UploadFileModal({ onClose, onDone }: { onClose: () => void; onDone: (f: StoredFile) => void }) {
  const { can } = useMerchant();
  const toast = useToast();
  const purposes = FILE_PURPOSES.filter((p) => can(p.perm));
  const [purpose, setPurpose] = useState<string>(purposes[0]?.value ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const tooBig = !!file && file.size > MAX;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || tooBig || !purpose) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("purpose", purpose);
      const f = await uploadFile<StoredFile>("/v1/files", form);
      toast(`${f.file_name} uploaded`);
      onDone(f);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Upload a file">
      <form onSubmit={submit} className="space-y-4">
        <Field label="What is it for?">
          <Select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            {purposes.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
        </Field>
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) { setFile(f); setError(null); }
          }}
          className={cx("rounded-inner border-2 border-dashed px-5 py-8 text-center transition", drag ? "border-sage-500 bg-sage-50" : "border-line bg-surface-2")}
        >
          <Icon name="upload" size={22} className="mx-auto text-muted" />
          {file ? (
            <p className="mt-2 text-[14px] text-text">{file.name} <span className="text-muted">· {bytes(file.size)}</span></p>
          ) : (
            <p className="mt-2 text-[13.5px] text-text-2">Drop a file here, or</p>
          )}
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            aria-label="Choose file"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }}
          />
          <Button type="button" size="sm" variant="soft" className="mt-3" onClick={() => input.current?.click()}>{file ? "Choose another file" : "Choose file"}</Button>
        </div>
        <p className={cx("text-[12px]", tooBig ? "text-rose-ink" : "text-muted")}>
          PDF, PNG, JPEG, WebP, plain text or CSV, up to 10 MB. The type is checked from the file&apos;s content, not its name; anything else is rejected. Files are encrypted at rest.
        </p>
        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!file || tooBig || !purpose}>Upload</Button>
        </div>
      </form>
    </Modal>
  );
}
