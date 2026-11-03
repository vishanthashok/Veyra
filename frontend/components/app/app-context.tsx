"use client";
import { createContext, useContext } from "react";
import type { Me, Property } from "@/lib/api";

export type AppCtx = { me: Me | null; properties: Property[]; reloadProperties: () => void; openPalette: () => void };
export const AppContext = createContext<AppCtx>({ me: null, properties: [], reloadProperties: () => {}, openPalette: () => {} });
export const useApp = () => useContext(AppContext);
