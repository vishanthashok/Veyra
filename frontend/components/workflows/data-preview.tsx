"use client";
import type { Preview } from "@/lib/workflows";
import { cn } from "@/lib/utils";

const NUM = /^-?\d[\d,]*(\.\d+)?$/;

/** Compact spreadsheet-like table for step output. Source row numbers stay visible for audit. */
export function DataPreview({
  data,
  className,
  maxHeight = "320px",
  caption,
}: {
  data: Preview;
  className?: string;
  maxHeight?: string;
  caption: string;
}) {
  if (!data.columns.length) return <p className="p-4 text-sm text-muted">No columns.</p>;
  return (
    <div className={cn("scroll-quiet overflow-auto", className)} style={{ maxHeight }}>
      <table className="w-full border-separate border-spacing-0 text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-[1]">
          <tr>
            <th scope="col" className="w-12 border-b border-r border-line bg-surface-2 px-2 py-1.5 text-right font-medium text-subtle">
              Row
            </th>
            {data.columns.map((c) => (
              <th
                key={c}
                scope="col"
                className="whitespace-nowrap border-b border-line bg-surface-2 px-2.5 py-1.5 text-left font-medium text-ink-2"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={i} className="hover:bg-surface-2/60">
              <td className="tabular border-b border-r border-line bg-surface-2/40 px-2 py-1 text-right text-subtle">
                {data.source_rows[i] ?? "–"}
              </td>
              {r.map((v, j) => (
                <td
                  key={j}
                  className={cn(
                    "max-w-72 truncate whitespace-nowrap border-b border-line px-2.5 py-1 text-ink",
                    NUM.test(v) && "tabular text-right",
                    data.columns[j] === "error" && "text-error",
                  )}
                  title={v}
                >
                  {v === "" ? <span className="text-subtle">·</span> : v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.row_count > data.rows.length && (
        <p className="px-3 py-2 text-2xs text-muted">
          Showing {data.rows.length.toLocaleString()} of {data.row_count.toLocaleString()} rows.
        </p>
      )}
      {data.row_count === 0 && <p className="px-3 py-3 text-xs text-muted">No rows.</p>}
    </div>
  );
}
