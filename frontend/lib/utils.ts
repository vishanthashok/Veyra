import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a decimal string from the API to cents with grouping, rounding half up with BigInt.
 * Never converts money to a float. Negative values use parentheses (accounting style).
 */
export function money(v: string | null | undefined, opts: { blank?: string } = {}): string {
  if (v === null || v === undefined || v === "") return opts.blank ?? "—";
  const neg = v.trim().startsWith("-");
  const [int, frac = ""] = (neg ? v.trim().slice(1) : v.trim()).split(".");
  const f = frac + "000";
  let c = BigInt((int || "0") + f.slice(0, 2));
  if (Number(f[2]) >= 5) c += BigInt(1);
  const s = c.toString().padStart(3, "0");
  const grouped = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const isZero = c === BigInt(0);
  return `${neg && !isZero ? "(" : ""}${grouped}.${s.slice(-2)}${neg && !isZero ? ")" : ""}`;
}

/** Decimal share string ("0.035") to percent text ("3.5000%") without float math. */
export function pct(v: string | null | undefined, places = 4): string {
  if (!v) return "—";
  const neg = v.startsWith("-");
  const [i, f = ""] = (neg ? v.slice(1) : v).split(".");
  const f2 = f + "0".repeat(places + 2);
  const whole = (i + f2.slice(0, 2)).replace(/^0+(?=\d)/, "");
  return `${neg ? "-" : ""}${whole}${places ? "." + f2.slice(2, 2 + places) : ""}%`;
}

/** Sign of a decimal string: -1, 0 or 1. */
export function sign(v: string | null | undefined): -1 | 0 | 1 {
  if (!v) return 0;
  if (/^-?0*(\.0*)?$/.test(v.trim())) return 0;
  return v.trim().startsWith("-") ? -1 : 1;
}

/** Compare two decimal strings without floats (for table sorting). */
export function compareDecimal(a: string | null | undefined, b: string | null | undefined): number {
  if (a == null || a === "") return b == null || b === "" ? 0 : -1;
  if (b == null || b === "") return 1;
  const scale = (x: string) => {
    const neg = x.startsWith("-");
    const [i, f = ""] = (neg ? x.slice(1) : x).split(".");
    const n = BigInt((i || "0") + (f + "0".repeat(10)).slice(0, 10));
    return neg ? -n : n;
  };
  const d = scale(a) - scale(b);
  return d === BigInt(0) ? 0 : d > BigInt(0) ? 1 : -1;
}

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const DATETIME = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
});

/** "2026-03-05" -> "Mar 5, 2026". ISO dates are calendar dates, so format in UTC. */
export function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? v : DATE.format(d);
}

/** Timestamps are shown in the viewer's local time. */
export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : DATETIME.format(d);
}

export function idemKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function toCents(v: string): bigint {
  const neg = v.trim().startsWith("-");
  const [i, f = ""] = (neg ? v.trim().slice(1) : v.trim()).split(".");
  const c = BigInt((i || "0") + (f + "00").slice(0, 2));
  return neg ? -c : c;
}

/** a - b for 2-decimal money strings, exact. */
export function subMoney(a: string, b: string): string {
  const d = toCents(a) - toCents(b);
  const neg = d < BigInt(0);
  const s = (neg ? -d : d).toString().padStart(3, "0");
  return `${neg ? "-" : ""}${s.slice(0, -2)}.${s.slice(-2)}`;
}
