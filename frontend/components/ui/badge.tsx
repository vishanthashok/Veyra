import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--radius-sm)] border px-1.5 py-px text-2xs font-medium",
  {
    variants: {
      tone: {
        neutral: "border-line bg-surface-3 text-ink-2",
        error: "border-error-line bg-error-bg text-error",
        warning: "border-warning-line bg-warning-bg text-warning",
        success: "border-success-line bg-success-bg text-success",
        info: "border-info-line bg-info-bg text-info",
        accent: "border-transparent bg-accent-soft text-accent",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({ className, tone, ...p }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...p} />;
}

type Tone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;
const STATUS: Record<string, [Tone, string]> = {
  error: ["error", "Error"], warning: ["warning", "Warning"], info: ["info", "Info"],
  unresolved: ["error", "Unresolved"], calculated: ["success", "Calculated"],
  needs_review: ["warning", "Needs review"], recoverable: ["success", "Recoverable"], nonrecoverable: ["neutral", "Nonrecoverable"],
  draft: ["warning", "Draft"], approved: ["success", "Approved"],
  open: ["warning", "Open"], in_review: ["info", "In review"], resolved: ["success", "Resolved"],
  accepted: ["neutral", "Accepted"], reopened: ["warning", "Reopened"],
  uploaded: ["info", "Uploaded"], committed: ["success", "Committed"], failed: ["error", "Failed"],
  not_started: ["neutral", "Not started"], data_collection: ["info", "Data collection"],
  in_review_status: ["info", "In review"], ready: ["success", "Ready"], final: ["accent", "Final"],
};

/** Status chip with a text label, so meaning never depends on color alone. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const [tone, label] = STATUS[status] ?? ["neutral", status.replace(/_/g, " ")];
  const dot = { error: "bg-error", warning: "bg-[#dc6803]", success: "bg-success", info: "bg-info", accent: "bg-accent", neutral: "bg-subtle" }[tone];
  return (
    <Badge tone={tone} className={className}>
      <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />
      {label}
    </Badge>
  );
}
