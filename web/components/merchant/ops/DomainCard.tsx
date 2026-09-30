"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { date, relative, titleCase } from "@/lib/format";
import { useAction } from "@/lib/merchant/hooks";
import { Button, Chip, ErrorNote, Field, Input, Modal, Select } from "@/components/ui";
import { useToast } from "../context";
import { ConfirmModal, CopyButton } from "../common";
import { Icon } from "../icons";
import { DomainStatusChip } from "./shared";
import type { DomainEntry } from "./types";

const PURPOSES = [
  { value: "checkout", label: "Hosted checkout", hint: "e.g. pay.yourbrand.com" },
  { value: "portal", label: "Customer portal", hint: "e.g. billing.yourbrand.com" },
  { value: "payment_links", label: "Payment links", hint: "e.g. buy.yourbrand.com" },
];
export const purposeLabel = (p: string) => PURPOSES.find((x) => x.value === p)?.label ?? titleCase(p);

/** One custom domain: status, the DNS records to create, verify and remove. */
export function DomainCard({ entry, canManage, onChange, onRemoved }: { entry: DomainEntry; canManage: boolean; onChange: (e: DomainEntry) => void; onRemoved: () => void }) {
  const d = entry.domain;
  const toast = useToast();
  const verify = useAction();
  const remove = useAction();
  const [confirm, setConfirm] = useState(false);

  const doVerify = async () => {
    const r = await verify.run(() => api<DomainEntry>(`/v1/domains/${d.id}/verify`, { method: "POST" }));
    if (r) {
      onChange(r);
      toast(r.domain.status === "VERIFIED" ? `${r.domain.hostname} is verified` : "Record not found yet — DNS changes can take a while", r.domain.status === "VERIFIED" ? "ok" : "error");
    }
  };

  const doRemove = async () => {
    const ok = await remove.run(() => api(`/v1/domains/${d.id}`, { method: "DELETE" }).then(() => true));
    if (ok) {
      setConfirm(false);
      toast(`${d.hostname} removed`);
      onRemoved();
    }
  };

  return (
    <article className="rounded-card bg-surface p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Icon name="globe" size={18} className="text-muted" />
            <h3 className="break-all text-[19px] font-normal tracking-[-0.01em] text-text">{d.hostname}</h3>
            <DomainStatusChip status={d.status} />
          </div>
          <p className="mt-1 text-[12.5px] text-muted">
            {purposeLabel(d.purpose)} · added {date(d.created_at)}
            {d.verified_at ? ` · verified ${date(d.verified_at)}` : ""}
            {d.last_checked_at ? ` · last checked ${relative(d.last_checked_at)}` : " · not checked yet"}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button size="sm" loading={verify.busy} onClick={doVerify} icon={<Icon name="repeat" size={14} />}>{d.status === "VERIFIED" ? "Re-check" : "Verify"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>Remove</Button>
          </div>
        )}
      </div>

      {d.last_error && d.status !== "VERIFIED" && (
        <div className="mt-4 flex gap-2 rounded-inner bg-peach-soft px-4 py-3 text-[13px] text-peach-ink">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" /> <span>{d.last_error}</span>
        </div>
      )}
      {verify.error ? <div className="mt-4"><ErrorNote error={verify.error} /></div> : null}

      <div className="mt-5">
        <div className="mb-2 text-[13px] font-medium text-text">DNS records to create at your DNS provider</div>
        <ul className="space-y-2">
          {entry.dns.map((r) => (
            <li key={r.type + r.name} className="rounded-inner bg-surface-2 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Chip tone={r.type === "TXT" ? "lemon" : "sky"}>{r.type}</Chip>
                <span className="text-[12.5px] text-muted">{r.purpose}</span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:items-center">
                <span className="text-[12px] text-muted">Name</span>
                <code className="min-w-0 break-all font-mono text-[12.5px] text-text">{r.name}</code>
                <CopyButton value={r.name} label="Copy" />
                <span className="text-[12px] text-muted">Value</span>
                <code className="min-w-0 break-all font-mono text-[12.5px] text-text">{r.value}</code>
                <CopyButton value={r.value} label="Copy" />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-muted">
          The TXT record proves you own the domain; keep it in place. DNS changes usually appear within minutes but can take up to 48 hours.
        </p>
      </div>

      <ConfirmModal open={confirm} onClose={() => setConfirm(false)} title={`Remove ${d.hostname}?`} confirmLabel="Remove domain" danger busy={remove.busy} error={remove.error} onConfirm={doRemove}>
        <p>Buyers using this hostname will stop reaching your {purposeLabel(d.purpose).toLowerCase()}. You can add it again later, which issues a new verification value.</p>
      </ConfirmModal>
    </article>
  );
}

export function AddDomainModal({ onClose, onAdded, onUnavailable }: { onClose: () => void; onAdded: (e: DomainEntry) => void; onUnavailable: () => void }) {
  const toast = useToast();
  const [hostname, setHostname] = useState("");
  const [purpose, setPurpose] = useState("checkout");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const host = hostname.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  const valid = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) && host.length >= 4 && host.length <= 253;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<DomainEntry>("/v1/domains", { body: { hostname: host, purpose } });
      toast(`${r.domain.hostname} added — create the DNS records next`);
      onAdded(r);
      onClose();
    } catch (err) {
      if ((err as { code?: string }).code === "feature_unavailable") {
        onUnavailable();
        onClose();
        return;
      }
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Add a custom domain">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-[13px] text-muted">Use a subdomain you control, such as pay.yourbrand.com. You&apos;ll get two DNS records to create; the domain works once it&apos;s verified.</p>
        <Field label="Hostname" error={hostname && !valid ? "Enter a hostname like pay.example.com (no https:// or path)." : null}>
          <Input value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="pay.example.com" autoFocus required spellCheck={false} autoCapitalize="none" className="font-mono" />
        </Field>
        <Field label="Used for" hint={PURPOSES.find((p) => p.value === purpose)?.hint}>
          <Select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            {PURPOSES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
        </Field>
        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!valid}>Add domain</Button>
        </div>
      </form>
    </Modal>
  );
}
