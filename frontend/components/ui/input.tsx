import * as React from "react";
import { cn } from "@/lib/utils";

const field = "h-9 w-full rounded-md border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60";

export function Input({ className, ...p }: React.ComponentProps<"input">) {
  return <input className={cn(field, className)} {...p} />;
}
export function Select({ className, ...p }: React.ComponentProps<"select">) {
  return <select className={cn(field, "pr-8", className)} {...p} />;
}
export function Textarea({ className, ...p }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(field, "h-auto min-h-16 py-2", className)} {...p} />;
}
export function Label({ className, ...p }: React.ComponentProps<"label">) {
  return <label className={cn("flex flex-col gap-1 text-xs font-medium text-muted-foreground", className)} {...p} />;
}
