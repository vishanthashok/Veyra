"use client";
import { createContext, useContext } from "react";
import type { DashboardRow, Me, Property } from "@/lib/api";

export type AppCtx = {
  me: Me | null;
  properties: Property[];
  /** Property the review navigation points at: the one in the URL, else the last visited, else the first. */
  current: Property | null;
  /** Readiness counts per property from /dashboard, for navigation badges and context. */
  readiness: Record<string, DashboardRow>;
  reloadProperties: () => void;
  reloadReadiness: () => void;
  openPalette: () => void;
};
export const AppContext = createContext<AppCtx>({
  me: null,
  properties: [],
  current: null,
  readiness: {},
  reloadProperties: () => {},
  reloadReadiness: () => {},
  openPalette: () => {},
});
export const useApp = () => useContext(AppContext);
