import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap", {
  variants: {
    variant: {
      default: "bg-muted text-foreground",
      error: "bg-destructive/10 text-destructive",
      warning: "bg-warning/20 text-[oklch(0.45_0.1_70)]",
      info: "bg-primary/10 text-primary",
      success: "bg-success/15 text-success",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...p }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...p} />;
}

export function StatusBadge({ status }: { status: string }) {
  const v = ({
    error: "error", unresolved: "error", nonrecoverable: "default", needs_review: "warning",
    warning: "warning", draft: "warning", open: "warning", info: "info", recoverable: "success",
    calculated: "success", approved: "success", resolved: "success", accepted: "default", committed: "success",
  } as const)[status as "error"] ?? "default";
  return <Badge variant={v}>{status.replace(/_/g, " ")}</Badge>;
}
