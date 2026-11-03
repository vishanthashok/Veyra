import Image from "next/image";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  /** Show only the V monogram (compact navigation, below 96 px lockup width). */
  collapsed?: boolean;
  /** "dark" for charcoal surfaces such as the sidebar, "light" for paper and white. */
  theme?: "light" | "dark";
  /** Canvas height in pixels. The SVG canvas includes the clear-space padding. */
  size?: number;
  className?: string;
  /** Set to false when an adjacent label already names the brand. */
  label?: boolean;
};

const LOCKUP_RATIO = 385 / 128;

/** Outlined SVG assets keep the mark and wordmark identical on every platform. */
export function BrandLogo({ collapsed = false, theme = "light", size = 32, className, label = true }: BrandLogoProps) {
  const width = collapsed ? size : Math.round(size * LOCKUP_RATIO);
  const src = collapsed ? `/brand/veyra-mark${theme === "dark" ? "-dark" : ""}.svg` : `/brand/veyra-logo-${theme}.svg`;
  return (
    <Image
      src={src}
      alt={label ? "Veyra" : ""}
      aria-hidden={label ? undefined : true}
      width={width}
      height={size}
      unoptimized
      priority
      draggable={false}
      className={cn("block shrink-0 select-none", className)}
      style={{ width, height: size }}
    />
  );
}
