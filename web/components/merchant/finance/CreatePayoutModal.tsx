"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { useAction } from "@/lib/merchant/hooks";
import { toMinor } from "@/lib/merchant/money";
import type { BalanceRow, Payout } from "@/lib/merchant/types";
import { Button, ErrorNote, Field, Modal, Select } from "@/components/ui";
import { MoneyInput } from "../common";
import { useToast } from "../context";

/**
 * Manual payout. A blank amount pays out the whole available balance; the server checks the balance,
 * the minimum payout and the default verified bank account for the currency.
 */
export function CreatePayoutModal({ open, onClose, onDone, balances, defaultCurrency }: {
  open: boolean; onClose: () => void; onDone?: (p: Payout) => void; balances?: BalanceRow[]; defaultCurrency: string;
}) {
  const currencies = balances?.length ? balances.map((b) => b.currency) : [defaultCurrency];
  const [currency, setCurrency] = useState(currencies.includes(defaultCurrency) ? defaultCurrency : currencies[0]);
  const [amount, setAmount] = useState("");
  const act = useAction();
  const toast = useToast();
  const router = useRouter();
  const row = balances?.find((b) => b.currency === currency);
  const minor = amount.trim() ? toMinor(amount, currency) : null;
  const invalid = !!amount.trim() && (minor === null || minor <= 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    const p = await act.run(() => api<Payout>("/v1/payouts", { body: { currency, amount: minor ?? undefined } }));
    if (p) {
      toast(`Payout of ${money(p.amount, p.currency)} created`);
      onDone?.(p);
      onClose();
      router.push(`/payouts/${p.id}`);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create payout">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-[13.5px] text-muted">
          Sends money from your available balance to your default verified bank account for the currency. It usually arrives the next business day.
        </p>
        <Field label="Currency">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        {row && (
          <div className="rounded-inner bg-surface-2 px-4 py-3 text-[13px] text-text-2">
            Available to pay out: <span className="numeral text-text">{money(row.available, row.currency, { code: true })}</span>
          </div>
        )}
        <Field label="Amount (optional)" hint="Leave blank to pay out the full available balance." error={invalid ? "Enter a positive amount with at most the currency's decimals." : null}>
          <MoneyInput currency={currency} value={amount} onChange={setAmount} placeholder="Full available balance" />
        </Field>
        <div aria-live="assertive">{act.error ? <ErrorNote error={act.error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={act.busy} disabled={invalid}>
            {minor ? `Pay out ${money(minor, currency)}` : "Pay out available balance"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
