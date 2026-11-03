"use client";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";
import { EmptyState, KeyValue, PageHeader, ProvisionalBanner } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { cn, fmtDate, fmtDateTime } from "@/lib/utils";
import { crumbs, useProperty } from "../context";
import { RunPicker, useRuns } from "../runs";

const REPORTS: [string, string, string][] = [
  [
    "package",
    "Full audit package",
    "Cover, readiness, tenant allocation with trace, expense classification, exceptions and missing information in one workbook.",
  ],
  [
    "allocation",
    "Tenant allocation",
    "Pool lines, shares, caps, admin fees, billed, variance and every calculation step. Subtotal formulas.",
  ],
  [
    "classification",
    "Expense classification",
    "Every GL transaction with category, pool, decision version, reviewer, source file and row.",
  ],
  ["exceptions", "Exception report", "All exceptions with severity, status and reviewer notes."],
  ["missing-information", "Missing information", "Data and lease terms still needed before a final reconciliation."],
  ["readiness", "Readiness summary", "Open items and whether year-end inputs are ready."],
];

export default function Reports() {
  const ctx = useProperty();
  const [selected, setSelected] = useState<string | null>(null);
  const { data } = useRuns(ctx.property.id, selected);
  const run = data?.run;
  return (
    <>
      <PageHeader
        title="Reports"
        crumbs={crumbs(ctx, "Reports")}
        description="Excel workbooks built only from the selected run's frozen inputs and stored results."
        actions={<RunPicker runs={data?.runs ?? []} value={run?.id} onChange={setSelected} />}
      />
      <ProvisionalBanner compact />
      {!run ? (
        <Panel>
          <EmptyState icon={FileText} title="No audit runs yet">
            Run an audit to generate reports.
          </EmptyState>
        </Panel>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <div className="grid content-start gap-3 md:grid-cols-2">
            {REPORTS.map(([kind, title, desc], i) => (
              <div
                key={kind}
                className={cn(
                  "flex flex-col justify-between gap-3 rounded-lg border border-line bg-surface p-4 shadow-xs",
                  i === 0 && "md:col-span-2 border-accent/30 bg-accent-soft/40",
                )}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="size-4 text-accent" aria-hidden />
                    <h2 className="text-sm font-semibold">{title}</h2>
                    {i === 0 && <Badge tone="accent">Recommended</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted">{desc}</p>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xs text-muted">XLSX · cover sheet · provisional banner on every sheet</span>
                  <a
                    href={run.reproducible ? `/api/v1/audit-runs/${run.id}/reports/${kind}.xlsx` : undefined}
                    aria-disabled={!run.reproducible}
                    className={cn(
                      buttonVariants({ variant: i === 0 ? "primary" : "secondary", size: "xs" }),
                      !run.reproducible && "pointer-events-none opacity-50",
                    )}
                  >
                    <Download />
                    Download
                  </a>
                </div>
              </div>
            ))}
          </div>
          <Panel className="h-fit">
            <PanelHeader title="Run details" description="Printed on every report cover." />
            <PanelBody>
              <KeyValue
                items={[
                  ["Property", ctx.property.name],
                  [
                    "Period",
                    `${run.period_label ?? ""} ${fmtDate(run.summary.period.fiscal_year_start)} – ${fmtDate(run.summary.period.through_date)}`,
                  ],
                  [
                    "Status",
                    <Badge key="s" tone="warning">
                      Provisional
                    </Badge>,
                  ],
                  [
                    "Run ID",
                    <span key="r" className="break-all font-mono text-xs">
                      {run.id}
                    </span>,
                  ],
                  ["Run at", fmtDateTime(run.created_at)],
                  ["Engine", run.engine_version],
                  [
                    "Input fingerprint",
                    <span key="h" className="break-all font-mono text-xs">
                      {run.input_hash}
                    </span>,
                  ],
                  [
                    "Snapshot",
                    run.reproducible
                      ? `${run.snapshot_counts.transactions} transactions, ${run.snapshot_counts.lease_rules} approved rules, ${run.snapshot_counts.source_files} source files`
                      : "Legacy run without snapshot. Re-run to export.",
                  ],
                  ["Tenants", `${run.summary.tenants_calculated} calculated, ${run.summary.tenants_unresolved} unresolved`],
                ]}
              />
              {run.summary.assumptions && (
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer font-medium">Calculation assumptions</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2">
                    {run.summary.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </details>
              )}
            </PanelBody>
          </Panel>
        </div>
      )}
    </>
  );
}
