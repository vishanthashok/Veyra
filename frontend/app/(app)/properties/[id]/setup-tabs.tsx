"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Local tabs for property setup: details and tenants. */
export function SetupTabs({ base, tenants }: { base: string; tenants?: number }) {
  const path = usePathname();
  const tabs = [
    { href: base, label: "Details" },
    { href: `${base}/tenants`, label: "Tenants", count: tenants },
  ];
  return (
    <nav aria-label="Property setup" className="-mt-2 mb-7 flex gap-5 border-b border-line">
      {tabs.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 pb-2.5 text-sm transition-colors duration-[var(--dur-fast)]",
              active ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="tabular text-xs text-muted">{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
