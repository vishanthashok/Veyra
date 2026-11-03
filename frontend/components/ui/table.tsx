import * as React from "react";
import { cn } from "@/lib/utils";

/** Static table primitives for small fixed tables (pool summaries, trace steps). */
export function Table({ className, ...p }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...p} />
    </div>
  );
}
export const THead = (p: React.ComponentProps<"thead">) => <thead className="bg-surface-2" {...p} />;
export const TBody = (p: React.ComponentProps<"tbody">) => <tbody {...p} />;
export function TR({ className, ...p }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b border-line last:border-0", className)} {...p} />;
}
export function TH({ className, ...p }: React.ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn("h-8 whitespace-nowrap px-3 text-left text-2xs font-semibold uppercase tracking-wide text-muted", className)}
      {...p}
    />
  );
}
export function TD({ className, ...p }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-2 align-top text-ink", className)} {...p} />;
}
