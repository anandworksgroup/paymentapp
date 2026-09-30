"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAction, useApi } from "@/lib/merchant/hooks";
import type { Membership } from "@/lib/merchant/types";
import { permissionGroups } from "@/lib/merchant/permissions";
import { Button, Card, CardHeader, Chip, Empty, PageHeader, Table, cx, type Tone } from "@/components/ui";
import { date, titleCase } from "@/lib/format";
import { useMerchant, useToast } from "@/components/merchant/context";
import { ConfirmModal, ListSkeleton, Loaded, NoAccess } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { AddMemberModal, ChangeRoleModal } from "@/components/merchant/settings/TeamModals";
import { ROLE_BLURBS, SettingsNav } from "@/components/merchant/settings/shared";

type Team = { object: "list"; data: Membership[]; roles: Record<string, string[]> };

const ROLE_TONES: Record<string, Tone> = { owner: "ink", admin: "lemon", finance: "sage", developer: "sky", support: "peach", analyst: "lemon-soft", compliance_analyst: "neutral" };

export default function TeamPage() {
  const { can, me } = useMerchant();
  const toast = useToast();
  const allowed = can("team.read");
  const canManage = can("team.manage");
  const team = useApi<Team>(allowed ? "/v1/team" : null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Membership | null>(null);
  const [removing, setRemoving] = useState<Membership | null>(null);
  const act = useAction();

  if (!allowed) return <NoAccess what="the team" />;
  const assignable = Object.keys(team.data?.roles ?? {}).filter((r) => r !== "owner");

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Who can access this organization, and what each role can do."
        actions={canManage && team.data && <Button icon={<Icon name="plus" size={16} />} onClick={() => setAdding(true)}>Add member</Button>}
      />
      <SettingsNav current="/settings/team" />
      <Loaded data={team.data} error={team.error} onRetry={team.reload} skeleton={<Card><ListSkeleton rows={4} /></Card>}>
        {(t) => (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card className="min-w-0">
              <CardHeader title="Members" subtitle={`${t.data.length} ${t.data.length === 1 ? "person" : "people"}`} />
              <Table
                rows={[...t.data].sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : a.user.name.localeCompare(b.user.name)))}
                rowKey={(m) => m.id}
                empty={<Empty title="No members">Add a teammate to share the work.</Empty>}
                columns={[
                  { key: "who", header: "Member", render: (m) => (
                    <span className="flex min-w-[180px] items-center gap-3">
                      <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full sage-gradient text-[13px] font-medium text-sage-700">
                        {m.user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-text">{m.user.name}{m.user.id === me.user.id && <span className="ml-1.5 text-[12px] text-muted">(you)</span>}</span>
                        <span className="block truncate text-[12px] text-muted">{m.user.email}</span>
                      </span>
                    </span>
                  ) },
                  { key: "role", header: "Role", render: (m) => <Chip tone={ROLE_TONES[m.role] ?? "neutral"}>{titleCase(m.role)}</Chip> },
                  { key: "mfa", header: "2-step", render: (m) => m.user.mfa_enabled ? <Chip tone="sage"><Icon name="shield" size={12} /> On</Chip> : <Chip tone="neutral">Off</Chip> },
                  { key: "since", header: "Member since", render: (m) => <span className="whitespace-nowrap text-muted">{date(m.created_at)}</span> },
                  { key: "act", header: "", align: "right", render: (m) =>
                    m.role === "owner" ? <span className="text-[12px] text-muted">Owner can&apos;t be changed</span>
                    : canManage ? (
                      <span className="inline-flex gap-1.5">
                        <Button size="sm" variant="soft" onClick={() => setEditing(m)}>Change role</Button>
                        <Button size="sm" variant="danger" onClick={() => { act.setError(null); setRemoving(m); }} aria-label={`Remove ${m.user.name}`}>Remove</Button>
                      </span>
                    ) : null },
                ]}
              />
              {t.data.some((m) => !m.user.mfa_enabled) && (
                <p className="mt-4 text-[12.5px] text-muted">Members without 2-step verification can turn it on under Settings → Security.</p>
              )}
            </Card>
            <RolesExplainer roles={t.roles} />
          </div>
        )}
      </Loaded>

      {adding && <AddMemberModal roles={assignable} onClose={() => setAdding(false)} onDone={team.reload} />}
      {editing && <ChangeRoleModal member={editing} roles={assignable} onClose={() => setEditing(null)} onDone={team.reload} />}
      <ConfirmModal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.user.name ?? "member"}?`}
        confirmLabel="Remove member"
        danger
        busy={act.busy}
        error={act.error}
        onConfirm={async () => {
          if (!removing) return;
          const m = removing;
          const ok = await act.run(() => api(`/v1/team/${m.id}`, { method: "DELETE" }).then(() => true));
          if (ok) {
            toast(`${m.user.name} removed`);
            setRemoving(null);
            team.reload();
          }
        }}
      >
        <p>{removing?.user.email} loses access to this organization right away. Their own account stays, and you can add them again later.</p>
      </ConfirmModal>
    </>
  );
}

function RolesExplainer({ roles }: { roles: Record<string, string[]> }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Roles" subtitle="What each role can do" />
      <ul className="space-y-2">
        {Object.entries(roles).map(([role, perms]) => {
          const expanded = open === role;
          const groups = permissionGroups(perms);
          return (
            <li key={role} className="rounded-inner bg-surface-2">
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`role-${role}`}
                onClick={() => setOpen(expanded ? null : role)}
                className="flex w-full items-start gap-3 rounded-inner px-4 py-3 text-left transition hover:bg-surface-3"
              >
                <Chip tone={ROLE_TONES[role] ?? "neutral"}>{titleCase(role)}</Chip>
                <span className="min-w-0 flex-1 text-[12.5px] text-text-2">{ROLE_BLURBS[role] ?? `${perms.length} permissions`}</span>
                <Icon name="chevron" size={16} className={cx("mt-0.5 shrink-0 text-muted transition", expanded && "rotate-180")} />
              </button>
              {expanded && (
                <div id={`role-${role}`} className="space-y-1.5 px-4 pb-4">
                  {Object.entries(groups).map(([g, ps]) => (
                    <div key={g} className="flex flex-wrap items-baseline gap-1.5 text-[12px]">
                      <span className="w-24 shrink-0 text-muted">{titleCase(g)}</span>
                      {ps.map((p) => <code key={p} className="rounded-full bg-surface px-2 py-0.5 font-mono text-[11.5px] text-text-2">{p.slice(g.length + 1)}</code>)}
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
