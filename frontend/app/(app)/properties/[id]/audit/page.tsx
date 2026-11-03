"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { FileSpreadsheet, Play, Scale, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorBox, PageHeader, ProvisionalBanner, Stat } from "@/components/app/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { api, errorText, type AuditExc, type AuditRun, type Result } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { cn, compareDecimal, fmtDate, fmtDateTime, idemKey, money, sign, subMoney } from "@/lib/utils";
import { crumbs, useProperty } from "../context";
import { RunPicker, useRuns } from "../runs";
import { TraceInspector } from "./trace-inspector";

export default function AuditWorkspace() {
  const ctx = useProperty();
  const { property, periods, reload: reloadProp, base } = ctx;
  const [selected, setSelected] = useState<string | null>(null);
  const runs = useRuns(property.id, selected);
  const run = runs.data?.run ?? null;
  const exc = useLoad(() => (run ? api.get<AuditExc[]>(`/audit-runs/${run.id}/exceptions`) : Promise.resolve([] as AuditExc[])), [run?.id]);
  const [periodId, setPeriodId] = useState(periods[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [inspect, setInspect] = useState<Result | null>(null);
  const runKey = useRef(idemKey("run"));

  const openByTenant = useMemo(() => {
    const m: Record<string, AuditExc[]> = {};
    for (const e of exc.data ?? []) if (e.tenant_id && ["open", "in_review", "reopened"].includes(e.status)) (m[e.tenant_id] ??= []).push(e);
    return m;
  }, [exc.data]);

  async function runAudit() {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<AuditRun>(`/properties/${property.id}/audit-runs`, { period_id: periodId }, { idempotencyKey: runKey.current });
      runKey.current = idemKey("run");
      setSelected(r.id); runs.reload(); reloadProp();
      toast.success(`Audit complete: ${r.summary.tenants_calculated} calculated, ${r.summary.tenants_unresolved} unresolved`);
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  }

  async function verify() {
    if (!run) return;
    setVerifying(true);
    try {
      const v = await api.post<{ reproducible: boolean; differences: string[]; reason?: string }>(`/audit-runs/${run.id}/verify`);
      if (v.reproducible) toast.success("Reproducible. Re-running the stored snapshot gives identical results.");
      else toast.error(v.reason ?? `Not reproducible: ${v.differences.join(", ")}`);
    } catch (x) { toast.error(errorText(x)); } finally { setVerifying(false); }
  }

  const pools = useMemo(() => [...new Set((run?.results ?? []).flatMap((r) => r.lines.map((l) => l.pool)))].sort(), [run]);

  const columns = useMemo<ColumnDef<Result, unknown>[]>(() => [
    { id: "tenant", header: "Tenant", columns: [
      { accessorKey: "suite", header: "Suite", meta: { cellClassName: "w-14 tabular text-ink-2" } },
      { accessorKey: "tenant_name", header: "Name", meta: { label: "Tenant", cellClassName: "whitespace-nowrap" }, cell: ({ row }) => <span className="font-medium">{row.original.tenant_name}</span> },
      { accessorKey: "status", header: "Status", cell: ({ row }) => (
        row.original.status === "unresolved"
          ? <Tooltip content={row.original.unresolved_reasons.join(" ")}><span><StatusBadge status="unresolved" /></span></Tooltip>
          : <StatusBadge status="calculated" />) },
    ] },
    { id: "calc", header: "Calculated (provisional)", columns: [
      ...pools.map<ColumnDef<Result, unknown>>((p) => ({
        id: `pool_${p}`, header: p, meta: { align: "right", label: `${p} line`, exportValue: (r: Result) => r.lines.find((l) => l.pool === p)?.amount ?? "" },
        accessorFn: (r) => r.lines.find((l) => l.pool === p)?.amount ?? "",
        sortingFn: (a, b) => compareDecimal(a.getValue(`pool_${p}`), b.getValue(`pool_${p}`)),
        cell: ({ getValue }) => money(getValue() as string, { blank: "—" }),
      })),
      { accessorKey: "admin_fee", header: "Admin fee", meta: { align: "right" }, cell: ({ row }) => row.original.status === "calculated" ? money(row.original.admin_fee) : "—" },
      { accessorKey: "total", header: "Total", meta: { align: "right", cellClassName: "font-semibold" }, sortingFn: (a, b) => compareDecimal(a.original.total, b.original.total), cell: ({ getValue }) => money(getValue() as string | null) },
    ] },
    { id: "billing", header: "Billed", columns: [
      { accessorKey: "billed", header: "In window", meta: { align: "right", label: "Billed in window" }, sortingFn: (a, b) => compareDecimal(a.original.billed, b.original.billed), cell: ({ getValue }) => money(getValue() as string | null) },
    ] },
    { id: "diff", header: "Difference", columns: [
      { accessorKey: "variance", header: "Variance", meta: { align: "right", label: "Provisional variance" }, sortingFn: (a, b) => compareDecimal(a.original.variance, b.original.variance),
        cell: ({ getValue }) => { const v = getValue() as string | null; return <span className={cn(sign(v) > 0 && "text-under", sign(v) < 0 && "text-over")}>{money(v)}</span>; } },
      { id: "direction", header: "Direction", accessorFn: (r) => (r.variance === null ? "" : sign(r.variance) > 0 ? "Under-billed" : sign(r.variance) < 0 ? "Over-billed" : "Matches"),
        cell: ({ getValue }) => <span className="text-xs text-ink-2">{(getValue() as string) || "—"}</span> },
    ] },
    { id: "review", header: "Review", columns: [
      { id: "open_exc", header: "Open items", meta: { align: "right" }, accessorFn: (r) => openByTenant[r.tenant_id]?.length ?? 0,
        cell: ({ row }) => {
          const list = openByTenant[row.original.tenant_id] ?? [];
          if (!list.length) return <span className="text-muted">0</span>;
          const errs = list.filter((e) => e.severity === "error").length;
          return <Link href={`${base}/exceptions`} onClick={(e) => e.stopPropagation()}><Badge tone={errs ? "error" : "warning"}>{list.length}</Badge></Link>;
        } },
    ] },
  ], [pools, openByTenant, base]);

  const s = run?.summary;
  const runLabel = run ? `${run.period_label ?? "Period"} · ${fmtDate(s!.period.fiscal_year_start)} – ${fmtDate(s!.period.through_date)}` : "";

  return (
    <>
      <PageHeader title="Audit workspace" crumbs={crumbs(ctx, "Audit workspace")}
        description="Run the engine on the current reviewed data. Each run freezes its inputs, so it stays reproducible when data changes later."
        actions={<>
          <label className="flex items-center gap-2 text-xs text-muted">Period
            <select value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-sm text-ink">
              {periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <Button variant="primary" onClick={runAudit} loading={busy} disabled={!periodId}><Play />Run audit</Button>
        </>} />
      <ProvisionalBanner />
      <ErrorBox error={runs.error || err} />
      {!periods.length && <Panel><EmptyState icon={Scale} title="No reporting period" action={<Link className={buttonVariants({ variant: "primary" })} href={base}>Add a period</Link>}>Add a reporting period on the overview page first.</EmptyState></Panel>}
      {periods.length > 0 && !run && !runs.loading && <Panel><EmptyState icon={Scale} title="No audit runs yet" action={<Button variant="primary" onClick={runAudit} loading={busy}><Play />Run first audit</Button>}>Runs use approved lease rules and reviewed GL mappings only.</EmptyState></Panel>}

      {run && s && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 text-xs text-muted shadow-xs">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span><b className="font-medium text-ink">{runLabel}</b></span>
              <span>Run {fmtDateTime(run.created_at)}</span>
              <span>Engine {run.engine_version}</span>
              <span className="font-mono">input {run.input_hash.slice(0, 12)}</span>
              {run.reproducible ? <Badge tone="success">Snapshot stored</Badge> : <Badge tone="warning">Legacy run, no snapshot</Badge>}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <RunPicker runs={runs.data?.runs ?? []} value={run.id} onChange={setSelected} />
              <Button size="xs" onClick={verify} loading={verifying} disabled={!run.reproducible}><ShieldCheck />Verify</Button>
              <Link className={buttonVariants({ size: "xs" })} href={`${base}/reports`}><FileSpreadsheet />Reports</Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Tenants calculated" value={s.tenants_calculated} />
            <Stat label="Tenants unresolved" value={s.tenants_unresolved} tone={s.tenants_unresolved ? "error" : "success"} hint="Need data or manual review" />
            <Stat label="Transactions included" value={`${s.included_count} of ${s.transaction_count ?? s.included_count}`} hint={Object.entries(s.excluded).map(([k, v]) => `${v.length} ${k.replace(/_/g, " ")}`).join(" · ") || "None excluded"} />
            <Stat label="Open errors" value={(exc.data ?? []).filter((e) => e.severity === "error" && ["open", "in_review", "reopened"].includes(e.status)).length} tone={s.exception_counts.error ? "error" : "success"} href={`${base}/exceptions`} />
            <Stat label="Open warnings" value={(exc.data ?? []).filter((e) => e.severity === "warning" && ["open", "in_review", "reopened"].includes(e.status)).length} tone={s.exception_counts.warning ? "warning" : undefined} href={`${base}/exceptions`} />
          </div>

          <Panel>
            <PanelHeader title="Expense pools" description="Approved recoverable is the sum of included transactions. Allocated is the sum of rounded tenant lines; the remainder is landlord share, vacancy or unresolved tenants." />
            <Table>
              <THead><TR><TH>Pool</TH><TH>Categories (eligible YTD)</TH><TH className="text-right">Approved recoverable</TH><TH className="text-right">Allocated</TH><TH className="text-right">Unallocated</TH><TH className="text-right">Rounding diff.</TH></TR></THead>
              <TBody>{Object.entries(s.pools).map(([k, p]) => (
                <TR key={k}>
                  <TD className="font-semibold">{k}</TD>
                  <TD className="text-xs text-ink-2">{Object.entries(p.by_category).map(([c, a]) => <span key={c} className="mr-3 inline-block whitespace-nowrap"><span className="font-mono">{c}</span> {money(a)}</span>)}</TD>
                  <TD className="num">{money(p.recoverable_total)}</TD><TD className="num">{money(p.allocated_total)}</TD>
                  <TD className="num text-ink-2">{money(subMoney(p.recoverable_total, p.allocated_total))}</TD>
                  <TD className="num">{money(p.rounding_difference)}</TD>
                </TR>
              ))}</TBody>
            </Table>
          </Panel>

          <Panel>
            <PanelHeader title="Tenant reconciliation" description="Select a tenant to inspect every step of its calculation. Variance = provisional total minus billed in the window." />
            <DataTable caption="Tenant reconciliation" data={run.results ?? []} columns={columns} getRowId={(r) => r.id} onRowClick={setInspect} activeRowId={inspect?.id}
              searchPlaceholder="Search tenants" facets={[{ columnId: "status", label: "Status", options: [{ value: "calculated", label: "Calculated" }, { value: "unresolved", label: "Unresolved" }] }]}
              exportName={`veyra-audit-${run.id.slice(0, 8)}`} initialSorting={[{ id: "suite", desc: false }]} />
          </Panel>
        </div>
      )}
      <TraceInspector result={inspect} onClose={() => setInspect(null)} periodLabel={runLabel} />
    </>
  );
}
