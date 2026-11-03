"use client";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { ErrorBox } from "@/components/common";
import { StatusBadge } from "@/components/ui/badge";
import { api, type Period, type Property } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { PropertyCtx } from "./context";

const TABS = [
  ["", "Overview"], ["tenants", "Tenants"], ["import", "Data import"], ["mapping", "Expense mapping"],
  ["rules", "Lease rules"], ["audit", "Audit workspace"], ["exceptions", "Exceptions"], ["reports", "Reports"],
];

export default function PropertyLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const path = usePathname();
  const { data, error, reload } = useLoad(async () => {
    const [property, periods] = await Promise.all([
      api.get<Property>(`/properties/${id}`), api.get<Period[]>(`/properties/${id}/periods`),
    ]);
    return { property, periods };
  }, [id]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <div className="text-sm text-muted-foreground">Loading</div>;
  const base = `/properties/${id}`;
  return (
    <PropertyCtx.Provider value={{ ...data, reload }}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{data.property.name}</h1>
        <StatusBadge status={data.property.reconciliation_status} />
      </div>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b">
        {TABS.map(([slug, label]) => {
          const href = slug ? `${base}/${slug}` : base;
          const active = slug ? path.startsWith(href) : path === base;
          return (
            <Link key={slug} href={href} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm",
              active ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {label}
            </Link>
          );
        })}
      </nav>
      {children}
    </PropertyCtx.Provider>
  );
}
