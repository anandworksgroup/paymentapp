"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Button, Chip, ErrorNote, Field, Input } from "@/components/ui";
import { useAdmin } from "@/components/admin/session";

export default function AdminLoginPage() {
  const router = useRouter();
  const { login, completeMfa, status } = useAdmin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfa, setMfa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const next = () => {
    const n = new URLSearchParams(window.location.search).get("next");
    return n && n.startsWith("/admin") && !n.startsWith("/admin/login") ? n : "/admin";
  };

  useEffect(() => {
    if (status === "ready") router.replace(next());
  }, [status, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mfa) await completeMfa(code);
      else {
        const r = await login(email.trim(), password);
        if (r.mfaRequired) {
          setMfa(true);
          return;
        }
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full sage-gradient text-[18px] text-sage-700">◎</span>
          <div>
            <div className="text-[15px] font-medium text-text">Monetization Platform</div>
            <div className="text-[12.5px] text-muted">Admin, compliance, risk &amp; audit console</div>
          </div>
        </div>
        <form onSubmit={submit} className="card space-y-5 p-8">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Chip tone="ink">Staff only</Chip>
              <Chip tone="lemon">Sandbox</Chip>
            </div>
            <h1 className="text-[30px] font-normal leading-tight tracking-[-0.03em] text-text">{mfa ? "Enter your code" : "Sign in"}</h1>
            <p className="mt-1.5 text-[13.5px] text-muted">
              {mfa ? "Enter the 6-digit code from your authenticator app." : "Only accounts with a platform role can use this console. Every view and action is logged."}
            </p>
          </div>
          {mfa ? (
            <Field label="Authentication code">
              <Input autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
          ) : (
            <>
              <Field label="Work email">
                <Input type="email" autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              <Field label="Password">
                <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </Field>
            </>
          )}
          <ErrorNote error={error} />
          <Button type="submit" loading={busy} className="w-full">
            {mfa ? "Verify" : "Sign in"}
          </Button>
        </form>
        <p className="mt-5 px-2 text-center text-[12px] leading-relaxed text-muted">
          Sandbox staff accounts: admin@, compliance@, analyst@, finance@, support@ and auditor@demo.test.
        </p>
      </div>
    </div>
  );
}
