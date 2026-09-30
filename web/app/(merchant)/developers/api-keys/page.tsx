"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { api, type List } from "@/lib/api";
import { useAction, useApi } from "@/lib/merchant/hooks";
import type { ApiKey } from "@/lib/merchant/types";
import { Button, Card, Chip, Empty, PageHeader, Segmented, Table } from "@/components/ui";
import { date, relative, titleCase } from "@/lib/format";
import { useMerchant, useToast } from "@/components/merchant/context";
import { ConfirmModal, CopyButton, Help, ListSkeleton, Loaded, NoAccess } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { CreateKeyModal } from "@/components/merchant/developers/CreateKeyModal";
import { DevNav, ModeChip } from "@/components/merchant/developers/shared";

type Show = "mode" | "all" | "revoked";

export default function ApiKeysPage() {
  const { can, live } = useMerchant();
  const params = useSearchParams();
  const toast = useToast();
  const allowed = can("developers.read");
  const canWrite = can("developers.write");
  const keys = useApi<List<ApiKey>>(allowed ? "/v1/api_keys" : null);
  const [createOpen, setCreateOpen] = useState(() => params.get("new") === "1" && canWrite);
  const [createNonce, setCreateNonce] = useState(0);
  const [show, setShow] = useState<Show>("mode");
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const act = useAction();

  if (!allowed) return <NoAccess what="API keys" />;

  const rows = (keys.data?.data ?? []).filter((k) =>
    show === "revoked" ? !!k.revoked_at : show === "mode" ? k.livemode === live && !k.revoked_at : true,
  );

  const openCreate = () => {
    setCreateNonce((n) => n + 1);
    setCreateOpen(true);
  };

  return (
    <>
      <PageHeader
        title="API keys"
        subtitle="Authenticate server requests with a secret or restricted key. Keys belong to one mode — test or live."
        actions={canWrite && <Button icon={<Icon name="plus" size={16} />} onClick={openCreate}>Create key</Button>}
      />
      <DevNav current="/developers/api-keys" />
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Segmented<Show> value={show} onChange={setShow} options={[{ value: "mode", label: `Active ${live ? "live" : "test"}` }, { value: "all", label: "All" }, { value: "revoked", label: "Revoked" }]} />
          <Help>Send <code className="font-mono">Authorization: Bearer sk_…</code>. The mode comes from the key itself.</Help>
        </div>
        <Loaded data={keys.data} error={keys.error} onRetry={keys.reload} skeleton={<ListSkeleton rows={4} />}>
          {() => (
            <Table
              rows={rows}
              rowKey={(k) => k.id}
              empty={
                <Empty title={show === "revoked" ? "No revoked keys" : `No ${show === "mode" ? (live ? "live " : "test ") : ""}keys yet`} icon={<Icon name="key" />}
                  action={canWrite && show !== "revoked" ? <Button onClick={openCreate}>Create key</Button> : undefined}>
                  {show === "revoked" ? "Keys you revoke stay listed here for your records." : "Create a secret key to call the API from your server."}
                </Empty>
              }
              columns={[
                { key: "name", header: "Name", render: (k) => (
                  <span className="block min-w-[140px]">
                    <span className="block text-text">{k.name}</span>
                    {k.type === "restricted" && k.permissions?.length ? <span className="block text-[12px] text-muted">{k.permissions.length} permission{k.permissions.length === 1 ? "" : "s"}</span> : null}
                  </span>
                ) },
                { key: "type", header: "Type", render: (k) => <Chip tone={k.type === "secret" ? "peach" : k.type === "restricted" ? "lemon-soft" : "sky"}>{titleCase(k.type)}</Chip> },
                { key: "key", header: "Key", render: (k) => (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[12px] text-text-2">
                    {k.publishable_value ?? k.display_key}
                    {k.publishable_value && <CopyButton value={k.publishable_value} className="h-6 px-2" />}
                  </span>
                ) },
                { key: "mode", header: "Mode", render: (k) => <ModeChip livemode={k.livemode} /> },
                { key: "ips", header: "IPs", render: (k) => k.allowed_ips_csv ? <span className="text-[12px] text-text-2">{k.allowed_ips_csv.split(",").join(", ")}</span> : <span className="text-faint">Any</span> },
                { key: "created", header: "Created", render: (k) => <span className="whitespace-nowrap text-muted">{date(k.created_at)}</span> },
                { key: "used", header: "Last used", render: (k) => <span className="whitespace-nowrap text-muted">{k.last_used_at ? relative(k.last_used_at) : "Never"}</span> },
                { key: "status", header: "", align: "right", render: (k) =>
                  k.revoked_at ? <Chip tone="neutral">Revoked {date(k.revoked_at)}</Chip>
                  : canWrite ? <Button size="sm" variant="danger" onClick={() => { act.setError(null); setRevoking(k); }}>Revoke</Button>
                  : <Chip tone="sage">Active</Chip> },
              ]}
            />
          )}
        </Loaded>
      </Card>

      {createOpen && <CreateKeyModal key={createNonce} open onClose={() => setCreateOpen(false)} onCreated={keys.reload} />}

      <ConfirmModal
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title="Revoke this key?"
        confirmLabel="Revoke key"
        danger
        busy={act.busy}
        error={act.error}
        onConfirm={async () => {
          if (!revoking) return;
          const id = revoking.id;
          const ok = await act.run(() => api(`/v1/api_keys/${id}`, { method: "DELETE" }).then(() => true));
          if (ok) {
            toast("Key revoked");
            setRevoking(null);
            keys.reload();
          }
        }}
      >
        <p>
          <span className="font-mono text-text">{revoking?.display_key}</span> ({revoking?.name}) stops working immediately. Any integration still using it will receive
          401 errors. This can&apos;t be undone.
        </p>
      </ConfirmModal>
    </>
  );
}
