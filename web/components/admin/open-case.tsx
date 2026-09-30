"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorNote, Field, Input, Modal, Select } from "@/components/ui";
import { adminApi } from "./data";
import { useAdmin } from "./session";
import type { Alert, ComplianceCase } from "./types";

/** Opens a case from one or more alerts (they must share a subject — a case has one subject). */
export function OpenCaseDialog({ alerts, open, onClose }: { alerts: Alert[]; open: boolean; onClose: () => void }) {
  if (!open || alerts.length === 0) return null;
  return <OpenCaseBody alerts={alerts} onClose={onClose} />;
}

function OpenCaseBody({ alerts, onClose }: { alerts: Alert[]; onClose: () => void }) {
  const router = useRouter();
  const { guard } = useAdmin();
  const first = alerts[0];
  const mixed = alerts.some((a) => a.subject_id !== first.subject_id);
  const top = alerts.some((a) => a.severity === "CRITICAL") ? "CRITICAL" : alerts.some((a) => a.severity === "HIGH") ? "HIGH" : "MEDIUM";
  const [title, setTitle] = useState(alerts.length === 1 ? first.summary : `${alerts.length} related alerts: ${[...new Set(alerts.map((a) => a.summary))].slice(0, 2).join("; ")}`);
  const [priority, setPriority] = useState(top);
  const [type, setType] = useState(first.type === "sanctions" || first.type === "pep" ? "sanctions" : "aml");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const c = await guard(() =>
        adminApi<ComplianceCase>("/cases", {
          body: { subject_type: first.subject_type, subject_id: first.subject_id, title: title.trim(), priority, alerts: alerts.map((a) => a.id), type },
        }),
      );
      onClose();
      router.push(`/admin/cases/${c.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Open a case"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={mixed || title.trim().length < 5}>
            Open case
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13.5px] text-text-2">
          {alerts.length === 1 ? "The alert" : `These ${alerts.length} alerts`} will be linked to a new case assigned to you. The SLA due date follows the priority (critical 1 day, high 3, medium 7,
          low 14). Opening a case is recorded in the audit log.
        </p>
        {mixed && <ErrorNote error={{ message: "A case has one subject. Select alerts about the same user or merchant." }} />}
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => (
                <option key={p} value={p}>
                  {p.toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Case type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="aml">AML</option>
              <option value="sanctions">Sanctions / screening</option>
              <option value="fraud">Fraud</option>
            </Select>
          </Field>
        </div>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
