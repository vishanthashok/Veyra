"use client";
import { useParams } from "next/navigation";
import { ErrorBox } from "@/components/app/page";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Period, type Property } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { PropertyCtx } from "./context";

export default function PropertyLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useLoad(async () => {
    const [property, periods] = await Promise.all([api.get<Property>(`/properties/${id}`), api.get<Period[]>(`/properties/${id}/periods`)]);
    return { property, periods };
  }, [id]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <div className="space-y-3" role="status" aria-label="Loading property"><Skeleton className="h-3 w-48" /><Skeleton className="h-6 w-72" /><Skeleton className="mt-6 h-64 w-full" /></div>;
  return <PropertyCtx.Provider value={{ ...data, reload, base: `/properties/${id}` }}>{children}</PropertyCtx.Provider>;
}
