"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, session } from "@/lib/api";
import type { User } from "@/lib/merchant/types";
import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { AuthLayout } from "@/components/merchant/AuthLayout";

type LoginResponse = { token: string; mfa_required: boolean; user: User | null };

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <Login />
    </Suspense>
  );
}

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"password" | "mfa">("password");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const next = params.get("next");
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      session.clear();
      const r = await api<LoginResponse>("/v1/auth/login", { body: { email, password }, anonymous: true });
      session.token = r.token;
      if (r.mfa_required) setStep("mfa");
      else router.replace(dest);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/v1/auth/mfa/verify", { body: { code: code.trim() }, noOrg: true });
      router.replace(dest);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={step === "password" ? "Welcome back" : "Two-step verification"}
      subtitle={step === "password" ? "Sign in to your merchant dashboard." : "Enter the 6-digit code from your authenticator app, or a recovery code."}
      footer={step === "password" ? <>New here? <Link href="/signup" className="font-medium text-text underline-offset-4 hover:underline">Create an account</Link></> : null}
    >
      {params.get("expired") && step === "password" && (
        <p className="mb-5 rounded-inner bg-lemon-soft px-4 py-3 text-[13px] text-lemon-ink" role="status">Your session ended. Sign in again to continue.</p>
      )}
      {step === "password" ? (
        <form onSubmit={submitPassword} className="space-y-4" noValidate={false}>
          <Field label="Email">
            <Input type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
          <Button type="submit" loading={busy} className="w-full">Sign in</Button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="space-y-4">
          <Field label="Verification code">
            <Input inputMode="numeric" autoComplete="one-time-code" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} className="text-center text-[20px] tracking-[0.3em]" />
          </Field>
          <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
          <Button type="submit" loading={busy} className="w-full">Verify</Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => { session.clear(); setStep("password"); setCode(""); setError(null); }}>
            Use a different account
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
