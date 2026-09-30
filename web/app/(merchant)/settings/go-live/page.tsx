"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/merchant/hooks";
import type { Checklist, Organization } from "@/lib/merchant/types";
import { Button, Card, CardHeader, Chip, PageHeader, StatusChip, cx } from "@/components/ui";
import { useMerchant, useStepUp, useToast } from "@/components/merchant/context";
import { ConfirmModal, DetailSkeleton, Help, Loaded, NoAccess } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { SettingsNav } from "@/components/merchant/settings/shared";

const FIX: Record<string, { href: string; cta: string }> = {
  business_verification: { href: "/settings/verification", cta: "Complete verification" },
  payout_account: { href: "/settings/payout-accounts", cta: "Add a bank account" },
  product: { href: "/products?new=1", cta: "Create a product" },
  price: { href: "/products", cta: "Add a price" },
  checkout: { href: "/payment-links?new=1", cta: "Create a payment link" },
  webhook: { href: "/developers/webhooks", cta: "Add an endpoint" },
  test_payment: { href: "/payment-links", cta: "Pay a link with a test card" },
};

const STATE: Record<string, { label: string; tone: "sage" | "lemon-soft" | "peach" | "neutral" | "sky" }> = {
  done: { label: "Done", tone: "sage" }, todo: { label: "To do", tone: "neutral" }, in_progress: { label: "In progress", tone: "lemon-soft" },
  attention: { label: "Needs attention", tone: "peach" }, optional: { label: "Optional", tone: "sky" },
};

export default function GoLivePage() {
  const { can, refreshMe, setLive } = useMerchant();
  const withStepUp = useStepUp();
  const toast = useToast();
  const allowed = can("team.read");
  const canActivate = can("org.manage");
  const list = useApi<Checklist>(allowed ? "/v1/organization/checklist" : null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!allowed) return <NoAccess what="the go-live checklist" />;

  const activate = async () => {
    setBusy(true);
    setError(null);
    try {
      await withStepUp(() => api<Organization>("/v1/organization/go_live", { method: "POST" }));
      setConfirm(false);
      toast("Production activated");
      list.reload();
      await refreshMe();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Go live" subtitle="Everything that needs to be in place before you accept real payments." />
      <SettingsNav current="/settings/go-live" />
      <Loaded data={list.data} error={list.error} onRetry={list.reload} skeleton={<DetailSkeleton />}>
        {(c) => {
          const live = c.go_live_state === "PRODUCTION";
          const required = c.items.filter((i) => i.key !== "go_live" && i.state !== "optional");
          const done = required.filter((i) => i.state === "done").length;
          return (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <Card className="min-w-0">
                <CardHeader title="Setup checklist" subtitle={`${done} of ${required.length} required steps complete`} />
                <div className="mb-5 h-2.5 rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={required.length} aria-valuenow={done} aria-label="Checklist progress">
                  <div className="h-2.5 rounded-full bg-sage-300 transition-all" style={{ width: `${required.length ? (done / required.length) * 100 : 0}%` }} />
                </div>
                <ol className="space-y-2">
                  {c.items.map((i) => {
                    const st = STATE[i.state] ?? STATE.todo;
                    const fix = FIX[i.key];
                    return (
                      <li key={i.key} className="flex flex-wrap items-center gap-3 rounded-inner bg-surface-2 px-4 py-3">
                        <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-full", i.state === "done" ? "bg-sage-500 text-white" : i.state === "attention" ? "bg-peach text-peach-ink" : "border border-line-strong bg-surface text-faint")}>
                          {i.state === "done" ? <Icon name="check" size={14} /> : i.state === "attention" ? <Icon name="alert" size={13} /> : null}
                        </span>
                        <span className={cx("min-w-0 flex-1 text-[13.5px]", i.state === "done" ? "text-muted" : "text-text")}>{i.label}</span>
                        <Chip tone={st.tone}>{st.label}</Chip>
                        {i.state !== "done" && fix && (
                          <Link href={fix.href} className="inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-[12.5px] text-text-2 hover:bg-surface-3">
                            {fix.cta} <Icon name="right" size={13} />
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </Card>

              {live ? (
                <Card className="sage-gradient">
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-white/70 text-sage-700"><Icon name="rocket" size={22} /></span>
                  <h2 className="mt-4 text-[22px] font-normal tracking-[-0.02em] text-text">You&apos;re live</h2>
                  <p className="mt-1.5 text-[13.5px] text-text-2">Production is active. Switch to Live with the toggle at the top to see real payments. Test mode stays available for trying things out.</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button onClick={() => setLive(true)}>Switch to live</Button>
                    <Link href="/developers/api-keys" className="inline-flex h-11 items-center rounded-full bg-white/70 px-5 text-[14px] font-medium text-text hover:bg-white">Create live API keys</Link>
                  </div>
                </Card>
              ) : (
                <Card className={c.can_go_live ? "lemon-gradient" : undefined}>
                  <CardHeader title="Activate production" action={<StatusChip status={c.status} />} />
                  {c.can_go_live ? (
                    <p className="text-[13.5px] text-text-2">All required steps are done. Activating production unlocks live mode, live API keys and real payouts.</p>
                  ) : (
                    <p className="text-[13.5px] text-text-2">Finish the required steps first. Webhooks are optional but recommended so your systems hear about payments.</p>
                  )}
                  <div className="mt-5">
                    {canActivate ? (
                      <Button disabled={!c.can_go_live} icon={<Icon name="rocket" size={16} />} onClick={() => { setError(null); setConfirm(true); }}>Activate production</Button>
                    ) : (
                      <Help>Only owners and admins can activate production.</Help>
                    )}
                  </div>
                  <ul className="mt-5 space-y-2 text-[12.5px] text-text-2">
                    <li className="flex gap-2"><Icon name="shield" size={15} className="mt-0.5 shrink-0" /> Test data stays separate — nothing from test mode moves to live.</li>
                    <li className="flex gap-2"><Icon name="lock" size={15} className="mt-0.5 shrink-0" /> You may be asked to confirm your password before activating.</li>
                  </ul>
                </Card>
              )}
            </div>
          );
        }}
      </Loaded>

      <ConfirmModal open={confirm} onClose={() => setConfirm(false)} title="Activate production?" confirmLabel="Activate production" busy={busy} error={error} onConfirm={activate}>
        <p>From now on you can accept real payments in live mode. Live payments move real money and follow your payout schedule.</p>
        <p>If you haven&apos;t confirmed your password in the last 10 minutes, you&apos;ll be asked to.</p>
      </ConfirmModal>
    </>
  );
}
