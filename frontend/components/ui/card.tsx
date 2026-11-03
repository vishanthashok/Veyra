import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...p }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-lg border bg-card shadow-sm", className)} {...p} />;
}
export function CardHeader({ className, ...p }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 border-b px-5 py-4", className)} {...p} />;
}
export function CardTitle({ className, ...p }: React.ComponentProps<"h3">) {
  return <h3 className={cn("text-sm font-semibold", className)} {...p} />;
}
export function CardDescription({ className, ...p }: React.ComponentProps<"p">) {
  return <p className={cn("text-xs text-muted-foreground", className)} {...p} />;
}
export function CardContent({ className, ...p }: React.ComponentProps<"div">) {
  return <div className={cn("px-5 py-4", className)} {...p} />;
}
