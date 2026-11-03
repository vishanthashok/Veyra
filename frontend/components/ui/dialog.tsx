"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

/** Accessible modal: focus trap, Escape to close, labelled by title and description. */
export function DialogContent({
  title, description, children, className, footer,
}: { title: string; description?: React.ReactNode; children?: React.ReactNode; className?: string; footer?: React.ReactNode }) {
  return (
    <D.Portal>
      <D.Overlay className="anim-fade fixed inset-0 z-[var(--z-dialog)] bg-[#0f1a2c]/40" />
      <D.Content
        className={cn(
          "anim-pop fixed left-1/2 top-[12vh] z-[var(--z-dialog)] flex max-h-[80vh] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 flex-col rounded-lg border border-line bg-surface shadow-pop focus:outline-none",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <D.Title className="text-base font-semibold text-ink">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className="rounded-md p-1 text-muted hover:bg-surface-3 hover:text-ink" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">{footer}</div>}
      </D.Content>
    </D.Portal>
  );
}

/** Right-side drawer for inspectors. */
export function SheetContent({
  title, description, children, className, actions,
}: { title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return (
    <D.Portal>
      <D.Overlay className="anim-fade fixed inset-0 z-[var(--z-dialog)] bg-[#0f1a2c]/30" />
      <D.Content
        className={cn(
          "anim-slide fixed inset-y-0 right-0 z-[var(--z-dialog)] flex w-full max-w-3xl flex-col border-l border-line bg-bg shadow-pop focus:outline-none",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line bg-surface px-5 py-4">
          <div className="min-w-0">
            <D.Title className="truncate text-base font-semibold text-ink">{title}</D.Title>
            {description ? <D.Description className="mt-0.5 text-xs text-muted">{description}</D.Description> : <D.Description className="sr-only">Details</D.Description>}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <D.Close className="rounded-md p-1 text-muted hover:bg-surface-3 hover:text-ink" aria-label="Close">
              <X className="size-4" />
            </D.Close>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
