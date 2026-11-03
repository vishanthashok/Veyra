import * as React from "react";
import { cn } from "@/lib/utils";

const field =
  "h-8 w-full rounded-[var(--radius-md)] border border-line-strong bg-surface px-2.5 text-sm text-ink shadow-xs outline-none transition-[border,box-shadow] duration-[var(--dur-fast)] placeholder:text-subtle hover:border-[#c7c6bf] focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted aria-[invalid=true]:border-error";

export function Input({ className, ...p }: React.ComponentProps<"input">) {
  return <input className={cn(field, className)} {...p} />;
}
export function Select({ className, ...p }: React.ComponentProps<"select">) {
  return <select className={cn(field, "pr-7", className)} {...p} />;
}
export function Textarea({ className, ...p }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(field, "h-auto min-h-20 py-1.5 leading-5", className)} {...p} />;
}

/** Labelled field with hint and error wired to aria-describedby and aria-invalid. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
  required,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactElement<Record<string, unknown>>;
  className?: string;
  required?: boolean;
}) {
  const id = React.useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const child = React.cloneElement(children, {
    id,
    "aria-describedby": [hintId, errId].filter(Boolean).join(" ") || undefined,
    "aria-invalid": error ? true : undefined,
    required,
  });
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-xs font-medium text-ink-2">
        {label}
        {required && (
          <span className="text-muted" aria-hidden>
            {" "}
            *
          </span>
        )}
      </label>
      {child}
      {hint && !error && (
        <p id={hintId} className="text-2xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-2xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** Segmented control for 2 to 4 mutually exclusive options. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; count?: number }[];
  label: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("scroll-quiet inline-flex max-w-full overflow-x-auto rounded-[var(--radius-md)] bg-surface-3 p-0.5", className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] px-2.5 text-xs font-medium transition-colors duration-[var(--dur-fast)]",
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
          {o.count !== undefined && <span className={cn("tabular", value === o.value ? "text-muted" : "text-subtle")}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
