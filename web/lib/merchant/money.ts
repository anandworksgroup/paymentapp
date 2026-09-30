import { exponent } from "@/lib/format";

/**
 * Converts what a person typed ("12.50", "1,200") into integer minor units for the API. This is input
 * parsing, not a financial calculation: it is string-based so no floating-point rounding is involved,
 * and it rejects more decimals than the currency allows instead of rounding them away.
 */
export function toMinor(input: string, currency: string): number | null {
  const s = input.trim().replace(/[,\s_]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const exp = exponent(currency);
  const [whole, frac = ""] = s.split(".");
  if (frac.length > exp) return null;
  const minor = BigInt(whole + frac.padEnd(exp, "0"));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}

/** Minor units back into an editable string ("1250" USD → "12.50"). */
export function toMajorInput(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined) return "";
  const exp = exponent(currency);
  if (exp === 0) return String(minor);
  const neg = minor < 0;
  const s = String(Math.abs(minor)).padStart(exp + 1, "0");
  return `${neg ? "-" : ""}${s.slice(0, -exp)}.${s.slice(-exp)}`;
}

export const CURRENCIES = ["USD", "EUR", "GBP", "INR", "JPY", "AUD", "CAD", "SGD", "BRL", "AED"];
