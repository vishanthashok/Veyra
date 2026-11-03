"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

/** Centered modal: focus trap, Escape, labelled by title and description. */
export function DialogContent({
  title,
  description,
  children,
  className,
  footer,
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
}) {
  return (
    <D.Portal>
      <D.Overlay className="anim-fade fixed inset-0 z-[var(--z-dialog)] bg-[#121417]/35" />
      <D.Content
        className={cn(
          "anim-pop fixed left-1/2 top-[10vh] z-[var(--z-dialog)] flex max-h-[84vh] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 flex-col rounded-[12px] border border-line bg-surface shadow-pop focus:outline-none",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 pb-1 pt-5">
          <div>
            <D.Title className="text-md font-semibold text-ink">{title}</D.Title>
            {description ? (
              <D.Description className="mt-1 text-sm text-muted">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{title}</D.Description>
            )}
          </div>
          <D.Close className="-mr-1 -mt-1 rounded-md p-1.5 text-subtle hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 pb-5 pt-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </D.Content>
    </D.Portal>
  );
}

/** DetailDrawer: right-side panel for inspectors and record details. */
export function SheetContent({
  title,
  description,
  children,
  className,
  actions,
  eyebrow,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <D.Portal>
      <D.Overlay className="anim-fade fixed inset-0 z-[var(--z-dialog)] bg-[#121417]/25" />
      <D.Content
        className={cn(
          "anim-slide fixed inset-y-2 right-2 z-[var(--z-dialog)] flex w-[calc(100vw-16px)] max-w-[680px] flex-col overflow-hidden rounded-[12px] border border-line bg-surface shadow-pop focus:outline-none",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            {eyebrow && <div className="mb-1 text-xs text-muted">{eyebrow}</div>}
            <D.Title className="truncate text-lg font-semibold tracking-[-0.01em] text-ink">{title}</D.Title>
            {description ? (
              <D.Description className="mt-0.5 text-xs text-muted">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">Details</D.Description>
            )}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <D.Close className="rounded-md p-1.5 text-subtle hover:bg-surface-2 hover:text-ink" aria-label="Close">
              <X className="size-4" />
            </D.Close>
          </div>
        </div>
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

export const DetailDrawer = Dialog;
export const DetailDrawerContent = SheetContent;
