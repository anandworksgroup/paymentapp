"use client";

import { api, ApiError } from "@/lib/api";
import { Field, Input } from "@/components/ui";

export type CardValue = { number: string; expiry: string; cvc: string };
export const emptyCard: CardValue = { number: "", expiry: "", cvc: "" };

type Token = { id: string; type: string; card: { brand?: string; last4?: string } };

/**
 * Sandbox stand-in for the PSP's hosted card fields: the number goes straight to the tokenization
 * endpoint and only the returned token is used afterwards; the platform never stores the PAN.
 */
export async function tokenizeCard(v: CardValue): Promise<string> {
  const [mm, yy] = v.expiry.split("/").map((x) => x.trim());
  const month = Number(mm);
  const year = Number(yy);
  if (!month || !year) throw new ApiError(400, "invalid_expiry", "Enter the expiry date as MM / YY.");
  const t = await api<Token>("/v1/public/sim/tokens", {
    anonymous: true,
    body: { type: "card", number: v.number.replace(/\s/g, ""), exp_month: month, exp_year: year, cvc: v.cvc },
  });
  return t.id;
}

export async function tokenizeUpi(vpa: string): Promise<string> {
  const t = await api<Token>("/v1/public/sim/tokens", { anonymous: true, body: { type: "upi", vpa: vpa.trim() } });
  return t.id;
}

function formatNumber(raw: string) {
  return raw.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
}

function formatExpiry(raw: string, prev: string) {
  const d = raw.replace(/\D/g, "").slice(0, 4);
  if (d.length <= 2) return raw.length < prev.length ? d : d.length === 2 ? `${d} / ` : d;
  return `${d.slice(0, 2)} / ${d.slice(2)}`;
}

export function CardFields({ value, onChange, error, idPrefix = "card" }: { value: CardValue; onChange: (v: CardValue) => void; error?: string | null; idPrefix?: string }) {
  return (
    <div className="space-y-3">
      <Field label="Card number" error={error}>
        <Input
          id={`${idPrefix}-number`}
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="1234 1234 1234 1234"
          required
          value={value.number}
          onChange={(e) => onChange({ ...value, number: formatNumber(e.target.value) })}
          aria-invalid={!!error}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Expiry (MM / YY)">
          <Input
            id={`${idPrefix}-exp`}
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="MM / YY"
            required
            value={value.expiry}
            onChange={(e) => onChange({ ...value, expiry: formatExpiry(e.target.value, value.expiry) })}
          />
        </Field>
        <Field label="Security code">
          <Input
            id={`${idPrefix}-cvc`}
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder="CVC"
            required
            maxLength={4}
            value={value.cvc}
            onChange={(e) => onChange({ ...value, cvc: e.target.value.replace(/\D/g, "").slice(0, 4) })}
          />
        </Field>
      </div>
    </div>
  );
}
