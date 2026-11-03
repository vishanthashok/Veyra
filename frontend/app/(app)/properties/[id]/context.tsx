"use client";
import { createContext, useContext } from "react";
import type { Period, Property } from "@/lib/api";

export type Ctx = { property: Property; periods: Period[]; reload: () => void; base: string };
export const PropertyCtx = createContext<Ctx | null>(null);
export function useProperty() {
  const c = useContext(PropertyCtx);
  if (!c) throw new Error("useProperty outside PropertyCtx");
  return c;
}

export function crumbs(c: Ctx, page?: string) {
  return [
    { label: "Properties", href: "/properties" },
    { label: c.property.name, href: page ? c.base : undefined },
    ...(page ? [{ label: page }] : []),
  ];
}
