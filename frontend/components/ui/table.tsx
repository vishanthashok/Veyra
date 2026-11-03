import * as React from "react";
import { cn } from "@/lib/utils";

/** Static table primitives for small fixed tables. Sentence-case headers, hairline rows. */
export function Table({ className, ...p }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...p} />
    </div>
  );
}
export const THead = (p: React.ComponentProps<"thead">) => <thead {...p} />;
export const TBody = (p: React.ComponentProps<"tbody">) => <tbody {...p} />;
export function TR({ className, ...p }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b border-line last:border-0", className)} {...p} />;
}
export function TH({ className, ...p }: React.ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn("h-9 whitespace-nowrap border-b border-line px-[var(--cell-x)] text-left text-xs font-medium text-muted", className)}
      {...p}
    />
  );
}
export function TD({ className, ...p }: React.ComponentProps<"td">) {
  return <td className={cn("px-[var(--cell-x)] py-2.5 align-middle text-ink", className)} {...p} />;
}
