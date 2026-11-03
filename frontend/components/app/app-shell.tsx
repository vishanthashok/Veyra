"use client";
import { BrandLogo } from "@/components/brand-logo";
import {
  Building2,
  Check,
  ChevronsUpDown,
  CalendarRange,
  Command as CmdIcon,
  LogOut,
  Menu as MenuIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { Kbd } from "@/components/ui/kbd";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { api, type DashboardRow, type Me, type Property } from "@/lib/api";
import { useLoad, useStoredFlag } from "@/lib/hooks";
import { cn, fmtDate } from "@/lib/utils";
import { AppContext } from "./app-context";
import { CommandPalette } from "./command-palette";
import { type NavItem, OUTPUT, REVIEW, WORKSPACE } from "./nav";

const LAST_PROPERTY = "veyra.property";

function initials(name?: string | null) {
  return (name ?? "?")
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const me = useLoad(() => api.get<Me>("/auth/me"), []);
  const props = useLoad(() => api.get<Property[]>("/properties"), []);
  const dash = useLoad(() => api.get<{ properties: DashboardRow[] }>("/dashboard"), [path]);
  const [collapsed, setCollapsed] = useStoredFlag("veyra.sidebar.collapsed", false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [palette, setPalette] = React.useState(false);
  const [lastId, setLastId] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      if (params.id) window.localStorage.setItem(LAST_PROPERTY, params.id);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastId(params.id ?? window.localStorage.getItem(LAST_PROPERTY));
    } catch {
      setLastId(params.id ?? null);
    }
  }, [params.id]);

  const list = React.useMemo(() => props.data ?? [], [props.data]);
  const current = list.find((p) => p.id === params.id) ?? list.find((p) => p.id === lastId) ?? list[0] ?? null;
  const inProperty = !!params.id;
  const readiness = React.useMemo(() => Object.fromEntries((dash.data?.properties ?? []).map((r) => [r.id, r])), [dash.data]);
  const currentRow = current ? readiness[current.id] : undefined;

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
  const hrefFor = (n: NavItem) => (n.href ? n.href : current ? `/properties/${current.id}${n.slug ? `/${n.slug}` : ""}` : "/properties");
  const isActive = (n: NavItem) => {
    if (n.href) return n.href === "/" ? path === "/" : path === n.href;
    if (!inProperty || !current) return false;
    const href = hrefFor(n);
    return n.slug ? path.startsWith(href) : path === href || path === `${href}/tenants`;
  };

  const item = (n: NavItem) => {
    const active = isActive(n);
    const c = n.count?.(currentRow);
    const el = (
      <Link
        key={n.key}
        href={hrefFor(n)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-[13px] outline-none transition-colors duration-[var(--dur-fast)]",
          "focus-visible:ring-2 focus-visible:ring-[#5fb3a6]/60",
          active ? "bg-nav-3 text-white" : "text-nav-muted hover:bg-nav-2 hover:text-nav-ink",
          narrow && "justify-center px-0",
        )}
      >
        <n.icon className={cn("size-4 shrink-0", active ? "text-white" : "text-nav-muted group-hover:text-nav-ink")} aria-hidden />
        {narrow ? <span className="sr-only">{n.label}</span> : <span className="flex-1 truncate">{n.label}</span>}
        {c && !narrow && (
          <span
            className={cn(
              "tabular rounded-full px-1.5 text-2xs font-medium leading-[18px]",
              c.tone === "error" ? "bg-[#4a1f1c] text-[#f3b3ad]" : "bg-[#3d3220] text-[#e9c48a]",
            )}
          >
            {c.n}
          </span>
        )}
        {c && narrow && (
          <span
            className={cn("absolute right-2.5 top-1.5 size-1.5 rounded-full", c.tone === "error" ? "bg-[#e4776d]" : "bg-[#d9a54e]")}
            aria-hidden
          />
        )}
      </Link>
    );
    return narrow ? (
      <Tooltip key={n.key} content={n.label} side="right">
        {el}
      </Tooltip>
    ) : (
      el
    );
  };

  const group = (label: string, items: NavItem[]) => (
    <div className="flex flex-col gap-px">
      {narrow ? (
        <div className="mx-2 my-2 h-px bg-nav-line" aria-hidden />
      ) : (
        <div className="mb-1 mt-5 px-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-[#6b7280]">{label}</div>
      )}
      {items.map(item)}
    </div>
  );

  return (
    <AppContext.Provider
      value={{
        me: me.data,
        properties: list,
        current,
        readiness,
        reloadProperties: props.reload,
        reloadReadiness: dash.reload,
        openPalette: () => setPalette(true),
      }}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop"
      >
        Skip to content
      </a>
      <div className="flex min-h-screen">
        {mobileOpen && (
          <div
            className="anim-fade fixed inset-0 z-[var(--z-sidebar)] bg-[#121417]/40 md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
        )}
        <aside
          aria-label="Primary"
          className={cn(
            "fixed inset-y-0 left-0 z-[var(--z-sidebar)] shrink-0 bg-nav text-nav-ink transition-[width,transform] duration-[var(--dur-base)] ease-[var(--ease)] md:static md:self-stretch",
            narrow ? "w-[var(--sidebar-w-collapsed)]" : "w-[var(--sidebar-w)]",
            mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          )}
        >
          <div className="flex h-full flex-col md:sticky md:top-0 md:h-screen">
            <div className={cn("flex h-[var(--topbar-h)] shrink-0 items-center gap-2.5 px-4", narrow && "justify-center px-0")}>
              <Link
                href="/"
                className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[#5fb3a6]/60"
                aria-label="Veyra home"
              >
                <BrandLogo theme="dark" collapsed={narrow} size={32} label={false} />
              </Link>
              {mobileOpen && (
                <button
                  className="ml-auto rounded-md p-1 text-nav-muted hover:text-white md:hidden"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close navigation"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            <nav className={cn("scroll-quiet flex flex-1 flex-col overflow-y-auto px-3 pb-3", narrow && "px-2")} aria-label="Main">
              {group("Workspace", WORKSPACE)}
              {current && group("Review", REVIEW)}
              {current && group("Output", OUTPUT)}
            </nav>

            <div className={cn("border-t border-nav-line p-3", narrow && "px-2")}>
              {!narrow && current && (
                <div className="mb-2 rounded-[7px] px-2.5 py-1.5 text-xs text-nav-muted">
                  Reviewing <span className="text-nav-ink">{current.name}</span>
                </div>
              )}
              <button
                onClick={() => setCollapsed(!collapsed)}
                className={cn(
                  "hidden h-8 w-full items-center gap-2.5 rounded-[7px] px-2.5 text-[13px] text-nav-muted hover:bg-nav-2 hover:text-nav-ink md:flex",
                  narrow && "justify-center px-0",
                )}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
                {!narrow && (
                  <>
                    <span className="flex-1 text-left">Collapse</span>
                    <Kbd className="border-nav-line bg-nav-2 text-nav-muted">⌘\</Kbd>
                  </>
                )}
              </button>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-[var(--z-topbar)] flex h-[var(--topbar-h)] items-center gap-2 border-b border-line bg-bg/85 px-3 backdrop-blur-md md:px-6">
            <button
              className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <MenuIcon className="size-5" />
            </button>
            <PropertySwitcher
              properties={list}
              current={inProperty ? current : null}
              onPick={(id) => router.push(id ? `/properties/${id}` : "/")}
            />
            {inProperty && current && currentRow?.period && (
              <Link
                href={`/properties/${current.id}`}
                className="hidden h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-xs text-muted hover:bg-surface-2 hover:text-ink lg:flex"
                title="Reporting period"
              >
                <CalendarRange className="size-3.5" aria-hidden />
                <span className="text-ink-2">{currentRow.period.label}</span>
                <span className="text-subtle">through {fmtDate(currentRow.period.through_date)}</span>
              </Link>
            )}
            <button
              onClick={() => setPalette(true)}
              className="ml-auto flex h-8 w-9 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-line bg-surface text-sm text-muted shadow-xs hover:border-line-strong sm:w-64 sm:justify-start sm:px-2.5"
              aria-label="Search or jump to"
            >
              <Search className="size-3.5" aria-hidden />
              <span className="hidden flex-1 text-left sm:block">Search or jump to…</span>
              <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
            </button>
            <Menu>
              <MenuTrigger asChild>
                <button
                  className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]"
                  aria-label="Account menu"
                >
                  <span
                    className="flex size-8 items-center justify-center rounded-full bg-ink text-2xs font-semibold text-white"
                    aria-hidden
                  >
                    {initials(me.data?.name)}
                  </span>
                </button>
              </MenuTrigger>
              <MenuContent className="w-60">
                <div className="px-2 py-1.5">
                  <div className="text-sm font-medium text-ink">{me.data?.name}</div>
                  <div className="truncate text-xs text-muted">{me.data?.email}</div>
                </div>
                <MenuSeparator />
                <MenuItem onSelect={() => setPalette(true)}>
                  <CmdIcon />
                  Command palette
                  <Kbd className="ml-auto">⌘K</Kbd>
                </MenuItem>
                <MenuSeparator />
                <MenuItem onSelect={signOut}>
                  <LogOut />
                  Sign out
                </MenuItem>
              </MenuContent>
            </Menu>
          </header>
          <main id="main" className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-4 pb-16 pt-7 md:px-8">
            {children}
          </main>
        </div>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} properties={list} currentPropertyId={current?.id} />
    </AppContext.Provider>
  );
}

/** PropertySwitcher: portfolio or one property as the working context. */
export function PropertySwitcher({
  properties,
  current,
  onPick,
}: {
  properties: Property[];
  current: Property | null;
  onPick: (id: string | null) => void;
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          className="flex h-8 min-w-0 max-w-[260px] items-center gap-2 rounded-[var(--radius-md)] px-2 text-sm font-medium text-ink outline-none hover:bg-surface-2 focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]"
          aria-label="Switch property"
        >
          <span
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-[5px] text-2xs font-semibold",
              current ? "bg-accent-soft text-accent" : "bg-surface-3 text-ink-2",
            )}
            aria-hidden
          >
            {current ? current.name[0] : <Building2 className="size-3" />}
          </span>
          <span className="truncate">{current ? current.name : "All properties"}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-subtle" aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-72">
        <MenuItem onSelect={() => onPick(null)}>
          <Building2 />
          <span className="flex-1">All properties</span>
          {!current && <Check className="!text-accent" />}
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Properties</MenuLabel>
        {properties.map((p) => (
          <MenuItem key={p.id} onSelect={() => onPick(p.id)}>
            <span
              className="flex size-4 items-center justify-center rounded-[4px] bg-surface-3 text-[10px] font-semibold text-ink-2"
              aria-hidden
            >
              {p.name[0]}
            </span>
            <span className="flex-1 truncate">{p.name}</span>
            {p.id === current?.id && <Check className="!text-accent" />}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem asChild>
          <Link href="/properties?new=1">
            <Plus />
            New property
          </Link>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
