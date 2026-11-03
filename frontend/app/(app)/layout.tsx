"use client";
import { Building2, LayoutDashboard, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, type Property } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const path = usePathname();
  const router = useRouter();
  const me = useLoad(() => api.get<{ name: string; email: string }>("/auth/me"), []);
  const props = useLoad(() => api.get<Property[]>("/properties"), [path]);

  const item = (href: string, label: string, Icon: typeof Building2, active: boolean) => (
    <Link href={href} title={collapsed ? label : undefined} aria-label={label} aria-current={active ? "page" : undefined}
      className={cn("flex items-center gap-2 rounded-md px-3 py-2 text-sm", collapsed && "justify-center", active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}>
      <Icon className="size-4 shrink-0" />{!collapsed && label}
    </Link>
  );

  return (
    <div className="flex min-h-screen">
      <aside className={cn("veyra-sidebar hidden shrink-0 flex-col border-r md:flex", collapsed ? "w-20" : "w-60")}>
        <div className={cn("border-b py-4", collapsed ? "px-3" : "px-5")}>
          <Link href="/" aria-label="Veyra dashboard" className="flex justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4">
            <BrandLogo collapsed={collapsed} theme="dark" size={collapsed ? 40 : 48} />
          </Link>
          {!collapsed && <div className="mt-1 text-xs text-muted-foreground">CAM pre-close audit</div>}
          <button type="button" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-controls="sidebar-navigation"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="mt-3 flex min-h-8 w-full items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2">
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        </div>
        <nav id="sidebar-navigation" aria-label="Main navigation" className="flex flex-col gap-1 p-3">
          {item("/", "Dashboard", LayoutDashboard, path === "/")}
          {item("/properties", "Properties", Building2, path === "/properties")}
          {!collapsed && <div className="mt-3 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Properties</div>}
          {(props.data ?? []).map((p) => (
            <Link key={p.id} href={`/properties/${p.id}`} title={collapsed ? p.name : undefined} aria-label={p.name}
              className={cn("truncate rounded-md px-3 py-1.5 text-sm", path.startsWith(`/properties/${p.id}`) ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}>
              {collapsed ? <Building2 className="mx-auto size-4" /> : p.name}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t p-3 text-xs text-muted-foreground">
          {!collapsed && <><div className="truncate px-3">{me.data?.name}</div>
          <div className="truncate px-3">{me.data?.email}</div></>}
          <button aria-label="Sign out" title={collapsed ? "Sign out" : undefined} className="mt-2 flex items-center gap-2 rounded-md px-3 py-1.5 hover:bg-muted"
            onClick={async () => { await api.post("/auth/logout"); router.push("/login"); }}>
            <LogOut className="size-3.5" />{!collapsed && "Sign out"}
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mb-4 flex gap-3 text-sm md:hidden">
          <Link href="/" aria-label="Veyra dashboard"><BrandLogo collapsed size={24} /></Link>
          <Link href="/">Dashboard</Link><Link href="/properties">Properties</Link>
        </div>
        {children}
      </main>
    </div>
  );
}

