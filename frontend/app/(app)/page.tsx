"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { EmptyState, ErrorBox, PageHeader, Stat } from "@/components/app/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Tooltip } from "@/components/ui/tooltip";
import { api, type DashboardRow } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { fmtDate, fmtDateTime } from "@/lib/utils";

const CHECK_LABELS: Record<string, string> = {
  gl_imported: "GL imported",
  billings_imported: "Billings imported",
  accounts_reviewed: "All GL accounts reviewed",
  tenants_have_area: "Every tenant has rentable area",
  tenants_have_approved_rules: "Every tenant has an approved lease rule",
  audit_run: "Audit run",
  no_open_errors: "No open blocking errors",
};

function Completeness({ row }: { row: DashboardRow }) {
  const missing = Object.entries(row.checks)
    .filter(([, v]) => !v)
    .map(([k]) => CHECK_LABELS[k] ?? k);
  return (
    <Tooltip content={missing.length ? <>Missing: {missing.join(", ")}</> : "All readiness checks pass"}>
      <div className="flex items-center gap-2" aria-label={`${row.completeness}% complete`}>
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3" aria-hidden>
          <div className={row.ready ? "h-full bg-success" : "h-full bg-accent"} style={{ width: `${row.completeness}%` }} />
        </div>
        <span className="tabular text-xs text-ink-2">{row.completeness}%</span>
      </div>
    </Tooltip>
  );
}

export default function Dashboard() {
  const { data, error, loading } = useLoad(() => api.get<{ properties: DashboardRow[] }>("/dashboard"), []);
  const rows = useMemo(() => data?.properties ?? [], [data]);
  const sum = (f: (r: DashboardRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const needingReview = rows.filter((r) => !r.ready).length;
  const errors = sum((r) => r.open_exceptions.error ?? 0);
  const warnings = sum((r) => r.open_exceptions.warning ?? 0);

  const columns = useMemo<ColumnDef<DashboardRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Property",
        meta: { label: "Property" },
        cell: ({ row }) => (
          <div>
            <Link href={`/properties/${row.original.id}`} className="font-medium text-ink hover:text-accent hover:underline">
              {row.original.name}
            </Link>
            <div className="text-2xs text-muted">
              <span className="capitalize">{row.original.property_type}</span> · {row.original.tenants} tenants
            </div>
          </div>
        ),
      },
      {
        id: "readiness",
        header: "Readiness",
        accessorFn: (r) => r.completeness,
        cell: ({ row }) => <Completeness row={row.original} />,
        meta: { label: "Readiness" },
      },
      {
        accessorKey: "accounts_needing_review",
        header: "Unmapped GL",
        meta: { align: "right", label: "Unmapped GL accounts" },
        cell: ({ getValue, row }) =>
          (getValue() as number) ? (
            <Link className="font-medium text-warning hover:underline" href={`/properties/${row.original.id}/mapping`}>
              {getValue() as number}
            </Link>
          ) : (
            <span className="text-muted">0</span>
          ),
      },
      {
        id: "rules",
        header: "Rules to approve",
        accessorFn: (r) => r.unapproved_rules + r.tenants_missing_rules,
        meta: { align: "right", label: "Lease rules to approve or add" },
        cell: ({ row }) => {
          const r = row.original;
          const n = r.unapproved_rules + r.tenants_missing_rules;
          return n ? (
            <Link className="font-medium text-warning hover:underline" href={`/properties/${r.id}/rules`}>
              {n}
            </Link>
          ) : (
            <span className="text-muted">0</span>
          );
        },
      },
      {
        id: "exceptions",
        header: "Open exceptions",
        accessorFn: (r) => (r.open_exceptions.error ?? 0) * 1000 + (r.open_exceptions.warning ?? 0),
        meta: {
          label: "Open exceptions",
          exportValue: (r) => `${r.open_exceptions.error ?? 0} errors, ${r.open_exceptions.warning ?? 0} warnings`,
        },
        cell: ({ row }) => {
          const e = row.original.open_exceptions;
          if (!row.original.latest_audit) return <span className="text-muted">No audit</span>;
          if (!e.error && !e.warning && !e.info) return <span className="text-muted">None</span>;
          return (
            <Link href={`/properties/${row.original.id}/exceptions`} className="flex gap-1">
              {!!e.error && (
                <Badge tone="error">
                  {e.error} error{e.error > 1 ? "s" : ""}
                </Badge>
              )}
              {!!e.warning && (
                <Badge tone="warning">
                  {e.warning} warning{e.warning > 1 ? "s" : ""}
                </Badge>
              )}
              {!!e.info && <Badge tone="info">{e.info} info</Badge>}
            </Link>
          );
        },
      },
      {
        id: "latest",
        header: "Latest audit",
        accessorFn: (r) => r.latest_audit?.created_at ?? "",
        meta: { label: "Latest audit" },
        cell: ({ row }) => {
          const a = row.original.latest_audit;
          return a ? (
            <Link href={`/properties/${row.original.id}/audit`} className="text-sm hover:underline">
              <span className="text-ink">{fmtDateTime(a.created_at)}</span>
              <div className="text-2xs text-muted">
                Through {fmtDate(a.through_date)} · {a.tenants_calculated} calculated, {a.tenants_unresolved} unresolved
              </div>
            </Link>
          ) : (
            <span className="text-muted">Not run</span>
          );
        },
      },
      {
        accessorKey: "reconciliation_status",
        header: "Status",
        meta: { label: "Status" },
        cell: ({ getValue }) => (
          <StatusBadge status={(getValue() as string) === "in_review" ? "in_review_status" : (getValue() as string)} />
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="What needs attention before year-end close. Figures shown are review counts, not dollar outcomes."
      />
      <ErrorBox error={error} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat
          label="Properties needing review"
          value={loading ? "–" : `${needingReview} of ${rows.length}`}
          tone={needingReview ? "warning" : undefined}
        />
        <Stat
          label="Unmapped GL accounts"
          value={loading ? "–" : sum((r) => r.accounts_needing_review)}
          tone={sum((r) => r.accounts_needing_review) ? "warning" : undefined}
          hint="Excluded until reviewed"
        />
        <Stat
          label="Lease rules to approve or add"
          value={loading ? "–" : sum((r) => r.unapproved_rules + r.tenants_missing_rules)}
          tone={sum((r) => r.unapproved_rules + r.tenants_missing_rules) ? "warning" : undefined}
        />
        <Stat
          label="Open blocking errors"
          value={loading ? "–" : errors}
          tone={errors ? "error" : "success"}
          hint={`${warnings} open warnings`}
        />
        <Stat
          label="Ready for year-end inputs"
          value={loading ? "–" : rows.filter((r) => r.ready).length}
          tone={rows.some((r) => r.ready) ? "success" : undefined}
          hint="Properties where every check passes"
        />
      </div>
      <Panel>
        <PanelHeader title="Property readiness" description="Hover a readiness bar to see which checks are still open." />
        {rows.length === 0 && !loading ? (
          <EmptyState
            icon={Building2}
            title="No properties yet"
            action={
              <Link href="/properties?new=1" className={buttonVariants({ variant: "primary" })}>
                Add a property
              </Link>
            }
          >
            Add a property, then import its GL, billings and lease rules.
          </EmptyState>
        ) : (
          <DataTable
            caption="Property readiness"
            data={rows}
            columns={columns}
            getRowId={(r) => r.id}
            loading={loading}
            searchPlaceholder="Search properties"
            exportName="veyra-readiness"
          />
        )}
      </Panel>
      {rows.length > 0 && (
        <Panel className="mt-6">
          <PanelHeader
            title="Readiness checks"
            description="A property is ready for year-end inputs when every check passes. Ready does not mean the figures are final."
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Readiness checks by property</caption>
              <thead className="bg-surface-2">
                <tr>
                  <th scope="col" className="h-8 px-3 text-left text-2xs font-semibold uppercase tracking-wide text-muted">
                    Check
                  </th>
                  {rows.map((r) => (
                    <th key={r.id} scope="col" className="h-8 px-3 text-left text-2xs font-semibold uppercase tracking-wide text-muted">
                      {r.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.keys(CHECK_LABELS).map((k) => (
                  <tr key={k} className="border-b border-line last:border-0">
                    <th scope="row" className="px-3 py-2 text-left font-normal text-ink-2">
                      {CHECK_LABELS[k]}
                    </th>
                    {rows.map((r) => (
                      <td key={r.id} className="px-3 py-2">
                        {r.checks[k] ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <CheckCircle2 className="size-4" aria-hidden />
                            Done
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-muted">
                            <Circle className="size-4" aria-hidden />
                            Open
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
