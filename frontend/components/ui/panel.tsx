import * as React from "react";
import { cn } from "@/lib/utils";

/** A single bordered surface. Use sparingly: tables, forms and drawers, not every section. */
export function Panel({ className, ...p }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn("min-w-0 overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-xs", className)}
      {...p}
    />
  );
}

export function PanelHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PanelBody({ className, ...p }: React.ComponentProps<"div">) {
  return <div className={cn("p-4", className)} {...p} />;
}
