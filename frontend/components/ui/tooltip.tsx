"use client";
import * as T from "@radix-ui/react-tooltip";
import * as React from "react";

export const TooltipProvider = T.Provider;

export function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <T.Root delayDuration={300}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          sideOffset={6}
          className="anim-pop z-[var(--z-popover)] max-w-72 rounded-md bg-nav px-2 py-1 text-xs text-nav-ink shadow-pop"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
