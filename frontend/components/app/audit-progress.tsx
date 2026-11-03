import { cn } from "@/lib/utils";

/** AuditProgress: segmented readiness meter with a text value (never color alone). */
export function AuditProgress({ done, total, ready, className }: { done: number; total: number; ready?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="flex gap-[3px]" role="img" aria-label={`${done} of ${total} readiness checks pass`}>
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={cn("h-3.5 w-1.5 rounded-[2px]", i < done ? (ready ? "bg-success" : "bg-accent") : "bg-surface-3")} />
        ))}
      </div>
      <span className="tabular text-xs text-ink-2">
        {done}/{total}
      </span>
    </div>
  );
}
