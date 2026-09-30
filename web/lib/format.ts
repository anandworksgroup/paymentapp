/** Formatting only — amounts arrive from the API as integer minor units and are never recomputed here. */

const EXPONENTS: Record<string, number> = { JPY: 0, BHD: 3 };
const SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹", JPY: "¥", AUD: "A$", CAD: "C$", SGD: "S$", BRL: "R$" };

export function exponent(currency: string) {
  return EXPONENTS[currency?.toUpperCase()] ?? 2;
}

/** 123456, "USD" → { symbol: "$", whole: "1,234", fraction: "56", code: "USD", negative } */
export function moneyParts(minor: number, currency: string) {
  const code = (currency ?? "USD").toUpperCase();
  const exp = exponent(code);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const div = 10 ** exp;
  const whole = Math.floor(abs / div).toLocaleString("en-US");
  const fraction = exp === 0 ? "" : String(abs % div).padStart(exp, "0");
  return { symbol: SYMBOLS[code] ?? "", whole, fraction, code, negative };
}

export function money(minor: number | null | undefined, currency: string, opts: { code?: boolean } = {}) {
  if (minor === null || minor === undefined) return "—";
  const p = moneyParts(minor, currency);
  const s = `${p.negative ? "−" : ""}${p.symbol}${p.whole}${p.fraction ? "." + p.fraction : ""}`;
  return opts.code || !p.symbol ? `${s} ${p.code}` : s;
}

export function compactMoney(minor: number, currency: string) {
  const major = minor / 10 ** exponent(currency);
  const sym = SYMBOLS[currency?.toUpperCase()] ?? "";
  if (Math.abs(major) >= 1_000_000) return `${sym}${(major / 1_000_000).toFixed(1)}M`;
  if (Math.abs(major) >= 10_000) return `${sym}${(major / 1000).toFixed(1)}k`;
  return money(minor, currency);
}

export function date(iso?: string | null, withTime = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function relative(iso?: string | null) {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return date(iso);
}

export function flag(country?: string | null) {
  if (!country || country.length !== 2 || country === "ZZ") return "🏳️";
  return String.fromCodePoint(...[...country.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function titleCase(s?: string | null) {
  if (!s) return "";
  return s.replace(/[_.]/g, " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

export function pct(n?: number | null) {
  return n === null || n === undefined ? "—" : `${n.toFixed(1)}%`;
}
