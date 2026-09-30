"use client";

import type { BeneficialOwner } from "@/lib/merchant/types";
import { Button, Chip, Field, Input, Select, StatusChip } from "@/components/ui";
import { titleCase } from "@/lib/format";
import { Icon } from "../icons";

export type OwnerRow = {
  key: string;
  id?: string;
  name: string;
  date_of_birth: string;
  nationality: string;
  country: string;
  ownership: string;
  relationship: string;
  verification_status?: string;
  screening_status?: string;
};

const RELATIONSHIPS = ["owner", "director", "controller", "representative"];

/** "12.5" → 1250 basis points, string-based so no floating point is involved. Null when invalid. */
export function pctToBps(v: string): number | null {
  const s = v.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  const bps = Number(w) * 100 + Number(f.padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}

export function bpsToPct(bps: number) {
  const w = Math.floor(bps / 100);
  const f = bps % 100;
  return f ? `${w}.${String(f).padStart(2, "0").replace(/0$/, "")}` : String(w);
}

export function toRow(o: BeneficialOwner): OwnerRow {
  return {
    key: o.id, id: o.id, name: o.name, date_of_birth: o.date_of_birth ?? "", nationality: o.nationality ?? "", country: o.country ?? "",
    ownership: bpsToPct(o.ownership_bps), relationship: o.relationship, verification_status: o.verification_status, screening_status: o.screening_status,
  };
}

export function emptyRow(key: string): OwnerRow {
  return { key, name: "", date_of_birth: "", nationality: "", country: "", ownership: "", relationship: "owner" };
}

export function OwnersEditor({ rows, onChange, locked, newKey }: { rows: OwnerRow[]; onChange: (rows: OwnerRow[]) => void; locked: boolean; newKey: () => string }) {
  const update = (key: string, patch: Partial<OwnerRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch, verification_status: undefined, screening_status: undefined } : r)));
  const total = rows.reduce((s, r) => s + (pctToBps(r.ownership) ?? 0), 0);

  return (
    <div className="space-y-3">
      {rows.length === 0 && <p className="rounded-inner bg-surface-2 px-4 py-3 text-[13px] text-muted">Add everyone who owns 25% or more, and at least one person who controls the business.</p>}
      {rows.map((r, i) => {
        const pctBad = r.ownership !== "" && pctToBps(r.ownership) === null;
        return (
          <fieldset key={r.key} className="min-w-0 rounded-inner bg-surface-2 p-4">
            <legend className="sr-only">Owner {i + 1}</legend>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium text-text">{r.name || `Owner ${i + 1}`}</span>
              {r.verification_status && <StatusChip status={r.verification_status} />}
              {r.screening_status && r.screening_status !== "pending" && <Chip tone={r.screening_status === "clear" ? "sage" : "lemon-soft"}>Screening: {titleCase(r.screening_status)}</Chip>}
              {!locked && (
                <Button type="button" size="sm" variant="ghost" className="ml-auto" icon={<Icon name="close" size={13} />} onClick={() => onChange(rows.filter((x) => x.key !== r.key))} aria-label={`Remove ${r.name || `owner ${i + 1}`}`}>
                  Remove
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Full legal name"><Input value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} required disabled={locked} /></Field>
              <Field label="Date of birth"><Input type="date" value={r.date_of_birth} onChange={(e) => update(r.key, { date_of_birth: e.target.value })} disabled={locked} /></Field>
              <Field label="Relationship">
                <Select value={r.relationship} onChange={(e) => update(r.key, { relationship: e.target.value })} disabled={locked}>
                  {RELATIONSHIPS.map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}
                </Select>
              </Field>
              <Field label="Nationality" hint="2-letter code, e.g. GB">
                <Input value={r.nationality} onChange={(e) => update(r.key, { nationality: e.target.value.toUpperCase().slice(0, 2) })} list="kyb-countries" className="uppercase" disabled={locked} />
              </Field>
              <Field label="Country of residence" hint="2-letter code">
                <Input value={r.country} onChange={(e) => update(r.key, { country: e.target.value.toUpperCase().slice(0, 2) })} list="kyb-countries" className="uppercase" disabled={locked} />
              </Field>
              <Field label="Ownership %" error={pctBad ? "0–100, up to 2 decimals." : null}>
                <Input inputMode="decimal" value={r.ownership} onChange={(e) => update(r.key, { ownership: e.target.value })} placeholder="25" disabled={locked} />
              </Field>
            </div>
          </fieldset>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={total > 10_000 ? "text-[12.5px] text-rose-ink" : "text-[12.5px] text-muted"} role={total > 10_000 ? "alert" : undefined}>
          Total ownership listed: {bpsToPct(total)}%{total > 10_000 ? " — can't exceed 100%." : ""}
        </span>
        {!locked && (
          <Button type="button" size="sm" variant="soft" icon={<Icon name="plus" size={14} />} onClick={() => onChange([...rows, emptyRow(newKey())])}>Add owner</Button>
        )}
      </div>
    </div>
  );
}
