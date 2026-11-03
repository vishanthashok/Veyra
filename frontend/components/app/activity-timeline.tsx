import { CheckCircle2, FileUp, Play, Scale, ShieldCheck, Tags, XCircle } from "lucide-react";
import type { ActivityEvent } from "@/lib/api";
import { cn } from "@/lib/utils";

const ICON: Record<string, React.ElementType> = {
  audit_run: Play,
  import: FileUp,
  import_failed: XCircle,
  expense_mapping: Tags,
  lease_rule: ShieldCheck,
  exception: CheckCircle2,
  gl_transaction: Scale,
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type Grouped = ActivityEvent & { count: number };

const GROUP_TITLE: Record<string, (n: number, e: ActivityEvent) => string> = {
  lease_rule: (n, e) => `${e.decision === "approve" ? "approved" : "returned to draft"} ${n} lease rules`,
  expense_mapping: (n) => `classified ${n} GL accounts`,
  exception: (n, e) => `marked ${n} exceptions ${(e.decision ?? "").replace("_", " ")}`,
  gl_transaction: (n, e) => `${e.decision}d ${n} GL transactions`,
  import: (n) => `imported ${n} files`,
};

function cleanDetail(d: string) {
  return d.replace(/^-: /, "");
}

/** Merge consecutive events of the same kind by the same person within 15 minutes. */
export function groupEvents(events: ActivityEvent[]): Grouped[] {
  const out: (Grouped & { refs: string[] })[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    const ref = e.kind === "import" ? e.title.replace(/^imported /, "") : (e.title.split(" ").pop() ?? e.ref);
    if (
      last &&
      GROUP_TITLE[e.kind] &&
      last.kind === e.kind &&
      last.actor === e.actor &&
      last.property_id === e.property_id &&
      last.decision === e.decision &&
      Math.abs(new Date(last.at).getTime() - new Date(e.at).getTime()) < 15 * 60_000
    ) {
      last.count += 1;
      last.refs.push(ref);
      continue;
    }
    out.push({ ...e, detail: cleanDetail(e.detail), count: 1, refs: [ref] });
  }
  return out.map((g) => (g.count > 1 ? { ...g, title: GROUP_TITLE[g.kind](g.count, g), detail: [...g.refs].reverse().join(", ") } : g));
}

/** ActivityTimeline: events from stored records only (audit runs, imports, reviewer decisions). */
export function ActivityTimeline({
  events: raw,
  showProperty,
  className,
  max = 8,
}: {
  events: ActivityEvent[];
  showProperty?: boolean;
  className?: string;
  max?: number;
}) {
  const events = groupEvents(raw).slice(0, max);
  if (!events.length) return <p className={cn("px-1 py-6 text-sm text-muted", className)}>No activity yet.</p>;
  return (
    <ol className={cn("relative", className)}>
      {events.map((e, i) => {
        const Icon = ICON[e.kind] ?? CheckCircle2;
        return (
          <li key={`${e.kind}-${e.ref}-${e.at}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
            {i < events.length - 1 && <span className="absolute left-[11px] top-6 h-[calc(100%-20px)] w-px bg-line" aria-hidden />}
            <span
              className={cn(
                "relative z-[1] flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface",
                e.kind === "import_failed" ? "text-error" : "text-muted",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm leading-5 text-ink-2">
                <span className="font-medium text-ink">{e.actor ?? "Someone"}</span> {e.title}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted" title={e.detail}>
                {showProperty && e.property ? `${e.property} · ` : ""}
                {e.detail}
              </p>
              <time dateTime={e.at} className="text-2xs text-subtle" title={new Date(e.at).toLocaleString()}>
                {ago(e.at)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
