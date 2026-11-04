"use client";
import { SeverityIcon } from "@/components/ui/badge";
import type { Issue } from "@/lib/workflows";

export function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return <p className="p-4 text-sm text-success">No errors or warnings.</p>;
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <table className="w-full text-xs">
      <caption className="sr-only">Errors and warnings</caption>
      <thead className="sticky top-0 bg-surface-2 text-left text-muted">
        <tr>
          <th scope="col" className="w-8 px-3 py-1.5 font-medium" />
          <th scope="col" className="px-2 py-1.5 font-medium">
            Step
          </th>
          <th scope="col" className="px-2 py-1.5 text-right font-medium">
            Row
          </th>
          <th scope="col" className="px-2 py-1.5 font-medium">
            Message
          </th>
          <th scope="col" className="px-2 py-1.5 font-medium">
            Code
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {sorted.slice(0, 500).map((i, k) => (
          <tr key={k}>
            <td className="px-3 py-1.5">
              <SeverityIcon severity={i.severity} />
            </td>
            <td className="whitespace-nowrap px-2 py-1.5 text-ink-2">{i.step}</td>
            <td className="tabular px-2 py-1.5 text-right text-muted">{i.row ?? "–"}</td>
            <td className="px-2 py-1.5 text-ink">
              {i.message}
              {i.value && <span className="ml-1 font-mono text-2xs text-muted">({i.value})</span>}
            </td>
            <td className="whitespace-nowrap px-2 py-1.5 font-mono text-2xs text-muted">{i.code}</td>
          </tr>
        ))}
      </tbody>
      {sorted.length > 500 && (
        <tfoot>
          <tr>
            <td colSpan={5} className="px-3 py-2 text-muted">
              Showing 500 of {sorted.length.toLocaleString()}. The exception sheet in the workbook has every row.
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
