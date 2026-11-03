import { ArrowRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { SeverityIcon } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ActionItem = {
  id: string;
  severity: "error" | "warning" | "info";
  title: React.ReactNode;
  detail?: React.ReactNode;
  context?: React.ReactNode;
  href: string;
  cta: string;
};

/** ActionList: prioritized work, each row one click from the workflow that resolves it. */
export function ActionList({ items, className, empty }: { items: ActionItem[]; className?: string; empty?: React.ReactNode }) {
  if (!items.length) return <div className={cn("px-4 py-10 text-center text-sm text-muted", className)}>{empty}</div>;
  return (
    <ul className={cn("divide-y divide-line", className)}>
      {items.map((it) => (
        <li key={it.id}>
          <Link
            href={it.href}
            className="group flex items-center gap-3 px-4 py-3 transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:shadow-[inset_2px_0_0_var(--accent)]"
          >
            <SeverityIcon severity={it.severity} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">{it.title}</div>
              {(it.detail || it.context) && (
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
                  {it.context && <span className="shrink-0 text-ink-2">{it.context}</span>}
                  {it.context && it.detail && <span aria-hidden>·</span>}
                  {it.detail && <span className="truncate">{it.detail}</span>}
                </div>
              )}
            </div>
            <span className="hidden shrink-0 items-center gap-1 text-xs font-medium text-muted group-hover:text-accent sm:flex">
              {it.cta}
              <ArrowRight className="size-3.5 transition-transform duration-[var(--dur-fast)] group-hover:translate-x-0.5" aria-hidden />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
