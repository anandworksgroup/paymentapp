"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, session } from "@/lib/api";
import type { Me } from "@/lib/merchant/types";
import { FALLBACK_ROLES } from "@/lib/merchant/permissions";
import { Button, Card, ErrorNote, Field, Input, Select, Spinner } from "@/components/ui";
import { MerchantProvider, StepUpProvider, ToastProvider, useMerchantValue } from "./context";
import { Shell } from "./Shell";
import { useCountries } from "./useMeta";

type Boot = { me: Me; roles: Record<string, string[]>; live: boolean; orgId: string | null };

async function boot(): Promise<Boot> {
  const me = await api<Me>("/v1/me", { noOrg: true });
  const org = me.organizations.find((o) => o.id === session.orgId) ?? me.organizations[0];
  session.orgId = org?.id ?? null;
  // Live mode can only be on for organizations already in production.
  if (session.live && org?.go_live_state !== "PRODUCTION") session.live = false;
  let roles = FALLBACK_ROLES;
  if (org) {
    try {
      const team = await api<{ roles: Record<string, string[]> }>("/v1/team");
      roles = team.roles;
    } catch {
      /* no team.read — fall back to the mirrored role map */
    }
  }
  return { me, roles, live: session.live, orgId: org?.id ?? null };
}

export function MerchantGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<Boot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  // Session gate + boot.
  useEffect(() => {
    if (!session.token) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    let cancelled = false;
    boot().then(
      (b) => !cancelled && setState(b),
      (e) => !cancelled && setError(e),
    );
    return () => {
      cancelled = true;
    };
    // pathname is only used for the first redirect; re-booting on every navigation is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, attempt]);

  // Any 401 from the API (expired or revoked session) sends the user back to sign in.
  useEffect(() => {
    const onUnauthorized = () => {
      session.clear();
      router.replace("/login?expired=1");
    };
    window.addEventListener("pa:unauthorized", onUnauthorized);
    return () => window.removeEventListener("pa:unauthorized", onUnauthorized);
  }, [router]);

  const setLive = useCallback((v: boolean) => {
    session.live = v;
    setState((s) => (s ? { ...s, live: v } : s));
  }, []);

  const switchOrg = useCallback(
    (id: string) => {
      session.orgId = id;
      session.live = false;
      setState(null);
      setAttempt((a) => a + 1);
      router.push("/dashboard");
    },
    [router],
  );

  const refreshMe = useCallback(async () => {
    const b = await boot();
    setState(b);
  }, []);

  const handlers = useMemo(() => ({ setLive, switchOrg, refreshMe }), [setLive, switchOrg, refreshMe]);
  const value = useMerchantValue(state?.me ?? null, state?.roles ?? null, state?.live ?? false, handlers);

  if (error)
    return (
      <Centered>
        <Card className="w-full max-w-md">
          <h1 className="mb-3 text-[22px] tracking-[-0.02em]">We couldn&apos;t load your account</h1>
          <ErrorNote error={error} />
          <div className="mt-5 flex gap-2">
            <Button onClick={() => { setError(null); setAttempt((a) => a + 1); }}>Try again</Button>
            <Button variant="ghost" onClick={() => { session.clear(); router.replace("/login"); }}>Sign out</Button>
          </div>
        </Card>
      </Centered>
    );

  if (!state)
    return (
      <Centered>
        <div className="flex items-center gap-3 text-[14px] text-muted" role="status">
          <Spinner /> Loading your workspace…
        </div>
      </Centered>
    );

  if (!value && state.me.admin_permissions.length > 0)
    return (
      <Centered>
        <Card className="w-full max-w-md">
          <h1 className="text-[24px] tracking-[-0.03em]">This is a staff account</h1>
          <p className="mb-5 mt-1.5 text-[13.5px] text-muted">{state.me.user.email} works in the admin console and isn&apos;t a member of any merchant organization.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => router.push("/admin")}>Open admin console</Button>
            <Button variant="ghost" onClick={() => { session.clear(); router.replace("/login"); }}>Sign in as a merchant</Button>
          </div>
        </Card>
      </Centered>
    );

  if (!value) return <CreateFirstOrg onCreated={() => setAttempt((a) => a + 1)} />;

  return (
    <ToastProvider>
      <MerchantProvider value={value}>
        <StepUpProvider mfa={state.me.user.mfa_enabled}>
          <Shell>
            {/* Re-mount every page when the org or test/live mode changes so all data reloads. */}
            <div key={`${value.org.id}:${value.live}`}>{children}</div>
          </Shell>
        </StepUpProvider>
      </MerchantProvider>
    </ToastProvider>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="grid min-h-screen place-items-center p-4">{children}</div>;
}

function CreateFirstOrg({ onCreated }: { onCreated: () => void }) {
  const countries = useCountries();
  const [name, setName] = useState("");
  const [country, setCountry] = useState("US");
  const [currency, setCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Centered>
      <Card className="w-full max-w-md">
        <h1 className="text-[26px] tracking-[-0.03em]">Create your organization</h1>
        <p className="mt-1 mb-5 text-[13.5px] text-muted">Your account isn&apos;t part of an organization yet. Create one to start in test mode.</p>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const org = await api<{ id: string }>("/v1/organizations", { body: { name, country, currency }, noOrg: true });
              session.orgId = org.id;
              onCreated();
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Organization name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Country">
              <Select value={country} onChange={(e) => setCountry(e.target.value)}>
                {countries.filter((c) => c.merchant_onboarding_enabled).map((c) => <option key={c.country} value={c.country}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Currency"><Input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></Field>
          </div>
          <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
          <Button type="submit" loading={busy} className="w-full">Create organization</Button>
        </form>
      </Card>
    </Centered>
  );
}
