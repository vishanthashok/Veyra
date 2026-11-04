import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-2xs font-medium leading-none", {
  variants: {
    tone: {
      neutral: "bg-surface-3 text-ink-2",
      error: "bg-error-bg text-error",
      warning: "bg-warning-bg text-warning",
      success: "bg-success-bg text-success",
      info: "bg-info-bg text-info",
      accent: "bg-accent-soft text-accent",
      outline: "border border-line-strong text-ink-2",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...p }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...p} />;
}

type Tone = "neutral" | "error" | "warning" | "success" | "info" | "accent";
const STATUS: Record<string, [Tone, string]> = {
  error: ["error", "Error"],
  warning: ["warning", "Warning"],
  info: ["info", "Info"],
  unresolved: ["error", "Unresolved"],
  calculated: ["success", "Calculated"],
  needs_review: ["warning", "Needs review"],
  recoverable: ["success", "Recoverable"],
  nonrecoverable: ["neutral", "Nonrecoverable"],
  draft: ["warning", "Draft"],
  approved: ["success", "Approved"],
  open: ["warning", "Open"],
  in_review: ["info", "In review"],
  resolved: ["success", "Resolved"],
  accepted: ["neutral", "Accepted"],
  reopened: ["warning", "Reopened"],
  uploaded: ["info", "Uploaded"],
  committed: ["success", "Committed"],
  failed: ["error", "Failed"],
  not_started: ["neutral", "Not started"],
  data_collection: ["info", "Collecting data"],
  in_review_status: ["info", "In review"],
  ready: ["success", "Ready"],
  final: ["accent", "Final"],
  // workflows
  queued: ["neutral", "Queued"],
  running: ["info", "Running"],
  waiting_approval: ["warning", "Awaiting approval"],
  completed: ["success", "Completed"],
  cancelled: ["neutral", "Cancelled"],
  rejected: ["error", "Rejected"],
  skipped: ["neutral", "Skipped"],
  pending: ["neutral", "Pending"],
  active: ["success", "Active"],
  archived: ["neutral", "Archived"],
};

const DOT: Record<Tone, string> = {
  error: "bg-error",
  warning: "bg-[#d1892a]",
  success: "bg-success",
  info: "bg-info",
  accent: "bg-accent",
  neutral: "bg-subtle",
};

/** Status chip with a text label, so meaning never depends on color alone. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const [tone, label] = STATUS[status] ?? ["neutral", status.replace(/_/g, " ")];
  return (
    <Badge tone={tone} className={className}>
      <span className={cn("size-1.5 rounded-full", DOT[tone])} aria-hidden />
      {label}
    </Badge>
  );
}

/** Severity glyph for dense lists: a small shape plus an accessible label. */
export function SeverityIcon({ severity, className }: { severity: string; className?: string }) {
  const label = severity === "error" ? "Blocking error" : severity === "warning" ? "Warning" : "Info";
  return (
    <span role="img" aria-label={label} title={label} className={cn("inline-flex size-4 shrink-0 items-center justify-center", className)}>
      {severity === "error" ? (
        <svg viewBox="0 0 16 16" className="size-4 text-error" aria-hidden>
          <path fill="currentColor" d="M5.2 1.5h5.6l3.7 3.7v5.6l-3.7 3.7H5.2l-3.7-3.7V5.2z" />
          <rect x="7.25" y="4.2" width="1.5" height="5" rx=".75" fill="#fff" />
          <circle cx="8" cy="11.2" r=".9" fill="#fff" />
        </svg>
      ) : severity === "warning" ? (
        <svg viewBox="0 0 16 16" className="size-4 text-[#c27a1e]" aria-hidden>
          <path fill="currentColor" d="M8 1.6 15 14H1z" />
          <rect x="7.3" y="6" width="1.4" height="4.2" rx=".7" fill="#fff" />
          <circle cx="8" cy="12" r=".85" fill="#fff" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="size-4 text-info" aria-hidden>
          <circle cx="8" cy="8" r="6.5" fill="currentColor" />
          <rect x="7.3" y="7" width="1.4" height="4.5" rx=".7" fill="#fff" />
          <circle cx="8" cy="4.9" r=".85" fill="#fff" />
        </svg>
      )}
    </span>
  );
}
