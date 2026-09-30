"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { api } from "@/lib/api";
import { date, titleCase } from "@/lib/format";
import { useAction, useApi } from "@/lib/merchant/hooks";
import type { Customer } from "@/lib/merchant/types";
import { Button, Chip, Empty, ErrorNote, Modal, Segmented } from "@/components/ui";
import { useToast } from "../context";
import { Help, Loaded, ListSkeleton } from "../common";
import { Icon } from "../icons";
import { CustomerPicker } from "../pickers";
import type { CustomerMergeResult, DuplicateCandidates, DuplicateGroup } from "./types";

type Who = { id: string; name?: string | null; email?: string | null };
const label = (c: Who) => c.name ?? c.email ?? c.id;

/** What a merge moves, from ImportService.Merge — shown before every merge. */
export function MergeExplainer({ duplicate, survivor }: { duplicate: Who; survivor: Who }) {
  return (
    <div className="space-y-3 text-[13.5px] text-text-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <div className="min-w-0 rounded-inner bg-peach-soft px-4 py-3">
          <div className="text-[11.5px] text-peach-ink">Duplicate — becomes read-only</div>
          <div className="truncate text-text">{label(duplicate)}</div>
          <div className="truncate font-mono text-[11.5px] text-muted">{duplicate.id}</div>
        </div>
        <Icon name="right" size={18} className="text-muted" />
        <div className="min-w-0 rounded-inner bg-sage-100 px-4 py-3">
          <div className="text-[11.5px] text-sage-700">Kept</div>
          <div className="truncate text-text">{label(survivor)}</div>
          <div className="truncate font-mono text-[11.5px] text-muted">{survivor.id}</div>
        </div>
      </div>
      <div>
        <div className="mb-1 font-medium text-text">Moves to the kept customer</div>
        <p>Orders, payments, subscriptions, invoices, payment methods, entitlements, usage events, checkout sessions and usage budgets. Credit balances move with paired ledger entries, and the affiliate referral moves if the kept customer has none.</p>
      </div>
      <div>
        <div className="mb-1 font-medium text-text">Profile</div>
        <p>Blank fields on the kept customer (name, phone, country, tax ID, external ID, default payment method) are filled from the duplicate. Nothing already set is overwritten.</p>
      </div>
      <div>
        <div className="mb-1 font-medium text-text">The duplicate</div>
        <p>Stays as a read-only tombstone that points to the kept customer, so old links, receipts and audit entries still resolve. Its external ID is cleared. A merge can&apos;t be undone.</p>
      </div>
    </div>
  );
}

function movedSummary(moved: Record<string, number>) {
  const parts = Object.entries(moved).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${titleCase(k.replace(/^credits_/, "credits ")).toLowerCase()}`);
  return parts.length ? parts.join(", ") : "no linked records";
}

/** Merge action on a customer's page: either this customer is the duplicate, or another one merges into it. */
export function MergeButton({ customer }: { customer: Customer }) {
  const router = useRouter();
  const toast = useToast();
  const act = useAction();
  const pickerId = useId();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"into_other" | "into_this">("into_other");
  const [other, setOther] = useState<Customer | null>(null);
  const [confirming, setConfirming] = useState(false);

  const duplicate = direction === "into_other" ? customer : other;
  const survivor = direction === "into_other" ? other : customer;
  const sameCustomer = !!other && other.id === customer.id;

  const close = () => {
    setOpen(false);
    setConfirming(false);
    setOther(null);
    act.setError(null);
  };

  const merge = async () => {
    if (!duplicate || !survivor) return;
    const r = await act.run(() => api<CustomerMergeResult>(`/v1/customers/${duplicate.id}/merge`, { body: { into: survivor.id } }));
    if (r) {
      toast(`Merged: moved ${movedSummary(r.moved)}`);
      close();
      router.push(`/customers/${r.survivor}`);
    }
  };

  return (
    <>
      <Button variant="soft" icon={<Icon name="merge" size={16} />} onClick={() => setOpen(true)}>Merge</Button>
      <Modal
        open={open}
        onClose={close}
        title={confirming ? "Confirm merge" : "Merge duplicate customers"}
        wide
        footer={
          confirming ? (
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)}>Back</Button>
              <Button variant="danger" loading={act.busy} onClick={merge}>Merge permanently</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button disabled={!other || sameCustomer} onClick={() => setConfirming(true)}>Review merge</Button>
            </>
          )
        }
      >
        {confirming && duplicate && survivor ? (
          <MergeExplainer duplicate={duplicate} survivor={survivor} />
        ) : (
          <div className="space-y-4">
            <Segmented
              value={direction}
              onChange={setDirection}
              options={[{ value: "into_other", label: "Merge this into another" }, { value: "into_this", label: "Merge another into this" }]}
            />
            <div>
              <label htmlFor={pickerId} className="mb-1.5 block text-[12.5px] font-medium text-text-2">
                {direction === "into_other" ? "Customer to keep" : "Duplicate to merge in"}
              </label>
              <CustomerPicker id={pickerId} value={other} onChange={setOther} />
              {sameCustomer && <p className="mt-1 text-[12px] text-rose-ink">Choose a different customer.</p>}
            </div>
            <Help>
              {direction === "into_other"
                ? <>{label(customer)} becomes a read-only record and everything linked to it moves to the customer you pick.</>
                : <>The customer you pick becomes a read-only record and everything linked to it moves to {label(customer)}.</>}
            </Help>
          </div>
        )}
        <div aria-live="assertive" className="mt-3">{act.error ? <ErrorNote error={act.error} /> : null}</div>
      </Modal>
    </>
  );
}

/** Banner on a merged customer (tombstone). */
export function MergedBanner({ intoId }: { intoId: string }) {
  const survivor = useApi<{ customer: Customer }>(`/v1/customers/${intoId}`);
  const s = survivor.data?.customer;
  return (
    <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-inner bg-surface-3 px-5 py-4 text-[13.5px] text-text-2">
      <span className="flex items-center gap-2">
        <Icon name="merge" size={16} />
        <span>
          Merged into{" "}
          <Link href={`/customers/${intoId}`} className="font-medium text-text underline-offset-4 hover:underline">{s ? label(s) : intoId}</Link>
          . This record is a read-only tombstone kept for history; its orders, payments and subscriptions now live on that customer.
        </span>
      </span>
      <Link href={`/customers/${intoId}`} className="inline-flex h-8 items-center gap-1 rounded-full bg-ink px-3.5 text-[12.5px] font-medium text-white hover:bg-ink-2">
        Open customer <Icon name="right" size={14} />
      </Link>
    </div>
  );
}

/** "Possible duplicates" view on the customers list (GET /v1/customers/duplicates). */
export function DuplicatesPanel({ canMerge }: { canMerge: boolean }) {
  const res = useApi<DuplicateCandidates>("/v1/customers/duplicates");
  return (
    <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<ListSkeleton rows={4} />}>
      {(d) =>
        d.data.length === 0 ? (
          <Empty title="No likely duplicates" icon={<Icon name="users" />}>
            We look for customers sharing an email address (ignoring case) or a phone number. Nothing matches right now.
          </Empty>
        ) : (
          <div className="space-y-4">
            <Help>
              {d.data.length} group{d.data.length === 1 ? "" : "s"} of customers share an email or phone number. These are candidates only — check they are really the same person or business before merging.
            </Help>
            {d.data.map((g) => <DuplicateGroupCard key={`${g.match}:${g.value}`} group={g} canMerge={canMerge} onMerged={res.reload} />)}
          </div>
        )
      }
    </Loaded>
  );
}

function DuplicateGroupCard({ group, canMerge, onMerged }: { group: DuplicateGroup; canMerge: boolean; onMerged: () => void }) {
  const toast = useToast();
  const act = useAction();
  const name = useId();
  const [keep, setKeep] = useState(group.customers[0].id);
  const [confirming, setConfirming] = useState(false);
  const survivor = group.customers.find((c) => c.id === keep)!;
  const duplicates = group.customers.filter((c) => c.id !== keep);

  const merge = async () => {
    const results = await act.run(async () => {
      const done: CustomerMergeResult[] = [];
      for (const c of duplicates) done.push(await api<CustomerMergeResult>(`/v1/customers/${c.id}/merge`, { body: { into: keep } }));
      return done;
    });
    if (results) {
      toast(`Merged ${results.length} customer${results.length === 1 ? "" : "s"} into ${label(survivor)}`);
      setConfirming(false);
      onMerged();
    } else onMerged(); // some merges may have gone through before an error
  };

  return (
    <section aria-label={`Customers with the same ${group.match}`} className="rounded-inner bg-surface-2">
      <div className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="flex flex-wrap items-center gap-2 text-[13px]">
            <Chip tone="lemon">Same {group.match}</Chip>
            <span className="font-mono text-[12.5px] text-text-2">{group.value}</span>
          </span>
          {canMerge && (
            <Button size="sm" icon={<Icon name="merge" size={14} />} onClick={() => { act.setError(null); setConfirming(true); }}>
              {duplicates.length === 1 ? "Merge duplicate" : `Merge ${duplicates.length} duplicates`}
            </Button>
          )}
        </div>
        <fieldset>
          <legend className="sr-only">Choose which customer to keep</legend>
          <ul className="space-y-1.5">
            {group.customers.map((c, i) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-[14px] bg-surface px-4 py-3">
                {canMerge && (
                  <input type="radio" name={name} checked={keep === c.id} onChange={() => setKeep(c.id)} aria-label={`Keep ${label(c)}`} className="h-4 w-4 accent-[var(--ink)]" />
                )}
                <Link href={`/customers/${c.id}`} className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-text">{c.name ?? c.email ?? c.id}</span>
                  <span className="block truncate text-[12px] text-muted">{[c.email, c.phone, c.id].filter(Boolean).join(" · ")}</span>
                </Link>
                {i === 0 && <Chip tone="neutral">Oldest</Chip>}
                {keep === c.id ? <Chip tone="sage">Keep</Chip> : <Chip tone="peach">Merge</Chip>}
                <span className="text-[12px] text-muted">Created {date(c.created_at)}</span>
              </li>
            ))}
          </ul>
        </fieldset>
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Merge ${duplicates.length} customer${duplicates.length === 1 ? "" : "s"}?`}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="danger" loading={act.busy} onClick={merge}>Merge permanently</Button>
          </>
        }
      >
        {duplicates.length > 1 && <p className="mb-3 text-[13px] text-muted">Each duplicate is merged one after another into the kept customer.</p>}
        <MergeExplainer duplicate={duplicates.length === 1 ? duplicates[0] : { id: duplicates.map((c) => c.id).join(", "), name: `${duplicates.length} duplicates` }} survivor={survivor} />
        <div aria-live="assertive" className="mt-3">{act.error ? <ErrorNote error={act.error} /> : null}</div>
      </Modal>
    </section>
  );
}
