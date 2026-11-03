import { AlertTriangle, ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string };

export function PageHeader({
  title,
  description,
  actions,
  crumbs,
  meta,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  crumbs?: Crumb[];
  meta?: React.ReactNode;
}) {
  return (
    <header className="mb-5">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-1.5">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
            {crumbs.map((c, i) => (
              <li key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3 text-subtle" aria-hidden />}
                {c.href ? (
                  <Link href={c.href} className="hover:text-ink hover:underline">
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-[-0.01em] text-ink">{title}</h1>
            {meta}
          </div>
          {description && <p className="mt-0.5 max-w-3xl text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function ErrorBox({ error, className }: { error: string | null | undefined; className?: string }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className={cn("mb-4 flex items-start gap-2 rounded-md border border-error-line bg-error-bg px-3 py-2 text-sm text-error", className)}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{error}</span>
    </div>
  );
}

export function ProvisionalBanner({ compact }: { compact?: boolean }) {
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-md border border-warning-line bg-warning-bg px-3 py-2 text-sm text-warning">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        <b className="font-semibold">Provisional pre-close audit.</b>{" "}
        {compact
          ? "Year-to-date figures for review, not a final reconciliation."
          : "Year-to-date figures for accountant review, not a final reconciliation. Variances are potential discrepancies to verify, not confirmed billing errors."}
      </p>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon?: React.ElementType;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {Icon && (
        <div className="mb-3 rounded-full bg-surface-3 p-2.5 text-muted">
          <Icon className="size-5" aria-hidden />
        </div>
      )}
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "error" | "warning" | "success";
  href?: string;
}) {
  const color = tone === "error" ? "text-error" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-ink";
  const body = (
    <>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums tracking-[-0.01em]", color)}>{value}</div>
      {hint && <div className="mt-0.5 text-2xs text-muted">{hint}</div>}
    </>
  );
  const cls = "block rounded-lg border border-line bg-surface px-4 py-3 shadow-xs";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-line-strong hover:bg-surface-2")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function KeyValue({ items, className }: { items: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[minmax(120px,max-content)_1fr] gap-x-4 gap-y-1.5 text-sm", className)}>
      {items.map(([k, v], i) => (
        <React.Fragment key={i}>
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="Progress">
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li key={s} className="flex items-center gap-1" aria-current={state === "current" ? "step" : undefined}>
            {i > 0 && <span className={cn("mx-1 h-px w-5", i <= current ? "bg-accent" : "bg-line-strong")} aria-hidden />}
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full text-2xs font-semibold",
                state === "done" && "bg-accent text-accent-ink",
                state === "current" && "bg-accent-soft text-accent ring-1 ring-accent",
                state === "todo" && "bg-surface-3 text-muted",
              )}
            >
              {i + 1}
            </span>
            <span className={cn("text-xs", state === "current" ? "font-semibold text-ink" : "text-muted")}>{s}</span>
            {state === "done" && <span className="sr-only">(complete)</span>}
          </li>
        );
      })}
    </ol>
  );
}
