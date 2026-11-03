import * as React from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...p }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...p} />
    </div>
  );
}
export const THead = (p: React.ComponentProps<"thead">) => <thead className="bg-muted/60" {...p} />;
export const TBody = (p: React.ComponentProps<"tbody">) => <tbody {...p} />;
export function TR({ className, ...p }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b last:border-0 hover:bg-muted/40", className)} {...p} />;
}
export function TH({ className, ...p }: React.ComponentProps<"th">) {
  return <th className={cn("px-3 py-2 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap", className)} {...p} />;
}
export function TD({ className, ...p }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-2 align-top", className)} {...p} />;
}
