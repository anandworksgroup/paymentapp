"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { Membership } from "@/lib/merchant/types";
import { Button, ErrorNote, Field, Input, Modal, Select } from "@/components/ui";
import { titleCase } from "@/lib/format";
import { useToast } from "../context";
import { Help } from "../common";
import { ROLE_BLURBS } from "./shared";

function RoleSelect({ roles, value, onChange }: { roles: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Role" hint={ROLE_BLURBS[value]}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {roles.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
      </Select>
    </Field>
  );
}

export function AddMemberModal({ roles, onClose, onDone }: { roles: string[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(roles.includes("developer") ? "developer" : roles[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/v1/team", { body: { email: email.trim(), role } });
      toast(`${email.trim()} added as ${titleCase(role)}`);
      onDone();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Add a team member">
      <form onSubmit={submit} className="space-y-4">
        <Help>The person needs an account on the platform first. Ask them to sign up with this email, then add them here — they&apos;ll see your organization next time they sign in.</Help>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="off" placeholder="teammate@example.com" />
        </Field>
        <RoleSelect roles={roles} value={role} onChange={setRole} />
        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!email.includes("@") || !role}>Add member</Button>
        </div>
      </form>
    </Modal>
  );
}

export function ChangeRoleModal({ member, roles, onClose, onDone }: { member: Membership; roles: string[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [role, setRole] = useState(member.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The endpoint's request record requires the email too; it is not used to look the member up.
      await api(`/v1/team/${member.id}`, { method: "PATCH", body: { email: member.user.email, role } });
      toast(`${member.user.name} is now ${titleCase(role)}`);
      onDone();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Change role for ${member.user.name}`}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-[13.5px] text-muted">{member.user.email} · currently {titleCase(member.role)}. The change applies to their next request.</p>
        <RoleSelect roles={roles} value={role} onChange={setRole} />
        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={role === member.role}>Save role</Button>
        </div>
      </form>
    </Modal>
  );
}
