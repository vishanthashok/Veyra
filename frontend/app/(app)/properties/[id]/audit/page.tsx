"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, Download, Play, Scale, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app/app-context";
import { MetricStrip } from "@/components/app/metrics";
import { EmptyState, ErrorBox, PageHeader, ProvisionalTag, SectionHeader } from "@/components/app/page";
import { SeverityIcon, StatusBadge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Segmented } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/menu";
import { Panel } from "@/components/ui/panel";
import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { type AuditExc, type AuditRun, type Result, api, errorText } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { cn, compareDecimal, fmtDate, fmtDateTime, idemKey, money, sign, subMoney } from "@/lib/utils";
import { crumbs, useProperty } from "../context";
import { RunPicker, useRuns } from "../runs";
import { TraceInspector } from "./trace-inspector";

const OPEN = ["open", "in_review", "reopened"];

/** Exact sum of 2-decimal strings via subMoney (no floats). */
function addAll(values: (string | null | undefined)[]): string {
  return values.reduce<string>((acc, v) => (v ? subMoney(acc, subMoney("0", v)) : acc), "0.00");
}

const REPORTS: [string, string][] = [
  ["package", "Full audit package"],
  ["allocation", "Tenant allocation"],
  ["classification", "Expense classification"],
  ["exceptions", "Exception report"],
];

export default function AuditWorkspace() {
  const ctx = useProperty();
  const { property, periods, reload: reloadProp, base } = ctx;
  const { reloadReadiness } = useApp();
  const [selected, setSelected] = useState<string | null>(null);
  const runs = useRuns(property.id, selected);
  const run = runs.data?.run ?? null;
  const exc = useLoad(() => (run ? api.get<AuditExc[]>(`/audit-runs/${run.id}/exceptions`) : Promise.resolve([] as AuditExc[])), [run?.id]);
  const [periodId, setPeriodId] = useState(periods[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [inspect, setInspect] = useState<Result | null>(null);
  const [view, setView] = useState<"all" | "calculated" | "unresolved" | "variance">("all");
  const runKey = useRef(idemKey("run"));

  const openByTenant = useMemo(() => {
    const m: Record<string, AuditExc[]> = {};
    for (const e of exc.data ?? []) if (e.tenant_id && OPEN.includes(e.status)) (m[e.tenant_id] ??= []).push(e);
    return m;
  }, [exc.data]);

  async function runAudit() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<AuditRun>(
        `/properties/${property.id}/audit-runs`,
        { period_id: periodId },
        { idempotencyKey: runKey.current },
      );
      runKey.current = idemKey("run");
      setSelected(r.id);
      runs.reload();
      reloadProp();
      reloadReadiness();
      toast.success("Audit complete", {
        description: `${r.summary.tenants_calculated} calculated, ${r.summary.tenants_unresolved} unresolved`,
      });
    } catch (x) {
      setErr(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!run) return;
    setVerifying(true);
    try {
      const v = await api.post<{ reproducible: boolean; differences: string[]; reason?: string }>(`/audit-runs/${run.id}/verify`);
      if (v.reproducible) toast.success("Reproducible", { description: "Re-running the stored snapshot gives identical results." });
      else toast.error(v.reason ?? `Not reproducible: ${v.differences.join(", ")}`);
    } catch (x) {
      toast.error(errorText(x));
    } finally {
      setVerifying(false);
    }
  }

  const results = useMemo(() => run?.results ?? [], [run]);
  const pools = useMemo(() => [...new Set(results.flatMap((r) => r.lines.map((l) => l.pool)))].sort(), [results]);
  const visible = useMemo(
    () =>
      results.filter((r) =>
        view === "all" ? true : view === "variance" ? r.variance !== null && sign(r.variance) !== 0 : r.status === view,
      ),
    [results, view],
  );

  const columns = useMemo<ColumnDef<Result, unknown>[]>(
    () => [
      {
        id: "tenant",
        header: "Tenant",
        columns: [
          { accessorKey: "suite", header: "Suite", meta: { cellClassName: "w-14 tabular text-muted" } },
          {
            accessorKey: "tenant_name",
            header: "Name",
            meta: { label: "Tenant", cellClassName: "whitespace-nowrap" },
            cell: ({ row }) => {
              const r = row.original;
              const open = openByTenant[r.tenant_id] ?? [];
              const worst = open.some((e) => e.severity === "error") ? "error" : open.length ? "warning" : null;
              return (
                <span className="flex items-center gap-2">
                  <span className="font-medium text-ink">{r.tenant_name}</span>
                  {r.status === "unresolved" ? (
                    <Tooltip content={r.unresolved_reasons.join(" ")}>
                      <span>
                        <StatusBadge status="unresolved" />
                      </span>
                    </Tooltip>
                  ) : (
                    worst && (
                      <Tooltip content={`${open.length} open exception${open.length > 1 ? "s" : ""}`}>
                        <span>
                          <SeverityIcon severity={worst} className="size-3.5" />
                        </span>
                      </Tooltip>
                    )
                  )}
                </span>
              );
            },
          },
        ],
      },
      {
        id: "calc",
        header: "Calculated",
        columns: [
          ...pools.map<ColumnDef<Result, unknown>>((p) => ({
            id: `pool_${p}`,
            header: p,
            meta: { align: "right", label: `${p} line`, exportValue: (r: Result) => r.lines.find((l) => l.pool === p)?.amount ?? "" },
            accessorFn: (r) => r.lines.find((l) => l.pool === p)?.amount ?? "",
            sortingFn: (a, b) => compareDecimal(a.getValue(`pool_${p}`), b.getValue(`pool_${p}`)),
            cell: ({ getValue }) => <span className="text-ink-2">{money(getValue() as string, { blank: "—" })}</span>,
          })),
          {
            accessorKey: "admin_fee",
            header: "Admin fee",
            meta: { align: "right" },
            cell: ({ row }) => (
              <span className="text-ink-2">{row.original.status === "calculated" ? money(row.original.admin_fee) : "—"}</span>
            ),
          },
          {
            accessorKey: "total",
            header: "Total",
            meta: { align: "right", cellClassName: "font-semibold" },
            sortingFn: (a, b) => compareDecimal(a.original.total, b.original.total),
            cell: ({ getValue }) => money(getValue() as string | null),
          },
        ],
      },
      {
        id: "billing",
        header: "Billed",
        columns: [
          {
            accessorKey: "billed",
            header: "In window",
            meta: { align: "right", label: "Billed in window" },
            sortingFn: (a, b) => compareDecimal(a.original.billed, b.original.billed),
            cell: ({ getValue }) => money(getValue() as string | null),
          },
        ],
      },
      {
        id: "diff",
        header: "Difference",
        columns: [
          {
            accessorKey: "variance",
            header: "Variance",
            meta: { align: "right", label: "Provisional variance" },
            sortingFn: (a, b) => compareDecimal(a.original.variance, b.original.variance),
            cell: ({ getValue }) => {
              const v = getValue() as string | null;
              return <span className={cn("font-medium", sign(v) > 0 && "text-under", sign(v) < 0 && "text-over")}>{money(v)}</span>;
            },
          },
          {
            id: "direction",
            header: "Direction",
            accessorFn: (r) =>
              r.variance === null ? "" : sign(r.variance) > 0 ? "Under-billed" : sign(r.variance) < 0 ? "Over-billed" : "Matches",
            cell: ({ getValue }) => <span className="whitespace-nowrap text-xs text-muted">{(getValue() as string) || "—"}</span>,
          },
        ],
      },
    ],
    [pools, openByTenant],
  );

  const s = run?.summary;
  const counts = {
    all: results.length,
    calculated: results.filter((r) => r.status === "calculated").length,
    unresolved: results.filter((r) => r.status === "unresolved").length,
    variance: results.filter((r) => r.variance !== null && sign(r.variance) !== 0).length,
  };
  const recoverable = s ? addAll(Object.values(s.pools).map((p) => p.recoverable_total)) : "0";
  const allocated = s ? addAll(Object.values(s.pools).map((p) => p.allocated_total)) : "0";
  const billed = addAll(results.map((r) => r.billed));
  const variance = addAll(results.map((r) => r.variance));
  const openErrors = (exc.data ?? []).filter((e) => e.severity === "error" && OPEN.includes(e.status)).length;
  const openWarnings = (exc.data ?? []).filter((e) => e.severity === "warning" && OPEN.includes(e.status)).length;

  return (
    <>
      <PageHeader
        title="Audit workspace"
        crumbs={crumbs(ctx, "Audit workspace")}
        meta={<ProvisionalTag />}
        description={
          run && s ? (
            <span className="flex flex-wrap items-center gap-x-2 text-sm">
              <span>
                {run.period_label} · {fmtDate(s.period.fiscal_year_start)} – {fmtDate(s.period.through_date)}
              </span>
              <span className="text-subtle">·</span>
              <span>Run {fmtDateTime(run.created_at)}</span>
              <span className="text-subtle">·</span>
              <Tooltip content={`Input fingerprint ${run.input_hash}`}>
                <span className="font-mono text-xs">engine {run.engine_version}</span>
              </Tooltip>
            </span>
          ) : (
            "Run the engine on reviewed data. Each run freezes its inputs so it stays reproducible."
          )
        }
        actions={
          <>
            {run && (
              <>
                <Tooltip content="Re-run the stored snapshot and compare every figure">
                  <span>
                    <Button onClick={verify} loading={verifying} disabled={!run.reproducible} size="md" variant="ghost">
                      <ShieldCheck />
                      Verify
                    </Button>
                  </span>
                </Tooltip>
                <Menu>
                  <MenuTrigger asChild>
                    <Button size="md" disabled={!run.reproducible}>
                      <Download />
                      Export
                      <ChevronDown className="!size-3.5 text-muted" />
                    </Button>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuLabel>Excel workbooks for this run</MenuLabel>
                    {REPORTS.map(([k, label]) => (
                      <MenuItem key={k} asChild>
                        <a href={`/api/v1/audit-runs/${run.id}/reports/${k}.xlsx`}>{label}</a>
                      </MenuItem>
                    ))}
                    <MenuItem asChild>
                      <Link href={`${base}/reports`}>All reports…</Link>
                    </MenuItem>
                  </MenuContent>
                </Menu>
              </>
            )}
            <Button variant="primary" size="md" onClick={runAudit} loading={busy} disabled={!periodId}>
              <Play />
              Run audit
            </Button>
          </>
        }
      />
      <ErrorBox error={runs.error || err} />

      {!periods.length ? (
        <Panel>
          <EmptyState
            icon={Scale}
            title="No reporting period"
            action={
              <Link className={buttonVariants({ variant: "primary" })} href={base}>
                Add a period
              </Link>
            }
          >
            Add a reporting period in property setup first.
          </EmptyState>
        </Panel>
      ) : runs.loading && !runs.data ? (
        <div className="space-y-6">
          <Skeleton className="h-[88px] w-full rounded-[var(--radius-lg)]" />
          <Panel>
            <TableSkeleton rows={8} cols={7} />
          </Panel>
        </div>
      ) : !run || !s ? (
        <Panel>
          <EmptyState
            icon={Scale}
            title="No audit runs yet"
            action={
              <Button variant="primary" onClick={runAudit} loading={busy}>
                <Play />
                Run first audit
              </Button>
            }
          >
            Runs use approved lease rules and reviewed GL mappings only.
          </EmptyState>
        </Panel>
      ) : (
        <div className="flex flex-col gap-9">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <RunPicker runs={runs.data?.runs ?? []} value={run.id} onChange={setSelected} />
            {periods.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-muted">
                Next run period
                <select
                  value={periodId}
                  onChange={(e) => setPeriodId(e.target.value)}
                  className="h-8 rounded-[var(--radius-md)] border border-line-strong bg-surface px-2 text-sm text-ink"
                >
                  {periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <MetricStrip
            className="-mt-5"
            metrics={[
              {
                label: "Approved recoverable",
                value: money(recoverable),
                hint: `${s.included_count} of ${s.transaction_count ?? s.included_count} transactions`,
              },
              {
                label: "Allocated to tenants",
                value: money(allocated),
                hint: `${s.tenants_calculated} of ${results.length} tenants calculated`,
              },
              { label: "Billed in window", value: money(billed), hint: "Estimates recorded to date" },
              {
                label: "Net provisional variance",
                value: money(variance),
                hint: sign(variance) > 0 ? "Billed less than provisional share" : sign(variance) < 0 ? "Billed more than share" : "Matches",
                tone: sign(variance) !== 0 ? "warning" : undefined,
              },
              {
                label: "Open exceptions",
                value: openErrors + openWarnings,
                hint: `${openErrors} blocking · ${openWarnings} warnings`,
                tone: openErrors ? "error" : openWarnings ? "warning" : "success",
                href: `${base}/exceptions`,
              },
            ]}
          />

          <section aria-labelledby="tenants">
            <SectionHeader
              id="tenants"
              title="Tenant reconciliation"
              count={results.length}
              description="Select a tenant to trace every number back to its source."
            />
            <Panel>
              <DataTable
                caption="Tenant reconciliation"
                data={visible}
                columns={columns}
                getRowId={(r) => r.id}
                onRowClick={setInspect}
                activeRowId={inspect?.id}
                filterStart={
                  <Segmented
                    label="Tenant status"
                    value={view}
                    onChange={setView}
                    options={[
                      { value: "all", label: "All", count: counts.all },
                      { value: "calculated", label: "Calculated", count: counts.calculated },
                      { value: "unresolved", label: "Unresolved", count: counts.unresolved },
                      { value: "variance", label: "With variance", count: counts.variance },
                    ]}
                  />
                }
                searchPlaceholder="Search tenants"
                exportName={`veyra-audit-${run.id.slice(0, 8)}`}
                columnsMenu
                initialSorting={[{ id: "suite", desc: false }]}
                maxHeight="calc(100vh - 220px)"
              />
            </Panel>
          </section>

          <section aria-labelledby="pools">
            <SectionHeader
              id="pools"
              title="Expense pools"
              count={Object.keys(s.pools).length}
              description="Recoverable is the sum of included transactions. The unallocated remainder is landlord share, vacancy or unresolved tenants."
            />
            <Panel>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Expense pools</caption>
                  <thead>
                    <tr className="border-b border-line text-xs text-muted">
                      <th scope="col" className="h-9 px-[var(--cell-x)] text-left font-medium">
                        Pool
                      </th>
                      <th scope="col" className="px-[var(--cell-x)] text-left font-medium">
                        Allocation
                      </th>
                      <th scope="col" className="px-[var(--cell-x)] text-right font-medium">
                        Recoverable
                      </th>
                      <th scope="col" className="px-[var(--cell-x)] text-right font-medium">
                        Allocated
                      </th>
                      <th scope="col" className="px-[var(--cell-x)] text-right font-medium">
                        Unallocated
                      </th>
                      <th scope="col" className="px-[var(--cell-x)] text-right font-medium">
                        Rounding
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(s.pools).map(([k, p]) => {
                      const un = subMoney(p.recoverable_total, p.allocated_total);
                      const pctAlloc =
                        sign(p.recoverable_total) > 0
                          ? Math.max(
                              0,
                              Math.min(
                                100,
                                Number(
                                  (BigInt(p.allocated_total.replace(".", "")) * BigInt(1000)) /
                                    BigInt(p.recoverable_total.replace(".", "")),
                                ) / 10,
                              ),
                            )
                          : 0;
                      return (
                        <tr key={k} className="border-b border-line last:border-0">
                          <td className="px-[var(--cell-x)] py-3 align-top">
                            <div className="font-semibold text-ink">{k}</div>
                            <div className="mt-0.5 text-xs text-muted">
                              {Object.keys(p.by_category).length} categor{Object.keys(p.by_category).length === 1 ? "y" : "ies"}
                            </div>
                          </td>
                          <td className="w-[38%] px-[var(--cell-x)] py-3 align-top">
                            <div
                              className="flex h-2 overflow-hidden rounded-full bg-surface-3"
                              role="img"
                              aria-label={`${pctAlloc}% allocated`}
                            >
                              <div className="bg-accent" style={{ width: `${pctAlloc}%` }} />
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                              {Object.entries(p.by_category).map(([c, a]) => (
                                <span key={c} className="whitespace-nowrap">
                                  {c.toLowerCase().replace(/_/g, " ")} <span className="tabular text-ink-2">{money(a)}</span>
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="num px-[var(--cell-x)] py-3 align-top font-medium">{money(p.recoverable_total)}</td>
                          <td className="num px-[var(--cell-x)] py-3 align-top">
                            {money(p.allocated_total)}
                            <div className="text-xs text-muted">{pctAlloc}%</div>
                          </td>
                          <td className="num px-[var(--cell-x)] py-3 align-top text-ink-2">{money(un)}</td>
                          <td className="num px-[var(--cell-x)] py-3 align-top text-muted">{money(p.rounding_difference)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          </section>
        </div>
      )}
      <TraceInspector
        result={inspect}
        onClose={() => setInspect(null)}
        periodLabel={run && s ? `${run.period_label ?? ""} · through ${fmtDate(s.period.through_date)}` : ""}
      />
    </>
  );
}
