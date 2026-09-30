"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, session } from "@/lib/api";
import { CURRENCIES } from "@/lib/merchant/money";
import { Button, ErrorNote, Field, Input, Select } from "@/components/ui";
import { AuthLayout } from "@/components/merchant/AuthLayout";
import { useCountries } from "@/components/merchant/useMeta";

type SignupResponse = { token: string; user: { id: string }; organization: { id: string } | null };

export default function SignupPage() {
  const router = useRouter();
  const countries = useCountries().filter((c) => c.merchant_onboarding_enabled);
  const [form, setForm] = useState({ name: "", email: "", password: "", organization_name: "", country: "US", currency: "USD" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      session.clear();
      const r = await api<SignupResponse>("/v1/auth/signup", { body: form, anonymous: true });
      session.token = r.token;
      if (r.organization) session.orgId = r.organization.id;
      router.replace("/dashboard");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start in test mode. Go live once your business is verified."
      footer={<>Already have an account? <Link href="/login" className="font-medium text-text underline-offset-4 hover:underline">Sign in</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Your name"><Input autoComplete="name" required value={form.name} onChange={set("name")} /></Field>
        <Field label="Work email"><Input type="email" autoComplete="email" required value={form.email} onChange={set("email")} /></Field>
        <Field label="Password" hint="At least 10 characters.">
          <Input type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={set("password")} />
        </Field>
        <Field label="Organization name"><Input autoComplete="organization" required value={form.organization_name} onChange={set("organization_name")} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Country">
            <Select value={form.country} onChange={(e) => {
              const c = countries.find((x) => x.country === e.target.value);
              setForm((f) => ({ ...f, country: e.target.value, currency: c && CURRENCIES.includes(c.default_currency) ? c.default_currency : f.currency }));
            }}>
              {countries.length === 0 && <option value="US">United States</option>}
              {countries.map((c) => <option key={c.country} value={c.country}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Default currency">
            <Select value={form.currency} onChange={set("currency")}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        </div>
        <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
        <Button type="submit" loading={busy} className="w-full">Create account</Button>
      </form>
    </AuthLayout>
  );
}
