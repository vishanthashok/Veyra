"use client";
import * as M from "@radix-ui/react-dropdown-menu";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({ className, align = "end", ...p }: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className={cn("anim-pop z-[var(--z-popover)] min-w-48 rounded-[10px] border border-line bg-surface p-1 shadow-pop", className)}
        {...p}
      />
    </M.Portal>
  );
}

export function MenuItem({ className, ...p }: React.ComponentProps<typeof M.Item>) {
  return (
    <M.Item
      className={cn(
        "flex h-8 cursor-default select-none items-center gap-2 rounded-[6px] px-2 text-sm text-ink outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-muted",
        className,
      )}
      {...p}
    />
  );
}

export function MenuCheckboxItem({ className, children, ...p }: React.ComponentProps<typeof M.CheckboxItem>) {
  return (
    <M.CheckboxItem
      className={cn(
        "flex h-8 cursor-default select-none items-center gap-2 rounded-[6px] px-2 text-sm outline-none data-[highlighted]:bg-surface-2",
        className,
      )}
      {...p}
    >
      <span className="flex size-3.5 items-center justify-center rounded-[3px] border border-line-strong">
        <M.ItemIndicator>
          <span className="block size-2 rounded-[1px] bg-accent" />
        </M.ItemIndicator>
      </span>
      {children}
    </M.CheckboxItem>
  );
}

export const MenuLabel = ({ className, ...p }: React.ComponentProps<typeof M.Label>) => (
  <M.Label className={cn("px-2 pb-1 pt-1.5 text-2xs font-medium text-muted", className)} {...p} />
);
export const MenuSeparator = () => <M.Separator className="-mx-1 my-1 h-px bg-line" />;
