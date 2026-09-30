"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, CardHeader, Chip, ErrorNote, Field, Input, Skeleton } from "@/components/ui";
import { useMerchant, useToast } from "../context";
import { CopyButton, Help } from "../common";
import { Icon } from "../icons";

type Enroll = { secret: string; otpauth_url: string };
type Confirmed = { mfa_enabled: boolean; recovery_codes: string[]; note: string };

/** TOTP enrollment: secret + QR → 6-digit confirmation → recovery codes shown once. */
export function MfaSetup() {
  const { me, refreshMe } = useMerchant();
  const toast = useToast();
  const [enroll, setEnroll] = useState<Enroll | null>(null);
  const [qr, setQr] = useState<{ url: string; data: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!enroll) return;
    let alive = true;
    QRCode.toDataURL(enroll.otpauth_url, { margin: 1, width: 208, errorCorrectionLevel: "M" }).then(
      (data) => alive && setQr({ url: enroll.otpauth_url, data }),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [enroll]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setEnroll(await api<Enroll>("/v1/auth/mfa/enroll", { method: "POST", noOrg: true }));
      setCode("");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<Confirmed>("/v1/auth/mfa/confirm", { body: { code: code.trim() }, noOrg: true });
      setCodes(r.recovery_codes);
      setEnroll(null);
      toast("2-step verification is on");
      // Refresh now so step-up prompts start asking for a code; the recovery codes stay on screen.
      refreshMe().catch(() => {});
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const finish = () => setCodes(null);

  const enabled = me.user.mfa_enabled;

  return (
    <Card className={enabled && !codes ? "sage-gradient" : undefined}>
      <CardHeader
        title="2-step verification"
        subtitle="A 6-digit code from an authenticator app, in addition to your password"
        action={<Chip tone={enabled || codes ? "sage" : "peach"}>{enabled || codes ? "On" : "Off"}</Chip>}
      />

      {codes ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-inner bg-lemon-soft px-4 py-3 text-[13px] text-lemon-ink" role="note">
            <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
            <span>Save these recovery codes somewhere safe. Each works once if you lose your phone. <strong className="font-medium">They won&apos;t be shown again.</strong></span>
          </div>
          <ul className="grid grid-cols-2 gap-2 rounded-inner bg-surface-2 p-4 font-mono text-[13.5px] text-text sm:grid-cols-4">
            {codes.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <div className="flex flex-wrap justify-end gap-2">
            <CopyButton value={codes.join("\n")} label="Copy all" className="h-11 px-4 text-[13px]" />
            <Button onClick={finish}>I&apos;ve saved them</Button>
          </div>
        </div>
      ) : enabled ? (
        <p className="text-[13.5px] text-text-2">
          Your account asks for an authenticator code when you sign in and before high-risk actions such as adding a bank account or creating live API keys.
        </p>
      ) : enroll ? (
        <form onSubmit={confirm} className="space-y-4">
          <ol className="grid grid-cols-1 gap-5 md:grid-cols-[auto_minmax(0,1fr)]">
            <li className="flex justify-center">
              <div className="rounded-inner border border-line bg-surface p-3">
                {qr && qr.url === enroll.otpauth_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- generated data URL
                  <img src={qr.data} alt="QR code to add this account to your authenticator app" width={208} height={208} />
                ) : (
                  <Skeleton className="h-[208px] w-[208px]" />
                )}
              </div>
            </li>
            <li className="min-w-0 space-y-3">
              <p className="text-[13.5px] text-text-2">1. Scan the QR code with an authenticator app (Google Authenticator, 1Password, Authy…).</p>
              <div>
                <p className="text-[12.5px] text-muted">Can&apos;t scan? Enter this key instead:</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <code className="break-all rounded-[12px] bg-surface-2 px-3 py-2 font-mono text-[13.5px] tracking-wider text-text">{enroll.secret.match(/.{1,4}/g)?.join(" ")}</code>
                  <CopyButton value={enroll.secret} label="Copy key" />
                </div>
              </div>
              <p className="text-[13.5px] text-text-2">2. Enter the 6-digit code the app shows.</p>
              <Field label="Authenticator code">
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className="max-w-40 font-mono tracking-[0.3em]"
                  autoFocus
                />
              </Field>
            </li>
          </ol>
          <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => { setEnroll(null); setError(null); }}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={code.length !== 6}>Turn on</Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <Help>Protects your account even if your password leaks. You&apos;ll need it for sign-in and for high-risk actions like payout changes.</Help>
          <div aria-live="assertive">{error ? <ErrorNote error={error} /> : null}</div>
          <Button loading={busy} icon={<Icon name="shield" size={16} />} onClick={start}>Set up 2-step verification</Button>
        </div>
      )}
    </Card>
  );
}
