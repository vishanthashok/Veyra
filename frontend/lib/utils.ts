import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a decimal string from the API, rounding half up to cents with BigInt (no float math). */
export function money(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const neg = v.startsWith("-");
  const [int, frac = ""] = (neg ? v.slice(1) : v).split(".");
  const f = frac + "000";
  let c = BigInt((int || "0") + f.slice(0, 2));
  if (Number(f[2]) >= 5) c += BigInt(1);
  const s = c.toString().padStart(3, "0");
  const grouped = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const isZero = c === BigInt(0);
  return `${neg && !isZero ? "(" : ""}${grouped}.${s.slice(-2)}${neg && !isZero ? ")" : ""}`;
}

/** Decimal share string ("0.035") to percent text ("3.5000%") without float math. */
export function pct(v: string | null | undefined): string {
  if (!v) return "—";
  const [i, f = ""] = v.split(".");
  const f2 = f + "000000";
  const whole = (i + f2.slice(0, 2)).replace(/^(-?)0+(?=\d)/, "$1");
  return `${whole}.${f2.slice(2, 6)}%`;
}
