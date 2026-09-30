"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { useApi } from "@/lib/merchant/hooks";
import { toMinor } from "@/lib/merchant/money";
import type { BalanceRow, WalletBalances } from "@/lib/merchant/types";
import { Amount, Button, Card, CardHeader, Chip, ErrorNote, Field, Modal, Select, Skeleton, StatusChip } from "@/components/ui";
import { Loaded, MoneyInput } from "../common";
import { useMerchant, useStepUp, useToast } from "../context";
import { Icon } from "../icons";

/** Business wallet for merchant proceeds: its balances and the "Move to business wallet" action. */
export function BusinessWalletCard({ balances, defaultCurrency, onMoved }: { balances?: BalanceRow[]; defaultCurrency: string; onMoved: () => void }) {
  const { can } = useMerchant();
  const res = useApi<WalletBalances>("/v1/business_wallet");
  const [open, setOpen] = useState(false);
  const canMove = can("wallet.transfer") && !!balances?.some((b) => b.available > 0);

  return (
    <Card className="glass">
      <CardHeader
        title="Business wallet"
        subtitle="Keep part of your proceeds in a wallet instead of paying out to the bank."
        action={can("wallet.transfer") && (
          <Button size="sm" variant="soft" icon={<Icon name="wallet" size={15} />} onClick={() => setOpen(true)} disabled={!canMove} title={canMove ? undefined : "No available balance to move"}>
            Move to wallet
          </Button>
        )}
      />
      <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<Skeleton className="h-24" />}>
        {(w) =>
          w.activated === false || !w.balances ? (
            <div className="rounded-inner bg-surface-2 px-4 py-4 text-[13.5px] text-text-2">
              Not activated yet. Your first move from your available balance creates the wallet.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                <span className="font-mono text-text-2">{w.handle}</span>
                <StatusChip status={w.status} />
                {w.estimated_total_usd !== undefined && (
                  <Chip tone="lemon-soft">≈ {money(w.estimated_total_usd, "USD")} total</Chip>
                )}
              </div>
              {w.balances.length === 0 ? (
                <p className="text-[13px] text-muted">The wallet has no balances yet.</p>
              ) : (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {w.balances.map((b) => (
                    <li key={b.currency} className="rounded-inner bg-surface-2 p-4">
                      <div className="text-[12.5px] text-muted">Available</div>
                      <Amount minor={b.available} currency={b.currency} size="md" className="mt-1" />
                      <div className="mt-2 text-[12px] text-muted">
                        {money(b.held, b.currency)} held · {money(b.pending_incoming, b.currency)} incoming · {money(b.ledger_balance, b.currency)} ledger
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {w.estimate_note && <p className="text-[12px] text-muted">{w.estimate_note}</p>}
            </div>
          )
        }
      </Loaded>
      {open && (
        <MoveToWalletModal
          balances={balances ?? []}
          defaultCurrency={defaultCurrency}
          onClose={() => setOpen(false)}
          onDone={() => {
            res.reload();
            onMoved();
          }}
        />
      )}
    </Card>
  );
}

function MoveToWalletModal({ balances, defaultCurrency, onClose, onDone }: { balances: BalanceRow[]; defaultCurrency: string; onClose: () => void; onDone: () => void }) {
  const { live } = useMerchant();
  const withStepUp = useStepUp();
  const toast = useToast();
  const currencies = balances.length ? balances.map((b) => b.currency) : [defaultCurrency];
  const [currency, setCurrency] = useState(currencies.includes(defaultCurrency) ? defaultCurrency : currencies[0]);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const row = balances.find((b) => b.currency === currency);
  const minor = toMinor(amount, currency);
  const invalid = minor === null || minor <= 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      await withStepUp(() => api("/v1/balance/transfer_to_wallet", { body: { currency, amount: minor } }));
      toast(`${money(minor, currency)} moved to your business wallet`);
      onDone();
      onClose();
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Move to business wallet">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-[13.5px] text-muted">Moves money from your available balance into your business wallet straight away. For your security we&apos;ll ask for your password.</p>
        {live && (
          <div className="rounded-inner bg-peach-soft px-4 py-3 text-[13px] text-peach-ink">
            Wallet rails in this environment run in test mode only. Switch to test mode to try this.
          </div>
        )}
        <Field label="Currency">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        {row && (
          <div className="rounded-inner bg-surface-2 px-4 py-3 text-[13px] text-text-2">
            Available: <span className="numeral text-text">{money(row.available, row.currency, { code: true })}</span>
          </div>
        )}
        <Field label="Amount" error={amount && invalid ? "Enter a positive amount with at most the currency's decimals." : null}>
          <MoneyInput currency={currency} value={amount} onChange={setAmount} required autoFocus />
        </Field>
        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={invalid}>Move {minor && !invalid ? money(minor, currency) : ""}</Button>
        </div>
      </form>
    </Modal>
  );
}

function friendly(err: unknown) {
  if (err instanceof ApiError && err.code === "mode_mismatch")
    return { message: "Moving money to the business wallet is only available in test mode in this environment. Switch to test mode and try again.", requestId: err.requestId };
  return err;
}
