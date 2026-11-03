import Image from "next/image";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  collapsed?: boolean;
  theme?: "light" | "dark" | "auto";
  size?: number;
  className?: string;
};

/** Outlined SVG assets keep the wordmark identical across platforms. */
export function BrandLogo({ collapsed = false, theme = "auto", size = 32, className }: BrandLogoProps) {
  const width = collapsed ? size : size * 385 / 128;
  const asset = (mode: "light" | "dark") => collapsed
    ? `/brand/veyra-mark${mode === "dark" ? "-dark" : ""}.svg`
    : `/brand/veyra-logo-${mode}.svg`;

  return (
    <span className={cn("brand-logo", theme === "auto" && "brand-logo-auto", className)}
      style={{ width, height: size }}>
      {theme === "auto" ? <>
        <Image className="brand-image-light" src={asset("light")} alt="Veyra" width={collapsed ? 128 : 385} height={128} style={{ width, height: size }} />
        <Image className="brand-image-dark" src={asset("dark")} alt="Veyra" width={collapsed ? 128 : 385} height={128} style={{ width, height: size }} />
      </> : <Image src={asset(theme)} alt="Veyra" width={collapsed ? 128 : 385} height={128} style={{ width, height: size }} />}
    </span>
  );
}
