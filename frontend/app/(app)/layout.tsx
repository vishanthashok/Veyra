"use client";
import {
  Building2,
  Check,
  ChevronsUpDown,
  Command as CmdIcon,
  LogOut,
  Menu as MenuIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { AppContext } from "@/components/app/app-context";
import { CommandPalette } from "@/components/app/command-palette";
import { GLOBAL_NAV, PROPERTY_NAV } from "@/components/app/nav";
import { Kbd } from "@/components/ui/kbd";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { api, type Me, type Property } from "@/lib/api";
import { useLoad, useStoredFlag } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const me = useLoad(() => api.get<Me>("/auth/me"), []);
  const props = useLoad(() => api.get<Property[]>("/properties"), []);
  const [collapsed, setCollapsed] = useStoredFlag("veyra.sidebar.collapsed", false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [palette, setPalette] = React.useState(false);
  const current = props.data?.find((p) => p.id === params.id);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setCollapsed(!collapsed);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed, setCollapsed]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setMobileOpen(false), [path]);

  async function signOut() {
    await api.post("/auth/logout");
    router.push("/login");
  }

  const narrow = collapsed && !mobileOpen;
  const link = (href: string, label: string, Icon: React.ElementType, active: boolean) => {
    const el = (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors duration-[var(--dur-fast)]",
          active ? "bg-nav-3 font-medium text-white shadow-[inset_2px_0_0_#5fb3d6]" : "text-nav-muted hover:bg-nav-2 hover:text-nav-ink",
          narrow && "justify-center px-0",
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        {narrow ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
      </Link>
    );
    return narrow ? (
      <Tooltip key={href} content={label}>
        {el}
      </Tooltip>
    ) : (
      <React.Fragment key={href}>{el}</React.Fragment>
    );
  };

  return (
    <AppContext.Provider
      value={{ me: me.data, properties: props.data ?? [], reloadProperties: props.reload, openPalette: () => setPalette(true) }}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop"
      >
        Skip to content
      </a>
      <div className="flex min-h-screen">
        {mobileOpen && (
          <div className="fixed inset-0 z-[var(--z-sidebar)] bg-[#0f1a2c]/40 md:hidden" onClick={() => setMobileOpen(false)} aria-hidden />
        )}
        <aside
          aria-label="Primary"
          className={cn(
            "fixed inset-y-0 left-0 z-[var(--z-sidebar)] flex shrink-0 flex-col bg-nav text-nav-ink transition-[width,transform] duration-[var(--dur-base)] ease-[var(--ease)] md:static md:self-stretch",
            narrow ? "w-[var(--sidebar-w-collapsed)]" : "w-[var(--sidebar-w)]",
            mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          )}
        >
          <div className="flex h-full flex-col md:sticky md:top-0 md:h-screen">
            <div
              className={cn("flex h-[var(--topbar-h)] items-center gap-2 border-b border-white/5 px-4", narrow && "justify-center px-0")}
            >
              <div className="flex size-7 items-center justify-center rounded-md bg-[#5fb3d6] text-sm font-bold text-nav" aria-hidden>
                V
              </div>
              {!narrow && (
                <div className="leading-tight">
                  <div className="text-sm font-semibold tracking-tight text-white">Veyra</div>
                  <div className="text-2xs text-nav-muted">CAM pre-close audit</div>
                </div>
              )}
            </div>

            <div className={cn("px-3 pt-3", narrow && "px-2")}>
              <Menu>
                <MenuTrigger asChild>
                  <button
                    aria-label="Switch property"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md border border-white/10 bg-nav-2 px-2.5 py-1.5 text-left text-sm hover:bg-nav-3",
                      narrow && "justify-center px-0",
                    )}
                  >
                    <Building2 className="size-4 shrink-0 text-nav-muted" aria-hidden />
                    {!narrow && (
                      <>
                        <span className="min-w-0 flex-1 truncate">{current?.name ?? "Select property"}</span>
                        <ChevronsUpDown className="size-3.5 text-nav-muted" aria-hidden />
                      </>
                    )}
                  </button>
                </MenuTrigger>
                <MenuContent align="start" className="w-64">
                  <MenuLabel>Properties</MenuLabel>
                  {(props.data ?? []).map((p) => (
                    <MenuItem key={p.id} onSelect={() => router.push(`/properties/${p.id}`)}>
                      <Building2 />
                      <span className="flex-1 truncate">{p.name}</span>
                      {p.id === current?.id && <Check className="!text-accent" />}
                    </MenuItem>
                  ))}
                  <MenuSeparator />
                  <MenuItem onSelect={() => router.push("/properties?new=1")}>
                    <Plus />
                    New property
                  </MenuItem>
                </MenuContent>
              </Menu>
            </div>

            <nav className={cn("flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-3", narrow && "px-2")}>
              {GLOBAL_NAV.map((n) => link(n.href, n.label, n.icon, path === n.href))}
              {current && (
                <>
                  {!narrow && (
                    <div className="mb-1 mt-4 truncate px-2.5 text-2xs font-semibold uppercase tracking-wider text-nav-muted">
                      {current.name}
                    </div>
                  )}
                  {narrow && <div className="my-2 h-px bg-white/10" />}
                  {PROPERTY_NAV.map((n) => {
                    const href = `/properties/${current.id}${n.slug ? `/${n.slug}` : ""}`;
                    const active = n.slug ? path.startsWith(href) : path === href;
                    return link(href, n.label, n.icon, active);
                  })}
                </>
              )}
            </nav>

            <div className={cn("border-t border-white/5 p-3", narrow && "px-2")}>
              <button
                onClick={() => setCollapsed(!collapsed)}
                className={cn(
                  "hidden h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-nav-muted hover:bg-nav-2 hover:text-nav-ink md:flex",
                  narrow && "justify-center px-0",
                )}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
                {!narrow && <span>Collapse</span>}
              </button>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-[20] flex h-[var(--topbar-h)] items-center gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur md:px-6">
            <button
              className="rounded-md p-1.5 text-ink-2 hover:bg-surface-3 md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <MenuIcon className="size-5" />
            </button>
            <button
              onClick={() => setPalette(true)}
              className="flex h-8 w-full max-w-sm items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 text-sm text-muted shadow-xs hover:border-[#bdb8ae]"
            >
              <CmdIcon className="size-3.5" aria-hidden />
              <span className="flex-1 text-left">Jump to…</span>
              <Kbd>⌘K</Kbd>
            </button>
            <div className="ml-auto">
              <Menu>
                <MenuTrigger asChild>
                  <button className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-3" aria-label="Account menu">
                    <span
                      className="flex size-7 items-center justify-center rounded-full bg-nav text-2xs font-semibold text-white"
                      aria-hidden
                    >
                      {(me.data?.name ?? "?")
                        .split(" ")
                        .map((s) => s[0])
                        .join("")
                        .slice(0, 2)}
                    </span>
                    <span className="hidden text-sm text-ink-2 sm:block">{me.data?.name}</span>
                  </button>
                </MenuTrigger>
                <MenuContent>
                  <MenuLabel>{me.data?.email}</MenuLabel>
                  <MenuItem onSelect={() => setPalette(true)}>
                    <CmdIcon />
                    Command palette
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem onSelect={signOut}>
                    <LogOut />
                    Sign out
                  </MenuItem>
                </MenuContent>
              </Menu>
            </div>
          </header>
          <main id="main" className="mx-auto w-full max-w-[1480px] min-w-0 flex-1 px-4 py-6 md:px-8">
            {children}
          </main>
        </div>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} properties={props.data ?? []} currentPropertyId={params.id} />
    </AppContext.Provider>
  );
}
