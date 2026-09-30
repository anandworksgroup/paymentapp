"use client";

import { Button, Modal } from "@/components/ui";
import { Amount } from "@/components/ui";

/** Simulated 3-D Secure challenge (sandbox): the buyer "authenticates" with their bank or fails. */
export function ThreeDSModal({ open, merchant, total, currency, busy, onResult }: {
  open: boolean; merchant: string; total: number; currency: string; busy: "pass" | "fail" | null; onResult: (r: "pass" | "fail") => void;
}) {
  return (
    <Modal open={open} onClose={() => !busy && onResult("fail")} title="Confirm with your bank">
      <div className="space-y-4">
        <div className="rounded-inner sage-gradient p-5">
          <div className="text-[12px] text-text-2">Payment to {merchant}</div>
          <Amount minor={total} currency={currency} size="md" className="mt-1" />
          <div className="mt-3 text-[12px] text-text-2">Verified by your card issuer · 3-D Secure</div>
        </div>
        <p className="text-[13.5px] text-muted">
          Your bank asks you to confirm this payment. This is a <strong className="font-medium text-text">test-mode simulation</strong> of the bank&apos;s screen — choose an outcome.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button className="flex-1" loading={busy === "pass"} disabled={!!busy} onClick={() => onResult("pass")} autoFocus>Authenticate</Button>
          <Button className="flex-1" variant="danger" loading={busy === "fail"} disabled={!!busy} onClick={() => onResult("fail")}>Fail authentication</Button>
        </div>
      </div>
    </Modal>
  );
}
