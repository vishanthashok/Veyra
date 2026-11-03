import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] font-medium transition-[background,color,box-shadow,border] duration-[var(--dur-fast)] ease-[var(--ease)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[15px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(13_122_106/0.25)] hover:bg-accent-hover",
        secondary: "border border-line-strong bg-surface text-ink shadow-xs hover:border-[#c7c6bf] hover:bg-surface-2",
        ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
        danger: "bg-error text-white hover:bg-[#962019]",
        link: "h-auto px-0 text-accent underline-offset-4 hover:underline",
        dark: "bg-ink text-white hover:bg-[#2a2d33]",
      },
      size: { xs: "h-7 px-2 text-xs", sm: "h-8 px-3 text-sm", md: "h-9 px-3.5 text-sm", icon: "size-8", "icon-sm": "size-7" },
    },
    defaultVariants: { variant: "secondary", size: "sm" },
  },
);

type Props = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { loading?: boolean };

export function Button({ className, variant, size, loading, disabled, children, ...props }: Props) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
