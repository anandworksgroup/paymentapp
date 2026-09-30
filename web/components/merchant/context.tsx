"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, session } from "@/lib/api";
import type { Me, OrgSummary } from "@/lib/merchant/types";
import { Button, Field, Input, Modal, ErrorNote } from "@/components/ui";

// ───────────────────────── Merchant session ─────────────────────────

export type MerchantCtx = {
  me: Me;
  org: OrgSummary;
  role: string;
  permissions: Set<string>;
  can: (perm?: string) => boolean;
  live: boolean;
  canGoLive: boolean;
  setLive: (v: boolean) => void;
  switchOrg: (id: string) => void;
  refreshMe: () => Promise<void>;
};

const Ctx = createContext<MerchantCtx | null>(null);

export function MerchantProvider({ value, children }: { value: MerchantCtx; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMerchant() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMerchant must be used inside the merchant shell");
  return v;
}

/** Renders children only when the member's role holds the permission. */
export function Can({ perm, children, fallback = null }: { perm: string; children: ReactNode; fallback?: ReactNode }) {
  const { can } = useMerchant();
  return <>{can(perm) ? children : fallback}</>;
}

// ───────────────────────── Toasts ─────────────────────────

type Toast = { id: number; text: string; tone: "ok" | "error" };
const ToastCtx = createContext<(text: string, tone?: "ok" | "error") => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const push = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    const id = next.current++;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto rounded-full px-5 py-2.5 text-[13px] shadow-float ${t.tone === "ok" ? "bg-ink text-white" : "bg-rose-soft text-rose-ink"}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

// ───────────────────────── Step-up re-authentication ─────────────────────────

type StepUpFn = <T>(fn: () => Promise<T>) => Promise<T>;
const StepUpCtx = createContext<StepUpFn>((fn) => fn());

/**
 * High-risk actions (payout accounts, go-live, large refunds, live keys, wallet transfers) need a
 * re-authentication in the last 10 minutes. `withStepUp(fn)` runs fn; if the API answers
 * `step_up_required` it asks for the password, calls /v1/auth/step-up and retries once.
 */
export function StepUpProvider({ mfa, children }: { mfa: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const pending = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);

  const ask = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        pending.current = { resolve, reject };
        setPassword("");
        setCode("");
        setError(null);
        setOpen(true);
      }),
    [],
  );

  const withStepUp = useCallback<StepUpFn>(
    async (fn) => {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof ApiError && e.code === "step_up_required") {
          await ask();
          return await fn();
        }
        throw e;
      }
    },
    [ask],
  );

  const cancel = () => {
    setOpen(false);
    pending.current?.reject(new ApiError(0, "step_up_cancelled", "Re-authentication was cancelled."));
    pending.current = null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/v1/auth/step-up", { body: { password, code: code || undefined }, noOrg: true });
      setOpen(false);
      pending.current?.resolve();
      pending.current = null;
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepUpCtx.Provider value={withStepUp}>
      {children}
      <Modal open={open} onClose={cancel} title="Confirm it's you">
        <form onSubmit={submit} className="space-y-4">
          <p className="text-[13.5px] text-muted">This action moves money or changes security settings, so we need your password again. You won&apos;t be asked again for 10 minutes.</p>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" autoFocus required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {mfa && (
            <Field label="Authenticator code" hint="6 digits from your authenticator app">
              <Input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
          )}
          <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={cancel}>Cancel</Button>
            <Button type="submit" loading={busy}>Confirm</Button>
          </div>
        </form>
      </Modal>
    </StepUpCtx.Provider>
  );
}

export function useStepUp() {
  return useContext(StepUpCtx);
}

/** Helper for pages that build the context value. */
export function useMerchantValue(me: Me | null, roles: Record<string, string[]> | null, live: boolean, handlers: Pick<MerchantCtx, "setLive" | "switchOrg" | "refreshMe">): MerchantCtx | null {
  return useMemo(() => {
    if (!me) return null;
    const org = me.organizations.find((o) => o.id === session.orgId) ?? me.organizations[0];
    if (!org) return null;
    const perms = new Set(roles?.[org.role] ?? []);
    return {
      me,
      org,
      role: org.role,
      permissions: perms,
      can: (p?: string) => !p || perms.has(p),
      live,
      canGoLive: org.go_live_state === "PRODUCTION",
      ...handlers,
    };
  }, [me, roles, live, handlers]);
}
