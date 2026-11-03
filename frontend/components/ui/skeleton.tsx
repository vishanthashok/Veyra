import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} aria-hidden />;
}

/** LoadingSkeleton for tables: rows of bars that match the real row height. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-line" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex h-[var(--row-h)] items-center gap-6 px-[var(--cell-x)]">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn("h-3", c === 0 ? "w-44" : "flex-1", c === cols - 1 && "max-w-20")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export const LoadingSkeleton = TableSkeleton;
