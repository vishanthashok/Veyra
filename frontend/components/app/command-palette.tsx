"use client";
import * as D from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { Building2, LogOut, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { api, type Property } from "@/lib/api";
import { GLOBAL_NAV, PROPERTY_NAV } from "./nav";

export function CommandPalette({
  open,
  onOpenChange,
  properties,
  currentPropertyId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  properties: Property[];
  currentPropertyId?: string;
}) {
  const router = useRouter();
  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  const current = properties.find((p) => p.id === currentPropertyId);
  const item =
    "flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm text-ink data-[selected=true]:bg-accent-soft data-[selected=true]:text-accent [&_svg]:size-4 [&_svg]:text-muted";
  const group =
    "px-1 py-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted";
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="anim-fade fixed inset-0 z-[var(--z-dialog)] bg-[#0f1a2c]/40" />
        <D.Content className="anim-pop fixed left-1/2 top-[14vh] z-[var(--z-dialog)] w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-surface shadow-pop">
          <D.Title className="sr-only">Command palette</D.Title>
          <D.Description className="sr-only">Search pages and properties</D.Description>
          <Command label="Command palette" loop>
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search className="size-4 text-subtle" aria-hidden />
              <Command.Input
                autoFocus
                placeholder="Jump to a page or property"
                className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
              />
            </div>
            <Command.List className="max-h-[50vh] overflow-y-auto p-1">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted">No matches.</Command.Empty>
              {current && (
                <Command.Group heading={current.name} className={group}>
                  {PROPERTY_NAV.map((n) => (
                    <Command.Item
                      key={n.slug}
                      value={`${current.name} ${n.label}`}
                      onSelect={() => go(`/properties/${current.id}${n.slug ? `/${n.slug}` : ""}`)}
                      className={item}
                    >
                      <n.icon />
                      {n.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Go to" className={group}>
                {GLOBAL_NAV.map((n) => (
                  <Command.Item key={n.href} value={n.label} onSelect={() => go(n.href)} className={item}>
                    <n.icon />
                    {n.label}
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Properties" className={group}>
                {properties.map((p) => (
                  <Command.Item
                    key={p.id}
                    value={`property ${p.name} ${p.address}`}
                    onSelect={() => go(`/properties/${p.id}`)}
                    className={item}
                  >
                    <Building2 />
                    <span className="truncate">{p.name}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Account" className={group}>
                <Command.Item
                  value="sign out"
                  onSelect={async () => {
                    await api.post("/auth/logout");
                    go("/login");
                  }}
                  className={item}
                >
                  <LogOut />
                  Sign out
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
