"use client";

import Link from "next/link";
import { useApi } from "@/lib/merchant/hooks";
import type { BeneficialOwner, MerchantApplication } from "@/lib/merchant/types";
import { Card, CardHeader, Chip, PageHeader, cx } from "@/components/ui";
import { date, titleCase } from "@/lib/format";
import { useMerchant } from "@/components/merchant/context";
import { DetailSkeleton, Loaded, NoAccess } from "@/components/merchant/common";
import { Icon } from "@/components/merchant/icons";
import { ApplicationForm } from "@/components/merchant/settings/ApplicationForm";
import { SettingsNav } from "@/components/merchant/settings/shared";

type Check = { check: string; result: string; owner?: string; industry?: string };
type AppResponse = { application: MerchantApplication & { checks?: Check[] | null }; beneficial_owners: BeneficialOwner[] };

const FIELD_LABELS: Record<string, string> = {
  legal_name: "Legal name", website: "Website", industry: "Industry", country: "Country of registration", registered_address: "Registered address",
  registration_number: "Registration number", product_description: "Product description", refund_policy_url: "Refund policy URL", terms_url: "Terms of service URL",
  privacy_url: "Privacy policy URL", beneficial_owners: "At least one beneficial owner",
};

export default function VerificationPage() {
  const { can } = useMerchant();
  const allowed = can("compliance.read");
  const res = useApi<AppResponse>(allowed ? "/v1/organization/application" : null);

  if (!allowed) return <NoAccess what="business verification" />;

  return (
    <>
      <PageHeader title="Business verification" subtitle="We verify every business before it can accept live payments. Test mode works the whole time." />
      <SettingsNav current="/settings/verification" />
      <Loaded data={res.data} error={res.error} onRetry={res.reload} skeleton={<DetailSkeleton />}>
        {(d) => {
          const a = d.application;
          const locked = ["UNDER_REVIEW", "APPROVED", "REJECTED"].includes(a.status);
          return (
            <>
              <StatusBanner app={a} />
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
                <ApplicationForm key={`${a.updated_at}-${a.status}`} app={a} owners={d.beneficial_owners} locked={locked} canWrite={can("compliance.write")} onSaved={res.reload} />
                <div className="space-y-5">
                  <Card>
                    <CardHeader title="Progress" />
                    <ol className="space-y-3">
                      {[
                        { label: "Application started", done: true },
                        { label: "Submitted", done: !!a.submitted_at, at: a.submitted_at },
                        { label: "Reviewed", done: !!a.decided_at, at: a.decided_at },
                      ].map((s, i) => (
                        <li key={i} className="flex items-center gap-3 text-[13.5px]">
                          <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full", s.done ? "bg-sage-500 text-white" : "border border-line-strong bg-surface text-faint")}>
                            {s.done && <Icon name="check" size={13} />}
                          </span>
                          <span className={s.done ? "text-text" : "text-muted"}>{s.label}</span>
                          {s.at && <span className="ml-auto text-[12px] text-muted">{date(s.at)}</span>}
                        </li>
                      ))}
                    </ol>
                  </Card>
                  {a.checks && a.checks.length > 0 && (
                    <Card>
                      <CardHeader title="Automated checks" subtitle="Run when you submitted" />
                      <ul className="space-y-1.5">
                        {a.checks.map((c, i) => (
                          <li key={i} className="flex items-center justify-between gap-2 rounded-[14px] bg-surface-2 px-3 py-2 text-[13px]">
                            <span className="min-w-0 truncate text-text-2">{titleCase(c.check)}{c.owner ? ` · ${c.owner}` : ""}</span>
                            <Chip tone={c.result === "clear" || c.result === "allowed" ? "sage" : c.result === "prohibited" ? "rose" : "lemon-soft"}>
                              {c.result === "clear" || c.result === "allowed" ? "Passed" : "Needs review"}
                            </Chip>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  )}
                  <Card>
                    <CardHeader title="Why we ask" />
                    <p className="text-[13px] leading-relaxed text-muted">
                      As merchant of record we&apos;re responsible for every sale made through the platform. Financial regulations require us to know who owns
                      and runs each business. Your details are only used for verification and compliance.
                    </p>
                  </Card>
                </div>
              </div>
            </>
          );
        }}
      </Loaded>
    </>
  );
}

function StatusBanner({ app }: { app: MerchantApplication }) {
  const s = app.status;
  const actions = (app.required_actions ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const cfg: Record<string, { tone: string; icon: string; title: string; body: React.ReactNode }> = {
    APPLICATION_STARTED: { tone: "bg-lemon-soft text-lemon-ink", icon: "file", title: "Tell us about your business", body: "Fill in the details below and submit them for review. You can save a draft at any time." },
    SUBMITTED: { tone: "bg-sky-soft text-sky-ink", icon: "clock", title: "Application submitted", body: "We've received your application and will start the review shortly." },
    UNDER_REVIEW: { tone: "bg-lemon-soft text-lemon-ink", icon: "clock", title: "Your application is being reviewed", body: "Editing is paused while we review. The decision will appear here, along with anything else we need." },
    ACTION_REQUIRED: {
      tone: "bg-peach-soft text-peach-ink", icon: "alert", title: "A few details are needed",
      body: actions.length ? (
        <>
          Please update the following, then submit again:
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">{actions.map((x) => <li key={x}>{FIELD_LABELS[x] ?? titleCase(x)}</li>)}</ul>
        </>
      ) : "Please review your details and submit again.",
    },
    APPROVED: {
      tone: "bg-sage-100 text-sage-700", icon: "check", title: "Your business is verified",
      body: <>Approved {app.decided_at ? `on ${date(app.decided_at)}` : ""}. <Link href="/settings/go-live" className="underline underline-offset-4">Continue to go live</Link>.</>,
    },
    REJECTED: {
      tone: "bg-rose-soft text-rose-ink", icon: "info", title: "We're unable to approve this application",
      body: <>{app.decision_reason ?? "The application didn't meet the platform's requirements."} If you think something is wrong, contact support and we&apos;ll take another look.</>,
    },
  };
  const c = cfg[s] ?? { tone: "bg-surface-2 text-text-2", icon: "info", title: titleCase(s), body: null };
  return (
    <div className={cx("mb-5 flex items-start gap-3 rounded-inner px-5 py-4", c.tone)} role="status">
      <Icon name={c.icon} size={19} className="mt-0.5 shrink-0" />
      <div className="min-w-0 text-[13.5px]">
        <div className="font-medium">{c.title}</div>
        {c.body && <div className="mt-0.5 opacity-90">{c.body}</div>}
      </div>
    </div>
  );
}
