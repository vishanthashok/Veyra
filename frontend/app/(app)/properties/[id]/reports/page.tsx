"use client";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";
import { EmptyState, KeyValue, PageHeader, ProvisionalTag, SectionHeader } from "@/components/app/page";
import { buttonVariants } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { cn, fmtDate, fmtDateTime } from "@/lib/utils";
import { crumbs, useProperty } from "../context";
import { RunPicker, useRuns } from "../runs";

const REPORTS: [string, string, string][] = [
  ["allocation", "Tenant allocation", "Pool lines, shares, caps, admin fees, billed, variance and every calculation step."],
  ["classification", "Expense classification", "Every GL transaction with category, pool, decision version, reviewer, file and row."],
  ["exceptions", "Exception report", "All exceptions with severity, status and reviewer notes."],
  ["missing-information", "Missing information", "Data and lease terms still needed before a final reconciliation."],
  ["readiness", "Readiness summary", "Open items and whether year-end inputs are ready."],
];

export default function Reports() {
  const ctx = useProperty();
  const [selected, setSelected] = useState<string | null>(null);
  const { data, loading } = useRuns(ctx.property.id, selected);
  const run = data?.run;
  const href = (k: string) => (run?.reproducible ? `/api/v1/audit-runs/${run.id}/reports/${k}.xlsx` : undefined);

  return (
    <>
      <PageHeader
        title="Reports"
        crumbs={crumbs(ctx, "Reports")}
        meta={<ProvisionalTag />}
        description="Excel workbooks built only from the selected run's frozen inputs and stored results. Each opens with a cover sheet."
        actions={<RunPicker runs={data?.runs ?? []} value={run?.id} onChange={setSelected} />}
      />
      {loading && !data ? (
        <Skeleton className="h-64 w-full rounded-[var(--radius-lg)]" />
      ) : !run ? (
        <Panel>
          <EmptyState icon={FileText} title="No audit runs yet">
            Run an audit to generate reports.
          </EmptyState>
        </Panel>
      ) : (
        <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <Panel className="mb-8">
              <div className="flex flex-wrap items-center gap-4 p-5">
                <span className="flex size-10 items-center justify-center rounded-[var(--radius-md)] bg-accent-soft text-accent">
                  <FileSpreadsheet className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-md font-semibold">Full audit package</h2>
                  <p className="text-sm text-muted">
                    Cover, readiness, allocation with trace, classification, exceptions and missing information in one workbook.
                  </p>
                </div>
                <a
                  href={href("package")}
                  aria-disabled={!run.reproducible}
                  className={cn(buttonVariants({ variant: "primary", size: "md" }), !run.reproducible && "pointer-events-none opacity-50")}
                >
                  <Download />
                  Download package
                </a>
              </div>
            </Panel>
            <SectionHeader title="Individual workbooks" count={REPORTS.length} />
            <Panel>
              <ul className="divide-y divide-line">
                {REPORTS.map(([kind, title, desc]) => (
                  <li key={kind} className="flex items-center gap-4 px-5 py-3.5">
                    <FileSpreadsheet className="size-4 shrink-0 text-subtle" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink">{title}</div>
                      <div className="truncate text-xs text-muted">{desc}</div>
                    </div>
                    <span className="hidden text-2xs font-medium text-subtle sm:block">XLSX</span>
                    <a
                      href={href(kind)}
                      aria-label={`Download ${title}`}
                      aria-disabled={!run.reproducible}
                      className={cn(buttonVariants({ size: "xs" }), !run.reproducible && "pointer-events-none opacity-50")}
                    >
                      <Download />
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            </Panel>
            {!run.reproducible && (
              <p className="mt-3 text-sm text-warning">This run predates input snapshots. Re-run the audit to export it.</p>
            )}
          </div>

          <aside className="min-w-0" aria-labelledby="run-details">
            <SectionHeader id="run-details" title="Run details" description="Printed on every report cover." />
            <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-4 shadow-xs">
              <KeyValue
                className="grid-cols-[110px_1fr]"
                items={[
                  [
                    "Period",
                    `${run.period_label ?? ""}, ${fmtDate(run.summary.period.fiscal_year_start)} – ${fmtDate(run.summary.period.through_date)}`,
                  ],
                  ["Run at", fmtDateTime(run.created_at)],
                  ["Engine", run.engine_version],
                  [
                    "Run ID",
                    <Tooltip key="r" content={run.id}>
                      <span className="font-mono text-xs">{run.id.slice(0, 8)}…</span>
                    </Tooltip>,
                  ],
                  [
                    "Fingerprint",
                    <Tooltip key="h" content={run.input_hash}>
                      <span className="font-mono text-xs">{run.input_hash.slice(0, 12)}…</span>
                    </Tooltip>,
                  ],
                  [
                    "Snapshot",
                    run.reproducible
                      ? `${run.snapshot_counts.transactions} transactions · ${run.snapshot_counts.lease_rules} rules · ${run.snapshot_counts.source_files} files`
                      : "Not stored",
                  ],
                  ["Tenants", `${run.summary.tenants_calculated} calculated · ${run.summary.tenants_unresolved} unresolved`],
                ]}
              />
              {run.summary.assumptions && (
                <details className="mt-4 border-t border-line pt-3 text-sm">
                  <summary className="cursor-pointer text-sm font-medium text-ink-2">Calculation assumptions</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-2">
                    {run.summary.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
