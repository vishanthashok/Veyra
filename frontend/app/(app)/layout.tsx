"use client";
import { Building2, LayoutDashboard, LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, type Property } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const me = useLoad(() => api.get<{ name: string; email: string }>("/auth/me"), []);
  const props = useLoad(() => api.get<Property[]>("/properties"), [path]);

  const item = (href: string, label: string, Icon: typeof Building2, active: boolean) => (
    <Link href={href} className={cn("flex items-center gap-2 rounded-md px-3 py-2 text-sm", active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}>
      <Icon className="size-4" />{label}
    </Link>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="border-b px-5 py-4">
          <div className="font-semibold tracking-tight">Veyra</div>
          <div className="text-xs text-muted-foreground">CAM pre-close audit</div>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {item("/", "Dashboard", LayoutDashboard, path === "/")}
          {item("/properties", "Properties", Building2, path === "/properties")}
          <div className="mt-3 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Properties</div>
          {(props.data ?? []).map((p) => (
            <Link key={p.id} href={`/properties/${p.id}`}
              className={cn("truncate rounded-md px-3 py-1.5 text-sm", path.startsWith(`/properties/${p.id}`) ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}>
              {p.name}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t p-3 text-xs text-muted-foreground">
          <div className="truncate px-3">{me.data?.name}</div>
          <div className="truncate px-3">{me.data?.email}</div>
          <button className="mt-2 flex items-center gap-2 rounded-md px-3 py-1.5 hover:bg-muted"
            onClick={async () => { await api.post("/auth/logout"); router.push("/login"); }}>
            <LogOut className="size-3.5" /> Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mb-4 flex gap-3 text-sm md:hidden">
          <Link href="/">Dashboard</Link><Link href="/properties">Properties</Link>
        </div>
        {children}
      </main>
    </div>
  );
}
