"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { ApiKey } from "@/lib/merchant/types";
import { Button, ErrorNote, Field, Input, Modal, Segmented } from "@/components/ui";
import { useMerchant, useStepUp, useToast } from "../context";
import { Help } from "../common";
import { PermissionPicker } from "./PermissionPicker";
import { SecretOnceModal } from "./shared";

type KeyType = "secret" | "restricted" | "publishable";
type Created = { api_key: ApiKey; secret: string; note: string };

const TYPE_HELP: Record<KeyType, string> = {
  secret: "Full access to your account from your server. Never put it in a browser or mobile app.",
  restricted: "Server key limited to the permissions you choose — ideal for a single service or a partner integration.",
  publishable: "Safe to embed in client code. It identifies your account and carries no API permissions; it stays visible in the list.",
};

/** The server matches the list exactly, so strip spaces around each address. */
function normalizeIps(v: string) {
  const list = v.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  return list.length ? list.join(",") : undefined;
}

export function CreateKeyModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { live } = useMerchant();
  const withStepUp = useStepUp();
  const toast = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<KeyType>("secret");
  const [perms, setPerms] = useState<string[]>([]);
  const [ips, setIps] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const invalid = !name.trim() || (type === "restricted" && perms.length === 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), type, permissions: type === "restricted" ? perms : undefined, allowed_ips: normalizeIps(ips) };
      // Live keys need a recent re-authentication; withStepUp asks for the password and retries.
      const res = await withStepUp(() => api<Created>("/v1/api_keys", { body }));
      setCreated(res);
      toast("API key created");
      onCreated();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <SecretOnceModal open title={`Your new ${created.api_key.type} key`} secret={created.secret} onClose={onClose}>
        <p className="text-[12.5px] text-muted">
          “{created.api_key.name}” · {created.api_key.livemode ? "live" : "test"} mode. It will be listed as <code className="font-mono">{created.api_key.display_key}</code>.
        </p>
      </SecretOnceModal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={`Create ${live ? "live" : "test"} API key`} wide>
      <form onSubmit={submit} className="space-y-4">
        {live && (
          <div className="rounded-inner bg-ink px-4 py-3 text-[13px] text-white" role="note">
            This key works against real money. You&apos;ll be asked to confirm your password.
          </div>
        )}
        <Field label="Name" hint="Something that tells you where it's used, like “Billing worker”.">
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus maxLength={80} />
        </Field>
        <div>
          <span className="mb-1.5 block text-[12.5px] font-medium text-text-2" id="key-type-label">Type</span>
          <div aria-labelledby="key-type-label">
            <Segmented<KeyType> value={type} onChange={setType} options={[{ value: "secret", label: "Secret" }, { value: "restricted", label: "Restricted" }, { value: "publishable", label: "Publishable" }]} />
          </div>
          <p className="mt-2 text-[12.5px] text-muted">{TYPE_HELP[type]}</p>
        </div>
        {type === "restricted" && (
          <div>
            <span className="mb-1.5 block text-[12.5px] font-medium text-text-2">Permissions</span>
            <PermissionPicker value={perms} onChange={setPerms} />
          </div>
        )}
        {type !== "publishable" && (
          <Field label="Allowed IPs (optional)" hint="Comma-separated addresses. Requests from anywhere else are rejected. Leave empty to allow any IP.">
            <Input value={ips} onChange={(e) => setIps(e.target.value)} placeholder="203.0.113.10, 198.51.100.7" />
          </Field>
        )}
        <Help>The full key is shown once after creation. Store it in your secrets manager.</Help>
        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={invalid}>Create key</Button>
        </div>
      </form>
    </Modal>
  );
}
