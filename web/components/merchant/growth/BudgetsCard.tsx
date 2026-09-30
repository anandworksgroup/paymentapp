"use client";

import { useState } from "react";
import { api, type List } from "@/lib/api";
import { useAction, useApi } from "@/lib/merchant/hooks";
import type { Meter as MeterType } from "@/lib/merchant/types";
import { Button, Card, CardHeader, Chip, ErrorNote, Field, Input, Modal, Segmented, Select } from "@/components/ui";
import { useMerchant, useToast } from "../context";
import { ConfirmModal, InfoPopover, Loaded, ListSkeleton } from "../common";
import { Icon } from "../icons";
import { parseCount } from "../sales/links";
import { Meter } from "./helpers";
import type { BudgetRow, CustomerBudget } from "./types";

/** Month-to-date usage caps for one customer (GET/POST/DELETE /v1/customers/{id}/budgets). */
export function BudgetsCard({ customerId, readOnly }: { customerId: string; readOnly?: boolean }) {
  const { can } = useMerchant();
  const res = useApi<List<BudgetRow>>(can("usage.read") ? `/v1/customers/${customerId}/budgets` : null);
  const meters = useApi<List<MeterType>>(can("usage.read") ? "/v1/meters?limit=100" : null);
  const toast = useToast();
  const del = useAction();
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<CustomerBudget | null>(null);
  if (!can("usage.read")) return null;

  const canWrite = can("usage.write") && !readOnly;
  const meterFor = (event: string) => meters.data?.data.find((m) => m.event_name === event);
  const title = (event: string) => (event === "*" ? "All metered usage" : meterFor(event)?.display_name ?? event);
  // Deleting only deactivates a budget; the list still returns it, so hide inactive ones here.
  const rows = (res.data?.data ?? []).filter((r) => r.budget.active);

  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-1.5">Usage budgets <InfoPopover label="Usage budgets">A monthly cap on metered usage for this customer. At each threshold you get an in-app alert and a usage.threshold_reached webhook; hard budgets also reject usage events that would go over the limit. Counts reset on the 1st (UTC).</InfoPopover></span>}
        subtitle="This month, per meter"
        action={canWrite && <Button size="sm" variant="soft" icon={<Icon name="plus" size={14} />} onClick={() => setCreating(true)}>Add</Button>}
      />
      <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<ListSkeleton rows={2} />}>
        {() =>
          rows.length === 0 ? (
            <p className="text-[13px] text-muted">No budgets. Add one to alert on, or cap, this customer&apos;s monthly usage.</p>
          ) : (
            <ul className="space-y-3">
              {rows.map(({ budget: b, month_to_date, used_pct }) => {
                const unit = b.event_name === "*" ? "units" : meterFor(b.event_name)?.unit ?? "units";
                const over = month_to_date >= b.monthly_limit;
                return (
                  <li key={b.id} className="rounded-inner bg-surface-2 p-4">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] text-text">{title(b.event_name)}</div>
                        <div className="text-[12px] text-muted">Alerts at {b.thresholds_csv.split(",").map((t) => `${t}%`).join(", ")}</div>
                      </div>
                      <span className="flex shrink-0 items-center gap-1">
                        <Chip tone={b.mode === "hard" ? "peach" : "sky"}>{b.mode === "hard" ? "Hard cap" : "Soft"}</Chip>
                        {canWrite && (
                          <button type="button" aria-label={`Remove budget for ${title(b.event_name)}`} onClick={() => { del.setError(null); setRemoving(b); }} className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-text">
                            <Icon name="close" size={13} />
                          </button>
                        )}
                      </span>
                    </div>
                    <Meter value={month_to_date} max={b.monthly_limit} tone={over ? "rose" : used_pct >= 90 ? "peach" : used_pct >= 75 ? "lemon" : "sage"} label={`${title(b.event_name)} budget used`} />
                    <div className="mt-1.5 flex items-baseline justify-between text-[12.5px]">
                      <span className="numeral text-text">{month_to_date.toLocaleString("en-US")} <span className="text-muted">/ {b.monthly_limit.toLocaleString("en-US")} {unit}</span></span>
                      <span className={over ? "text-rose-ink" : "text-muted"}>{used_pct}%{over && b.mode === "hard" ? " · blocking new usage" : ""}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        }
      </Loaded>

      {creating && <BudgetModal customerId={customerId} meters={meters.data?.data ?? []} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); res.reload(); }} />}

      <ConfirmModal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove this budget?"
        confirmLabel="Remove budget"
        danger
        busy={del.busy}
        error={del.error}
        onConfirm={async () => {
          if (!removing) return;
          const ok = await del.run(async () => {
            await api(`/v1/customers/${customerId}/budgets/${removing.id}`, { method: "DELETE" });
            return true;
          });
          if (ok) {
            toast("Budget removed");
            setRemoving(null);
            res.reload();
          }
        }}
      >
        {removing?.mode === "hard" ? "Usage events are no longer capped for this meter and no more alerts are sent." : "No more threshold alerts are sent for this meter."} Usage already recorded is not changed.
      </ConfirmModal>
    </Card>
  );
}

function BudgetModal({ customerId, meters, onClose, onCreated }: { customerId: string; meters: MeterType[]; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [event, setEvent] = useState("*");
  const [limit, setLimit] = useState("");
  const [mode, setMode] = useState<"soft" | "hard">("soft");
  const [thresholds, setThresholds] = useState("50,75,90,100");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const limitN = parseCount(limit.replace(/[,_\s]/g, ""));
  const parts = thresholds.split(",").map((t) => t.trim());
  const thresholdsOk = parts.every((t) => /^\d{1,3}$/.test(t) && Number(t) >= 1 && Number(t) <= 100);
  const unit = event === "*" ? "units" : meters.find((m) => m.event_name === event)?.unit ?? "units";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!limitN || !thresholdsOk) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/customers/${customerId}/budgets`, { body: { event_name: event, monthly_limit: limitN, mode, thresholds: parts.join(",") } });
      toast("Budget added");
      onCreated();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Add a usage budget">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Meter">
          <Select value={event} onChange={(e) => setEvent(e.target.value)}>
            <option value="*">All metered usage</option>
            {meters.map((m) => <option key={m.id} value={m.event_name}>{m.display_name} ({m.event_name})</option>)}
          </Select>
        </Field>
        <Field label="Monthly limit" error={limit && !limitN ? "A whole number, 1 or more." : null}>
          <div className="relative">
            <Input inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} required autoFocus placeholder="100000" className="pr-20" />
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] text-muted">{unit}</span>
          </div>
        </Field>
        <div>
          <div className="mb-1.5 text-[12.5px] font-medium text-text-2">When the limit is reached</div>
          <Segmented<"soft" | "hard"> value={mode} onChange={setMode} options={[{ value: "soft", label: "Alert only (soft)" }, { value: "hard", label: "Block usage (hard)" }]} />
          <p className="mt-2 text-[12.5px] text-muted">
            {mode === "hard"
              ? "Usage events over the limit are rejected until next month. Use this to protect customers from surprise bills."
              : "Usage keeps being accepted and billed; you get an in-app alert and a usage.threshold_reached webhook at each threshold."}
          </p>
        </div>
        <Field label="Alert thresholds" hint="Percentages of the limit, comma-separated." error={!thresholdsOk ? "Whole percentages from 1 to 100, e.g. 50,75,90,100." : null}>
          <Input value={thresholds} onChange={(e) => setThresholds(e.target.value)} />
        </Field>
        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!limitN || !thresholdsOk}>Add budget</Button>
        </div>
      </form>
    </Modal>
  );
}
