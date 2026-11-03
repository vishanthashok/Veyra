import { AlertTriangle, ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string };

/** Page title block: optional breadcrumb, 28 px title, one-line context, actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
  crumbs,
  meta,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  crumbs?: Crumb[];
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-2">
            <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
              {crumbs.map((c, i) => (
                <li key={i} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="size-3 text-subtle" aria-hidden />}
                  {c.href ? (
                    <Link href={c.href} className="hover:text-ink">
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="text-ink-2">
                      {c.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-[-0.022em] text-ink">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-1 max-w-3xl text-base text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Section heading without a box: title, optional count and description, actions. */
export function SectionHeader({
  title,
  count,
  description,
  actions,
  className,
  id,
}: {
  title: React.ReactNode;
  count?: number;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 id={id} className="flex items-center gap-2 text-md font-semibold text-ink">
          {title}
          {count !== undefined && <span className="tabular text-sm font-normal text-muted">{count}</span>}
        </h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorBox({ error, className, onRetry }: { error: string | null | undefined; className?: string; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className={cn("mb-4 flex items-start gap-2.5 rounded-[var(--radius-md)] bg-error-bg px-3 py-2.5 text-sm text-error", className)}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="flex-1">{error}</span>
      {onRetry && (
        <button onClick={onRetry} className="text-sm font-medium underline-offset-2 hover:underline">
          Retry
        </button>
      )}
    </div>
  );
}

/** Compact provisional marker for page headers (replaces full-width banners). */
export function ProvisionalTag() {
  return (
    <span
      className="inline-flex h-6 items-center gap-1.5 rounded-full bg-warning-bg px-2.5 text-xs font-medium text-warning"
      title="Year-to-date figures for accountant review. Not a final reconciliation. Variances are potential discrepancies to verify."
    >
      <span className="size-1.5 rounded-full bg-[#d1892a]" aria-hidden />
      Provisional
    </span>
  );
}

/** One-line provisional note, used once per screen near the numbers it qualifies. */
export function ProvisionalBanner({ compact }: { compact?: boolean }) {
  return (
    <p className="mb-4 flex items-start gap-2 text-xs text-muted">
      <AlertTriangle className="mt-px size-3.5 shrink-0 text-[#c27a1e]" aria-hidden />
      <span>
        {compact
          ? "Provisional year-to-date figures for review, not a final reconciliation."
          : "Provisional year-to-date figures for accountant review, not a final reconciliation. Variances are potential discrepancies to verify, not confirmed billing errors."}
      </span>
    </p>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon?: React.ElementType;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      {Icon && (
        <div className="mb-3 flex size-10 items-center justify-center rounded-full border border-line bg-surface-2 text-muted">
          <Icon className="size-[18px]" aria-hidden />
        </div>
      )}
      <h3 className="text-md font-semibold text-ink">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function KeyValue({ items, className }: { items: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[minmax(120px,max-content)_1fr] gap-x-6 gap-y-2 text-sm", className)}>
      {items.map(([k, v], i) => (
        <React.Fragment key={i}>
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** Horizontal step indicator for wizards. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-label="Progress">
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li key={s} className="flex items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
            {i > 0 && <span className={cn("h-px w-6 sm:w-10", i <= current ? "bg-accent" : "bg-line-strong")} aria-hidden />}
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full text-2xs font-semibold tabular",
                state === "done" && "bg-accent text-accent-ink",
                state === "current" && "bg-ink text-white",
                state === "todo" && "border border-line-strong text-muted",
              )}
            >
              {state === "done" ? "✓" : i + 1}
            </span>
            <span className={cn("text-sm", state === "current" ? "font-medium text-ink" : "text-muted")}>{s}</span>
            {state === "done" && <span className="sr-only">(complete)</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Legacy alias kept for pages that show a single metric tile. */
export { MetricCard as Stat } from "./metrics";
