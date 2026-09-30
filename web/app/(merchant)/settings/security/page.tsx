"use client";

import { useState } from "react";
import { api, type List } from "@/lib/api";
import { useAction, useApi } from "@/lib/merchant/hooks";
import { Button, Card, CardHeader, Chip, Empty, PageHeader, type Tone } from "@/components/ui";
import { date, relative, titleCase } from "@/lib/format";
import { useToast } from "@/components/merchant/context";
import { ConfirmModal, ListSkeleton, Loaded } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { MfaSetup } from "@/components/merchant/settings/MfaSetup";
import { SettingsNav } from "@/components/merchant/settings/shared";

type SessionRow = { id: string; created_at: string; last_seen_at: string; ip?: string | null; user_agent?: string | null; current: boolean };
type Device = { id: string; created_at: string; user_agent?: string | null; platform?: string | null; last_ip?: string | null; last_country?: string | null; last_seen_at: string };
type SecurityEvent = { id: string; created_at: string; type: string; ip?: string | null; detail?: string | null; org_id?: string | null };

/** "Mozilla/5.0 … Chrome/152 …" → "Chrome on Windows" — a readable label, not a fingerprint. */
function describeAgent(ua?: string | null) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /Dart/.test(ua) ? "Mobile app" : ua.split(/[/ ]/)[0];
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : null;
  return os ? `${browser} on ${os}` : browser;
}

const EVENT_TONES: Record<string, Tone> = {
  login: "sage", mfa_enrolled: "sage", step_up: "sky", new_device: "lemon-soft", login_failed: "peach", mfa_failed: "peach",
  session_revoked: "neutral", api_key_created: "lemon-soft", api_key_deleted: "neutral", payout_account_changed: "peach", mfa_challenge: "sky",
};

export default function SecurityPage() {
  const toast = useToast();
  const sessions = useApi<List<SessionRow>>("/v1/me/sessions", { noOrg: true });
  const devices = useApi<List<Device>>("/v1/me/devices", { noOrg: true });
  const events = useApi<List<SecurityEvent>>("/v1/me/security_events", { noOrg: true });
  const [revoking, setRevoking] = useState<SessionRow | null>(null);
  const act = useAction();
  const others = sessions.data?.data.filter((s) => !s.current) ?? [];

  return (
    <>
      <PageHeader title="Security" subtitle="Your sign-in protection, active sessions and recent account activity." />
      <SettingsNav current="/settings/security" />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <MfaSetup />
          <Card>
            <CardHeader title="Active sessions" subtitle="Places you're signed in right now" action={others.length ? <Chip tone="neutral">{others.length} other{others.length === 1 ? "" : "s"}</Chip> : null} />
            <Loaded data={sessions.data} error={sessions.error} onRetry={sessions.reload} skeleton={<ListSkeleton rows={3} />}>
              {(l) => l.data.length ? (
                <ul className="space-y-2">
                  {l.data.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-inner bg-surface-2 px-4 py-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface text-text-2"><Icon name={s.current ? "check" : "lock"} size={16} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[13.5px] text-text">
                          {describeAgent(s.user_agent)}
                          {s.current && <Chip tone="sage">This device</Chip>}
                        </div>
                        <div className="truncate text-[12px] text-muted" title={s.user_agent ?? undefined}>
                          {s.ip ?? "Unknown IP"} · active {relative(s.last_seen_at)} · signed in {date(s.created_at, true)}
                        </div>
                      </div>
                      {!s.current && <Button size="sm" variant="danger" onClick={() => { act.setError(null); setRevoking(s); }}>Sign out</Button>}
                    </li>
                  ))}
                </ul>
              ) : <Empty title="No active sessions" />}
            </Loaded>
          </Card>
          <Card>
            <CardHeader title="Devices" subtitle="Browsers and apps that have signed in to your account" />
            <Loaded data={devices.data} error={devices.error} onRetry={devices.reload} skeleton={<ListSkeleton rows={3} />}>
              {(l) => l.data.length ? (
                <ul className="divide-y divide-line">
                  {l.data.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] text-text">{describeAgent(d.user_agent)} <span className="text-muted">· {titleCase(d.platform ?? "web")}</span></div>
                        <div className="truncate text-[12px] text-muted" title={d.user_agent ?? undefined}>{d.last_ip ?? "Unknown IP"}{d.last_country ? ` · ${d.last_country}` : ""} · first seen {date(d.created_at)}</div>
                      </div>
                      <span className="shrink-0 text-[12px] text-muted">{relative(d.last_seen_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : <Empty title="No devices recorded" />}
            </Loaded>
          </Card>
        </div>
        <Card className="min-w-0">
          <CardHeader title="Security activity" subtitle="The last 50 events on your account" />
          <Loaded data={events.data} error={events.error} onRetry={events.reload} skeleton={<ListSkeleton rows={6} />}>
            {(l) => l.data.length ? (
              <ol className="relative space-y-3 pl-6">
                <span aria-hidden className="absolute bottom-2 left-[7px] top-2 w-px bg-line" />
                {l.data.map((e) => (
                  <li key={e.id} className="relative">
                    <span aria-hidden className="absolute -left-6 top-1 h-3.5 w-3.5 rounded-full border-2 border-white bg-sage-300" />
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={EVENT_TONES[e.type] ?? "neutral"}>{titleCase(e.type)}</Chip>
                      {e.detail && <span className="font-mono text-[12px] text-text-2">{e.detail}</span>}
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted">{date(e.created_at, true)}{e.ip ? ` · ${e.ip}` : ""}</div>
                  </li>
                ))}
              </ol>
            ) : <Empty title="No activity yet" />}
          </Loaded>
          <p className="mt-4 text-[12.5px] text-muted">See something you don&apos;t recognise? Sign out the sessions you don&apos;t know and turn on 2-step verification.</p>
        </Card>
      </div>

      <ConfirmModal
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title="Sign out this session?"
        confirmLabel="Sign out session"
        danger
        busy={act.busy}
        error={act.error}
        onConfirm={async () => {
          if (!revoking) return;
          const id = revoking.id;
          const ok = await act.run(() => api(`/v1/me/sessions/${id}`, { method: "DELETE", noOrg: true }).then(() => true));
          if (ok) {
            toast("Session signed out");
            setRevoking(null);
            sessions.reload();
            events.reload();
          }
        }}
      >
        <p>{describeAgent(revoking?.user_agent)} at {revoking?.ip ?? "an unknown IP"} will be signed out on its next request.</p>
      </ConfirmModal>
    </>
  );
}
