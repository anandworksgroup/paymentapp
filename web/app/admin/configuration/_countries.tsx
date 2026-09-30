"use client";

import { useState } from "react";
import { Button, Card, Chip, Empty, ErrorNote, Field, Input, Modal, Select, Table } from "@/components/ui";
import { CardHeader } from "@/components/admin/card-header";
import { adminApi, useAdminQuery } from "@/components/admin/data";
import { humanize, Loadable, Notice, SkeletonRows } from "@/components/admin/kit";
import { useAdmin } from "@/components/admin/session";
import type { CountryCapability, ListResponse } from "@/components/admin/types";
import { flag } from "@/lib/format";
import { AuditedNote, ChangeLine, onOff, ToggleRow } from "./_shared";

type CountryPatch = {
  checkout_enabled?: boolean;
  wallet_enabled?: boolean;
  payouts_enabled?: boolean;
  merchant_onboarding_enabled?: boolean;
  payment_methods_csv?: string;
  wallet_kyc_level_required?: number;
};

const TOGGLES = [
  { key: "checkout_enabled", label: "Checkout", hint: "Customers in this country can pay merchants." },
  { key: "wallet_enabled", label: "Wallet", hint: "Residents can open and use a wallet." },
  { key: "payouts_enabled", label: "Payouts", hint: "Merchants can be paid out to local bank accounts." },
  { key: "merchant_onboarding_enabled", label: "Merchant onboarding", hint: "Businesses registered here can apply." },
] as const;

type ToggleKey = (typeof TOGGLES)[number]["key"];

const KYC_LEVELS = [
  { value: 0, label: "Level 0 · no verification" },
  { value: 1, label: "Level 1 · basic identity" },
  { value: 2, label: "Level 2 · verified identity" },
  { value: 3, label: "Level 3 · enhanced due diligence" },
];

function Toggle({ on }: { on: boolean }) {
  return on ? <Chip tone="sage">On</Chip> : <Chip tone="neutral">Off</Chip>;
}

function normalizeMethods(s: string) {
  return s
    .split(/[,\s]+/)
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean)
    .filter((m, i, a) => a.indexOf(m) === i)
    .join(",");
}

export function CountriesTab({ canManage }: { canManage: boolean }) {
  const q = useAdminQuery<ListResponse<CountryCapability>>("/config/countries");
  const [editing, setEditing] = useState<CountryCapability | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Countries" subtitle="What is available in each country. Turning a capability off stops new activity; it does not reverse anything already completed." />
      {notice && (
        <div className="mb-4">
          <Notice>{notice}</Notice>
        </div>
      )}
      <Loadable q={q} skeleton={<SkeletonRows rows={6} />}>
        {(d) => (
          <Table
            rows={d.data}
            rowKey={(r) => r.id}
            onRowClick={canManage ? (r) => setEditing(r) : undefined}
            empty={<Empty title="No countries configured" />}
            columns={[
              {
                key: "name",
                header: "Country",
                render: (r) => (
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <span aria-hidden className="text-[18px]">
                      {flag(r.country)}
                    </span>
                    <span className="text-text">{r.name}</span>
                    <span className="text-[12px] text-muted">{r.country}</span>
                  </span>
                ),
              },
              { key: "ccy", header: "Currency", render: (r) => <span className="text-text-2">{r.default_currency}</span> },
              { key: "checkout", header: "Checkout", render: (r) => <Toggle on={r.checkout_enabled} /> },
              { key: "wallet", header: "Wallet", render: (r) => <Toggle on={r.wallet_enabled} /> },
              { key: "payouts", header: "Payouts", render: (r) => <Toggle on={r.payouts_enabled} /> },
              { key: "onboarding", header: "Onboarding", render: (r) => <Toggle on={r.merchant_onboarding_enabled} /> },
              {
                key: "methods",
                header: "Payment methods",
                render: (r) => (
                  <span className="flex flex-wrap gap-1">
                    {r.payment_methods_csv
                      .split(",")
                      .filter(Boolean)
                      .map((m) => (
                        <Chip key={m} tone="neutral">
                          {humanize(m)}
                        </Chip>
                      ))}
                  </span>
                ),
              },
              { key: "kyc", header: "Wallet KYC", render: (r) => <Chip tone="lemon-soft">Level {r.wallet_kyc_level_required}</Chip> },
              { key: "restrictions", header: "Restrictions", render: (r) => (r.restrictions ? <span className="text-text-2">{r.restrictions}</span> : <span className="text-muted">None</span>) },
              ...(canManage
                ? [
                    {
                      key: "act",
                      header: "",
                      align: "right" as const,
                      render: (r: CountryCapability) => (
                        <Button
                          size="sm"
                          variant="soft"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(r);
                          }}
                        >
                          Edit
                        </Button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </Loadable>
      {editing && (
        <CountryModal
          country={editing}
          onClose={() => setEditing(null)}
          onDone={(c) => {
            setEditing(null);
            setNotice(`${c.name} updated.`);
            q.reload();
          }}
        />
      )}
    </Card>
  );
}

function CountryModal({ country, onClose, onDone }: { country: CountryCapability; onClose: () => void; onDone: (c: CountryCapability) => void }) {
  const { guard } = useAdmin();
  const [toggles, setToggles] = useState<Record<ToggleKey, boolean>>({
    checkout_enabled: country.checkout_enabled,
    wallet_enabled: country.wallet_enabled,
    payouts_enabled: country.payouts_enabled,
    merchant_onboarding_enabled: country.merchant_onboarding_enabled,
  });
  const [methods, setMethods] = useState(country.payment_methods_csv);
  const [kyc, setKyc] = useState(country.wallet_kyc_level_required);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const normalized = normalizeMethods(methods);
  const patch: CountryPatch = {};
  for (const t of TOGGLES) if (toggles[t.key] !== country[t.key]) patch[t.key] = toggles[t.key];
  if (normalized !== country.payment_methods_csv) patch.payment_methods_csv = normalized;
  if (kyc !== country.wallet_kyc_level_required) patch.wallet_kyc_level_required = kyc;
  const dirty = Object.keys(patch).length > 0;
  const methodsError = normalized && !/^[a-z0-9_]+(,[a-z0-9_]+)*$/.test(normalized) ? "Use method codes such as card, upi, sepa_debit." : null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const c = await guard(() => adminApi<CountryCapability>(`/config/countries/${encodeURIComponent(country.country)}`, { method: "PATCH", body: patch }));
      onDone(c);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          <span aria-hidden>{flag(country.country)}</span>
          {step === "edit" ? country.name : `Review changes · ${country.name}`}
        </span>
      }
      footer={
        step === "edit" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => setStep("review")} disabled={!dirty || !!methodsError}>
              Review changes
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep("edit")} disabled={busy}>
              Back
            </Button>
            <Button onClick={submit} loading={busy}>
              Save changes
            </Button>
          </>
        )
      }
    >
      {step === "edit" ? (
        <div className="space-y-3">
          {TOGGLES.map((t) => (
            <ToggleRow key={t.key} label={t.label} hint={t.hint} checked={toggles[t.key]} onChange={(v) => setToggles((x) => ({ ...x, [t.key]: v }))} />
          ))}
          <Field label="Payment methods" hint="Comma-separated method codes, e.g. card, upi" error={methodsError}>
            <Input value={methods} onChange={(e) => setMethods(e.target.value)} />
          </Field>
          <Field label="Wallet KYC level required" hint="Minimum verification before a resident can use a wallet.">
            <Select value={kyc} onChange={(e) => setKyc(Number(e.target.value))}>
              {KYC_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : (
        <div className="space-y-4">
          <ul className="space-y-1.5">
            {TOGGLES.filter((t) => patch[t.key] !== undefined).map((t) => (
              <ChangeLine key={t.key} label={t.label} before={onOff(country[t.key])} after={onOff(toggles[t.key])} />
            ))}
            {patch.payment_methods_csv !== undefined && <ChangeLine label="Payment methods" before={country.payment_methods_csv || "none"} after={patch.payment_methods_csv || "none"} />}
            {patch.wallet_kyc_level_required !== undefined && <ChangeLine label="Wallet KYC level" before={`Level ${country.wallet_kyc_level_required}`} after={`Level ${patch.wallet_kyc_level_required}`} />}
          </ul>
          <p className="text-[13.5px] leading-relaxed text-text-2">Changes apply to new activity from now on. Completed payments, transfers and payouts are not affected.</p>
          <AuditedNote mode="history" />
          <ErrorNote error={error} />
        </div>
      )}
    </Modal>
  );
}
