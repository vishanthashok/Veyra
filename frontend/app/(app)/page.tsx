"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRight, Building2, CheckCircle2, Circle, Play, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { type ActionItem, ActionList } from "@/components/app/action-list";
import { ActivityTimeline } from "@/components/app/activity-timeline";
import { useApp } from "@/components/app/app-context";
import { AuditProgress } from "@/components/app/audit-progress";
import { MetricStrip } from "@/components/app/metrics";
import { EmptyState, ErrorBox, PageHeader, SectionHeader } from "@/components/app/page";
import { SeverityIcon, StatusBadge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, SheetContent } from "@/components/ui/dialog";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { type ActivityEvent, type AuditRun, type DashboardRow, api, errorText } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { cn, fmtDate, fmtDateTime, idemKey } from "@/lib/utils";

export const CHECKS: { key: string; label: string; slug: string; cta: string }[] = [
  { key: "gl_imported", label: "General ledger imported", slug: "import", cta: "Import GL" },
  { key: "billings_imported", label: "Tenant billings imported", slug: "import", cta: "Import billings" },
  { key: "accounts_reviewed", label: "Every GL account classified", slug: "mapping", cta: "Map accounts" },
  { key: "tenants_have_area", label: "Every tenant has rentable area", slug: "tenants", cta: "Fix tenants" },
  { key: "tenants_have_approved_rules", label: "Every tenant has an approved lease rule", slug: "rules", cta: "Approve rules" },
  { key: "audit_run", label: "Audit run on current data", slug: "audit", cta: "Run audit" },
  { key: "no_open_errors", label: "No open blocking errors", slug: "exceptions", cta: "Review exceptions" },
];

export function nextStep(r: DashboardRow) {
  return CHECKS.find((c) => !r.checks[c.key]) ?? null;
}

const TYPE_TEXT: Record<string, [string, string, string]> = {
  // type: [title template, workflow slug, cta]
  MISSING_LEASE_RULE: ["{n} tenant{s} without an approved lease rule", "exceptions", "Review"],
  MISSING_TENANT_AREA: ["{n} tenant{s} missing rentable area", "exceptions", "Review"],
  UNSUPPORTED_RULE: ["{n} lease term{s} the engine cannot compute", "exceptions", "Review"],
  MISSING_RULE_TERM: ["{n} lease rule{s} with a missing term", "exceptions", "Review"],
  MISSING_DENOMINATOR: ["{n} pro-rata pool{s} without a denominator", "exceptions", "Review"],
  UNKNOWN_CATEGORY: ["{n} mapping{s} to an unknown category", "mapping", "Fix mapping"],
  SHARES_EXCEED_100: ["{n} tenant share{s} above 100%", "exceptions", "Review"],
  DUPLICATE_GL_CANDIDATE: ["{n} possible duplicate invoice{s}", "exceptions", "Check"],
  MAPPING_NEEDS_REVIEW: ["{n} GL account{s} excluded pending review", "mapping", "Classify"],
  UNMAPPED_GL_ACCOUNT: ["{n} unmapped GL account{s}", "mapping", "Classify"],
  TRANSACTION_OUTSIDE_PERIOD: ["{n} transaction{s} outside the audit window", "exceptions", "Check"],
  MISSING_BILLINGS: ["{n} tenant{s} with no billings in the window", "exceptions", "Review"],
  VARIANCE_OVER_THRESHOLD: ["{n} provisional variance{s} above threshold", "exceptions", "Verify"],
  ROUNDING_DIFFERENCE: ["{n} pool rounding difference{s}", "exceptions", "View"],
};

function buildActions(rows: DashboardRow[]): ActionItem[] {
  const items: (ActionItem & { rank: number })[] = [];
  const sev = { error: 0, warning: 1, info: 2 };
  for (const r of rows) {
    const base = `/properties/${r.id}`;
    for (const t of r.open_exception_types) {
      if (t.type === "MAPPING_NEEDS_REVIEW" || t.type === "UNMAPPED_GL_ACCOUNT") continue; // covered by the mapping item
      if (t.severity === "info" && t.type === "ROUNDING_DIFFERENCE") continue;
      const [tpl, slug, cta] = TYPE_TEXT[t.type] ?? [`{n} ${t.type.toLowerCase().replace(/_/g, " ")}`, "exceptions", "Review"];
      items.push({
        id: `${r.id}-${t.type}`,
        severity: t.severity,
        title: tpl.replace("{n}", String(t.count)).replace("{s}", t.count === 1 ? "" : "s"),
        context: r.name,
        detail: t.severity === "error" ? "Blocks a tenant result" : t.severity === "warning" ? "Needs review" : "For awareness",
        href: `${base}/${slug}`,
        cta,
        rank: sev[t.severity] * 10,
      });
    }
    if (r.accounts_needing_review)
      items.push({
        id: `${r.id}-mapping`,
        severity: "warning",
        title: `${r.accounts_needing_review} GL account${r.accounts_needing_review === 1 ? "" : "s"} need${r.accounts_needing_review === 1 ? "s" : ""} classification`,
        context: r.name,
        detail: "Excluded from every pool until reviewed",
        href: `${base}/mapping`,
        cta: "Classify",
        rank: 11,
      });
    if (r.unapproved_rules)
      items.push({
        id: `${r.id}-rules`,
        severity: "warning",
        title: `${r.unapproved_rules} lease rule${r.unapproved_rules === 1 ? "" : "s"} awaiting approval`,
        context: r.name,
        detail: "Draft rules are not used in audits",
        href: `${base}/rules`,
        cta: "Approve",
        rank: 12,
      });
    if (!r.checks.gl_imported || !r.checks.billings_imported)
      items.push({
        id: `${r.id}-import`,
        severity: "warning",
        title: !r.checks.gl_imported ? "General ledger not imported" : "Tenant billings not imported",
        context: r.name,
        href: `${base}/import`,
        cta: "Import",
        rank: 13,
      });
    if (!r.latest_audit && r.checks.gl_imported)
      items.push({
        id: `${r.id}-audit`,
        severity: "info",
        title: "No audit run yet",
        context: r.name,
        href: `${base}/audit`,
        cta: "Run audit",
        rank: 20,
      });
  }
  return items.sort((a, b) => a.rank - b.rank);
}

export default function Overview() {
  const router = useRouter();
  const { current, readiness, reloadReadiness } = useApp();
  const dash = useLoad(() => api.get<{ properties: DashboardRow[] }>("/dashboard"), []);
  const activity = useLoad(() => api.get<ActivityEvent[]>("/activity?limit=40"), []);
  const rows = useMemo(() => dash.data?.properties ?? [], [dash.data]);
  const actions = useMemo(() => buildActions(rows), [rows]);
  const [drawer, setDrawer] = useState<DashboardRow | null>(null);
  const [running, setRunning] = useState(false);
  const runKey = useRef(idemKey("run"));

  const target = current ? (readiness[current.id] ?? rows.find((r) => r.id === current.id)) : rows[0];
  const year = target?.period ? target.period.fiscal_year_end.slice(0, 4) : null;
  const sum = (f: (r: DashboardRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const errors = sum((r) => r.open_exceptions.error ?? 0);
  const warnings = sum((r) => r.open_exceptions.warning ?? 0);
  const loading = dash.loading && !dash.data;

  async function runAudit() {
    if (!target?.period) return;
    setRunning(true);
    try {
      const r = await api.post<AuditRun>(
        `/properties/${target.id}/audit-runs`,
        { period_id: target.period.id },
        { idempotencyKey: runKey.current },
      );
      runKey.current = idemKey("run");
      toast.success(`Audit complete for ${target.name}`, {
        description: `${r.summary.tenants_calculated} calculated, ${r.summary.tenants_unresolved} unresolved`,
      });
      reloadReadiness();
      router.push(`/properties/${target.id}/audit`);
    } catch (x) {
      toast.error(errorText(x));
    } finally {
      setRunning(false);
    }
  }

  const columns = useMemo<ColumnDef<DashboardRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Property",
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="whitespace-nowrap font-medium text-ink">{row.original.name}</div>
            <div className="whitespace-nowrap text-xs text-muted">
              <span className="capitalize">{row.original.property_type}</span> · {row.original.tenants} tenants
            </div>
          </div>
        ),
      },
      {
        id: "period",
        header: "Reporting period",
        accessorFn: (r) => r.period?.through_date ?? "",
        cell: ({ row }) =>
          row.original.period ? (
            <div>
              <div className="whitespace-nowrap text-ink-2">{row.original.period.label}</div>
              <div className="whitespace-nowrap text-xs text-muted">Through {fmtDate(row.original.period.through_date)}</div>
            </div>
          ) : (
            <span className="text-muted">No period</span>
          ),
      },
      {
        id: "readiness",
        header: "Readiness",
        accessorFn: (r) => r.completeness,
        cell: ({ row }) => (
          <AuditProgress
            done={Object.values(row.original.checks).filter(Boolean).length}
            total={Object.keys(row.original.checks).length}
            ready={row.original.ready}
          />
        ),
      },
      {
        id: "exceptions",
        header: "Open exceptions",
        accessorFn: (r) => (r.open_exceptions.error ?? 0) * 1000 + (r.open_exceptions.warning ?? 0),
        cell: ({ row }) => {
          const e = row.original.open_exceptions;
          if (!row.original.latest_audit) return <span className="text-muted">—</span>;
          if (!e.error && !e.warning) return <span className="text-muted">None</span>;
          return (
            <span className="flex items-center gap-3 tabular">
              {!!e.error && (
                <span className="flex items-center gap-1 text-ink">
                  <SeverityIcon severity="error" className="size-3.5" />
                  {e.error}
                </span>
              )}
              {!!e.warning && (
                <span className="flex items-center gap-1 text-ink">
                  <SeverityIcon severity="warning" className="size-3.5" />
                  {e.warning}
                </span>
              )}
            </span>
          );
        },
      },
      {
        id: "latest",
        header: "Last audit",
        accessorFn: (r) => r.latest_audit?.created_at ?? "",
        cell: ({ row }) => {
          const a = row.original.latest_audit;
          return a ? (
            <div>
              <div className="whitespace-nowrap text-ink-2">{fmtDateTime(a.created_at)}</div>
              <div className="whitespace-nowrap text-xs text-muted">
                {a.tenants_calculated} calculated · {a.tenants_unresolved} unresolved
              </div>
            </div>
          ) : (
            <span className="text-muted">Not run</span>
          );
        },
      },
      {
        accessorKey: "reconciliation_status",
        header: "Status",
        cell: ({ getValue }) => (
          <StatusBadge status={(getValue() as string) === "in_review" ? "in_review_status" : (getValue() as string)} />
        ),
      },
      {
        id: "action",
        header: "",
        enableSorting: false,
        meta: { align: "right" },
        cell: ({ row }) => {
          const s = nextStep(row.original);
          return s ? (
            <Link
              href={`/properties/${row.original.id}/${s.slug}`}
              onClick={(e) => e.stopPropagation()}
              className={buttonVariants({ size: "xs", variant: "secondary" })}
            >
              {s.cta}
            </Link>
          ) : (
            <span className="text-xs font-medium text-success">Ready</span>
          );
        },
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Overview"
        description={year ? `${year} CAM pre-close review` : "CAM pre-close review"}
        actions={
          <>
            <Link href={target ? `/properties/${target.id}/import` : "/properties?new=1"} className={buttonVariants({ size: "md" })}>
              <Upload />
              Import data
            </Link>
            <Tooltip content={target?.period ? `Run on ${target.name}, ${target.period.label}` : "Add a reporting period first"}>
              <span>
                <Button variant="primary" size="md" onClick={runAudit} loading={running} disabled={!target?.period}>
                  <Play />
                  Run audit
                </Button>
              </span>
            </Tooltip>
          </>
        }
      />
      <ErrorBox error={dash.error} onRetry={dash.reload} />

      {loading ? (
        <Skeleton className="mb-8 h-[88px] w-full rounded-[var(--radius-lg)]" />
      ) : (
        <MetricStrip
          className="mb-8"
          metrics={[
            {
              label: "Properties in review",
              value: (
                <>
                  {rows.filter((r) => !r.ready).length}
                  <span className="text-md font-normal text-muted"> / {rows.length}</span>
                </>
              ),
              hint: `${rows.filter((r) => r.ready).length} ready for year-end inputs`,
            },
            {
              label: "Open exceptions",
              value: errors + warnings,
              hint: errors ? `${errors} blocking · ${warnings} to review` : `${warnings} to review`,
              tone: errors ? "error" : warnings ? "warning" : "success",
              href: target ? `/properties/${target.id}/exceptions` : undefined,
            },
            {
              label: "Unapproved lease rules",
              value: sum((r) => r.unapproved_rules),
              hint: sum((r) => r.tenants_missing_rules)
                ? `${sum((r) => r.tenants_missing_rules)} tenant without a rule`
                : "Every tenant has a rule",
              tone: sum((r) => r.unapproved_rules) ? "warning" : undefined,
              href: target ? `/properties/${target.id}/rules` : undefined,
            },
            {
              label: "Unmapped GL accounts",
              value: sum((r) => r.accounts_needing_review),
              hint: "Excluded until classified",
              tone: sum((r) => r.accounts_needing_review) ? "warning" : undefined,
              href: target ? `/properties/${target.id}/mapping` : undefined,
            },
          ]}
        />
      )}

      {rows.length === 0 && !loading ? (
        <Panel>
          <EmptyState
            icon={Building2}
            title="Start with a property"
            action={
              <Link href="/properties?new=1" className={buttonVariants({ variant: "primary", size: "md" })}>
                Add a property
              </Link>
            }
          >
            Add a property, then import its general ledger, billings and lease rules.
          </EmptyState>
        </Panel>
      ) : (
        <div className="flex flex-col gap-10">
          <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section aria-labelledby="action-center" className="min-w-0">
              <SectionHeader
                id="action-center"
                title="Action center"
                count={actions.length}
                description="What stands between each property and a clean year-end reconciliation, most urgent first."
              />
              <Panel>
                {loading ? (
                  <div className="space-y-3 p-4">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-3/5" />
                  </div>
                ) : (
                  <ActionList
                    items={actions.slice(0, 8)}
                    empty={
                      <span className="inline-flex items-center gap-2 text-success">
                        <CheckCircle2 className="size-4" />
                        Nothing needs action. Every property is ready for year-end inputs.
                      </span>
                    }
                  />
                )}
                {actions.length > 8 && (
                  <div className="border-t border-line px-4 py-2.5 text-xs text-muted">
                    {actions.length - 8} more items. Open a property to see everything.
                  </div>
                )}
              </Panel>
            </section>
            <aside aria-labelledby="recent-activity" className="min-w-0">
              <SectionHeader id="recent-activity" title="Recent activity" />
              <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-4 shadow-xs">
                {activity.loading && !activity.data ? (
                  <div className="space-y-4">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="flex gap-3">
                        <Skeleton className="size-6 rounded-full" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-3 w-4/5" />
                          <Skeleton className="h-3 w-1/2" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <ActivityTimeline events={activity.data ?? []} showProperty={rows.length > 1} />
                )}
              </div>
            </aside>
          </div>

          <section aria-labelledby="property-overview">
            <SectionHeader
              id="property-overview"
              title="Properties"
              count={rows.length}
              description="Select a row to see its readiness checks."
            />
            <Panel>
              <DataTable
                caption="Property readiness"
                data={rows}
                columns={columns}
                getRowId={(r) => r.id}
                loading={loading}
                onRowClick={setDrawer}
                activeRowId={drawer?.id}
                noToolbar={rows.length < 6}
                searchPlaceholder="Search properties"
                exportName="veyra-readiness"
              />
            </Panel>
          </section>
        </div>
      )}

      <ReadinessDrawer row={drawer} onClose={() => setDrawer(null)} />
    </>
  );
}

function ReadinessDrawer({ row, onClose }: { row: DashboardRow | null; onClose: () => void }) {
  const done = row ? Object.values(row.checks).filter(Boolean).length : 0;
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      {row && (
        <SheetContent
          className="max-w-[460px]"
          eyebrow="Readiness"
          title={row.name}
          description={row.period ? `${row.period.label} · through ${fmtDate(row.period.through_date)}` : "No reporting period"}
          actions={
            <Link href={`/properties/${row.id}`} className={buttonVariants({ size: "xs" })}>
              Open property
            </Link>
          }
        >
          <div className="mb-5 flex items-center justify-between">
            <AuditProgress done={done} total={CHECKS.length} ready={row.ready} />
            <StatusBadge status={row.ready ? "ready" : "in_review_status"} />
          </div>
          <ol className="divide-y divide-line rounded-[var(--radius-lg)] border border-line">
            {CHECKS.map((c) => {
              const ok = row.checks[c.key];
              return (
                <li key={c.key} className="flex items-center gap-3 px-3.5 py-3">
                  {ok ? (
                    <CheckCircle2 className="size-4 text-success" aria-hidden />
                  ) : (
                    <Circle className="size-4 text-subtle" aria-hidden />
                  )}
                  <span className={cn("flex-1 text-sm", ok ? "text-muted" : "text-ink")}>{c.label}</span>
                  <span className="sr-only">{ok ? "done" : "open"}</span>
                  {!ok && (
                    <Link
                      href={`/properties/${row.id}/${c.slug}`}
                      className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                    >
                      {c.cta}
                      <ArrowRight className="size-3" aria-hidden />
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="mt-4 text-xs text-muted">Ready means every check passes. It does not make the figures final.</p>
        </SheetContent>
      )}
    </Dialog>
  );
}
