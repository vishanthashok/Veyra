import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "error" | "warning" | "success" | undefined;

export type Metric = { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: Tone; href?: string };

const toneText = (t: Tone) =>
  t === "error" ? "text-error" : t === "warning" ? "text-warning" : t === "success" ? "text-success" : "text-ink";
const toneDot = (t: Tone) =>
  t === "error" ? "bg-error" : t === "warning" ? "bg-[#d1892a]" : t === "success" ? "bg-success" : "bg-line-strong";

function Cell({ m, className }: { m: Metric; className?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <span className={cn("size-1.5 rounded-full", toneDot(m.tone))} aria-hidden />
        {m.label}
      </div>
      <div className={cn("mt-1.5 text-xl font-semibold tabular-nums tracking-[-0.02em]", toneText(m.tone))}>{m.value}</div>
      {m.hint && <div className="mt-0.5 truncate text-xs text-muted">{m.hint}</div>}
    </>
  );
  const cls = cn("block min-w-0 px-4 py-3", className);
  return m.href ? (
    <Link href={m.href} className={cn(cls, "transition-colors duration-[var(--dur-fast)] hover:bg-surface-2")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** MetricStrip: compact metrics in one bordered row with dividers (no oversized cards). */
export function MetricStrip({ metrics, className }: { metrics: Metric[]; className?: string }) {
  // gap-px over a line-colored background draws hairline dividers at every breakpoint.
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-line bg-line shadow-xs lg:grid-cols-[repeat(var(--n),minmax(0,1fr))]",
        className,
      )}
      style={{ ["--n" as string]: metrics.length }}
    >
      {metrics.map((m) => (
        <Cell key={m.label} m={m} className="bg-surface" />
      ))}
    </div>
  );
}

/** MetricCard: a single metric tile for standalone use. */
export function MetricCard(m: Metric & { className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-xs", m.className)}>
      <Cell m={m} />
    </div>
  );
}
