"use client";

/**
 * Staff session for the admin console: who is signed in, which admin.* permissions their platform
 * role carries, and the step-up (re-authentication) prompt that consequential actions need.
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ApiError, session } from "@/lib/api";
import { Button, Field, Input, Modal, ErrorNote } from "@/components/ui";
import { adminApi, loadDirectory, notifyChanged, resetDirectory, setLookupAccess } from "./data";
import type { Me } from "./types";

type Status = "loading" | "anonymous" | "ready";

type Ctx = {
  status: Status;
  /** True after an explicit sign-out (the login page then doesn't return to the previous page). */
  signedOut: boolean;
  me: Me | null;
  role: string | null;
  permissions: Set<string>;
  can: (perm: string) => boolean;
  canAny: (...perms: string[]) => boolean;
  login: (email: string, password: string, code?: string) => Promise<{ mfaRequired: boolean }>;
  completeMfa: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Runs an admin mutation; if the API answers step_up_required, asks for the password and retries once. */
  guard: <T>(fn: () => Promise<T>) => Promise<T>;
};

const AdminContext = createContext<Ctx | null>(null);

export function useAdmin() {
  const c = useContext(AdminContext);
  if (!c) throw new Error("useAdmin must be used inside <AdminSessionProvider>");
  return c;
}

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super admin",
  COMPLIANCE_ADMIN: "Compliance admin",
  AML_ANALYST: "AML analyst",
  FRAUD_ANALYST: "Fraud analyst",
  FINANCE_ADMIN: "Finance admin",
  SUPPORT_ADMIN: "Support admin",
  AUDITOR: "Auditor",
  LEGAL_REVIEWER: "Legal reviewer",
  REGULATORY_REPORTING: "Regulatory reporting",
  READ_ONLY_ADMIN: "Read-only admin",
};

export class StaffOnlyError extends ApiError {
  constructor() {
    super(403, "staff_only", "This console is for platform staff. Merchant and wallet accounts can't sign in here.");
  }
}

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [signedOut, setSignedOut] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

  const loadMe = useCallback(async () => {
    const m = await adminApi<Me>("/v1/me");
    if (!m.user.platform_role) throw new StaffOnlyError();
    setLookupAccess(m.admin_permissions.includes("admin.users.read"), m.admin_permissions.includes("admin.merchants.read"));
    setMe(m);
    setStatus("ready");
    void loadDirectory();
    return m;
  }, []);

  useEffect(() => {
    let alive = true;
    const start = async () => {
      if (!session.token) {
        if (alive) setStatus("anonymous");
        return;
      }
      try {
        await loadMe();
      } catch {
        if (alive) {
          setMe(null);
          setStatus("anonymous");
        }
      }
    };
    void start();
    const onUnauthorized = () => {
      setMe(null);
      setStatus("anonymous");
    };
    window.addEventListener("pa:unauthorized", onUnauthorized);
    return () => {
      alive = false;
      window.removeEventListener("pa:unauthorized", onUnauthorized);
    };
  }, [loadMe]);

  const discard = useCallback(async () => {
    try {
      await adminApi("/v1/auth/logout", { method: "POST" });
    } catch {
      /* already invalid */
    }
    session.clear();
    resetDirectory();
    setMe(null);
    setSignedOut(true);
    setStatus("anonymous");
  }, []);

  const login = useCallback(
    async (email: string, password: string, code?: string) => {
      const r = await adminApi<{ token: string; mfa_required: boolean }>("/v1/auth/login", { body: { email, password, code }, anonymous: true });
      session.clear();
      session.token = r.token;
      setSignedOut(false);
      if (r.mfa_required) return { mfaRequired: true };
      try {
        await loadMe();
      } catch (e) {
        await discard();
        throw e;
      }
      return { mfaRequired: false };
    },
    [loadMe, discard],
  );

  const completeMfa = useCallback(
    async (code: string) => {
      await adminApi("/v1/auth/mfa/verify", { body: { code } });
      try {
        await loadMe();
      } catch (e) {
        await discard();
        throw e;
      }
    },
    [loadMe, discard],
  );

  // ── Step-up prompt ──
  const [stepUp, setStepUp] = useState<{ open: boolean; error: unknown; busy: boolean }>({ open: false, error: null, busy: false });
  const pending = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const askStepUp = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        pending.current = { resolve, reject };
        setPassword("");
        setCode("");
        setStepUp({ open: true, error: null, busy: false });
      }),
    [],
  );

  const submitStepUp = async () => {
    setStepUp((s) => ({ ...s, busy: true, error: null }));
    try {
      await adminApi("/v1/auth/step-up", { body: { password, code: code || undefined } });
      setStepUp({ open: false, error: null, busy: false });
      setPassword("");
      pending.current?.resolve();
      pending.current = null;
    } catch (e) {
      setStepUp({ open: true, error: e, busy: false });
    }
  };

  const cancelStepUp = () => {
    setStepUp({ open: false, error: null, busy: false });
    pending.current?.reject(new ApiError(403, "step_up_cancelled", "Re-authentication was cancelled, so the action was not performed."));
    pending.current = null;
  };

  const guard = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      let result: T;
      try {
        result = await fn();
      } catch (e) {
        if (!(e instanceof ApiError && e.code === "step_up_required")) throw e;
        await askStepUp();
        result = await fn();
      }
      notifyChanged();
      return result;
    },
    [askStepUp],
  );

  const permissions = new Set(me?.admin_permissions ?? []);
  const value: Ctx = {
    status,
    signedOut,
    me,
    role: me?.user.platform_role ?? null,
    permissions,
    can: (p) => permissions.has(p),
    canAny: (...ps) => ps.some((p) => permissions.has(p)),
    login,
    completeMfa,
    logout: discard,
    guard,
  };

  return (
    <AdminContext.Provider value={value}>
      {children}
      <Modal
        open={stepUp.open}
        onClose={cancelStepUp}
        title="Confirm it's you"
        footer={
          <>
            <Button variant="ghost" onClick={cancelStepUp}>
              Cancel
            </Button>
            <Button onClick={submitStepUp} loading={stepUp.busy} disabled={!password}>
              Re-authenticate
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (password) void submitStepUp();
          }}
          className="space-y-4"
        >
          <p className="text-[13.5px] text-text-2">
            This action needs a recent re-authentication (valid for 10 minutes). Enter your password to continue.
          </p>
          <Field label="Password">
            <Input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {me?.user.mfa_enabled && (
            <Field label="Authentication code">
              <Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
          )}
          <ErrorNote error={stepUp.error} />
          <button type="submit" className="hidden" />
        </form>
      </Modal>
    </AdminContext.Provider>
  );
}

/** Convenience for pages: `const act = useAction(); await act(() => adminApi(...))`. */
export function useAction() {
  return useAdmin().guard;
}

export { adminApi };
