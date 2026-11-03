import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-[var(--dur-fast)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink shadow-xs hover:bg-accent-hover",
        secondary: "border border-line-strong bg-surface text-ink shadow-xs hover:bg-surface-2",
        ghost: "text-ink-2 hover:bg-surface-3 hover:text-ink",
        danger: "bg-error text-white shadow-xs hover:bg-[#912018]",
        link: "h-auto px-0 text-accent underline-offset-4 hover:underline",
      },
      size: { xs: "h-7 px-2 text-xs", sm: "h-8 px-3 text-sm", md: "h-9 px-3.5 text-sm", icon: "size-8" },
    },
    defaultVariants: { variant: "secondary", size: "sm" },
  },
);

type Props = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { loading?: boolean };

export function Button({ className, variant, size, loading, disabled, children, ...props }: Props) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
