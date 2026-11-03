"use client";
import { Fragment, useState } from "react";
import { Empty, ErrorBox, ProvisionalBanner, Stat } from "@/components/common";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Select } from "@/components/ui/input";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { api, type AuditRun, type Result, type TraceStep } from "@/lib/api";
import { money, pct } from "@/lib/utils";
import { useProperty } from "../context";
import { RunPicker, useRuns } from "../runs";

export default function AuditWorkspace() {
  const { property, periods, reload: reloadProp } = useProperty();
  const pid = property.id;
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error, reload } = useRuns(pid, selected);
  const [periodId, setPeriodId] = useState(periods[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [traceFor, setTraceFor] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const run = data?.run;

  async function runAudit() {
    setBusy(true);
    try {
      const r = await api.post<AuditRun>(`/properties/${pid}/audit-runs`, { period_id: periodId });
      setSelected(r.id); setErr(null); reload(); reloadProp();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function showTrace(r: Result) {
    if (traceFor === r.id) { setTraceFor(null); return; }
    const t = await api.get<{ steps: TraceStep[] }>(`/audit-results/${r.id}/trace`);
    setTrace(t.steps); setTraceFor(r.id);
  }

  return (
    <div className="space-y-6">
      <ProvisionalBanner />
      <ErrorBox error={error || err} />
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Label>Reporting period<Select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            {periods.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.fiscal_year_start} to {p.through_date})</option>)}</Select></Label>
          <Button onClick={runAudit} disabled={!periodId || busy}>{busy ? "Running" : "Run audit"}</Button>
          <div className="ml-auto"><RunPicker runs={data?.runs ?? []} value={run?.id} onChange={setSelected} /></div>
        </CardContent>
      </Card>
      {!periods.length && <Empty>Add a reporting period on the Overview tab first.</Empty>}
      {run ? <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Tenants calculated" value={run.summary.tenants_calculated} />
          <Stat label="Tenants unresolved" value={run.summary.tenants_unresolved} tone={run.summary.tenants_unresolved ? "error" : undefined} />
          <Stat label="Transactions included" value={run.summary.included_count} />
          <Stat label="Errors / warnings" value={`${run.summary.exception_counts.error ?? 0} / ${run.summary.exception_counts.warning ?? 0}`} tone={run.summary.exception_counts.error ? "error" : undefined} />
          <Stat label="Input fingerprint" value={<span className="font-mono text-sm">{run.input_hash.slice(0, 12)}</span>} />
        </div>

        <Card>
          <CardHeader><CardTitle>Expense pools (YTD through {run.summary.period.through_date})</CardTitle>
            <CardDescription>Excluded transactions: {Object.entries(run.summary.excluded).map(([k, v]) => `${k.replace(/_/g, " ")} ${v.length}`).join(", ") || "none"}</CardDescription></CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead><TR><TH>Pool</TH><TH>Categories</TH><TH className="num">Approved recoverable</TH><TH className="num">Allocated to tenants</TH><TH className="num">Rounding difference</TH></TR></THead>
              <TBody>{Object.entries(run.summary.pools).map(([k, p]) => (
                <TR key={k}><TD className="font-medium">{k}</TD>
                  <TD className="text-xs">{Object.entries(p.by_category).map(([c, a]) => `${c} ${money(a)}`).join(" · ")}</TD>
                  <TD className="num">{money(p.recoverable_total)}</TD><TD className="num">{money(p.allocated_total)}</TD><TD className="num">{money(p.rounding_difference)}</TD></TR>
              ))}</TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Tenant allocation</CardTitle><CardDescription>Variance = provisional share minus YTD billed. Positive means billed less than the provisional share. Click a tenant to see the calculation trace.</CardDescription></CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead><TR><TH>Suite</TH><TH>Tenant</TH><TH>Status</TH><TH>Pool lines</TH><TH className="num">Admin fee</TH><TH className="num">Provisional total</TH><TH className="num">YTD billed</TH><TH className="num">Variance</TH></TR></THead>
              <TBody>{(run.results ?? []).map((r) => (
                <Fragment key={r.id}>
                  <TR className="cursor-pointer" onClick={() => showTrace(r)}>
                    <TD>{r.suite}</TD><TD className="font-medium">{r.tenant_name}</TD><TD><StatusBadge status={r.status} /></TD>
                    <TD className="text-xs">{r.status === "unresolved" ? <span className="text-destructive">{r.unresolved_reasons.join(" ")}</span> :
                      r.lines.map((l) => <div key={l.pool} className="whitespace-nowrap">{l.pool}: {money(l.amount)} <span className="text-muted-foreground">({pct(l.share)} of {money(l.tenant_pool_amount)}{l.cap_reduction !== "0" && `, cap −${money(l.cap_reduction)}`})</span></div>)}</TD>
                    <TD className="num">{money(r.admin_fee)}</TD><TD className="num font-medium">{money(r.total)}</TD><TD className="num">{money(r.billed)}</TD>
                    <TD className={`num ${r.variance && !r.variance.startsWith("-") && r.variance !== "0.00" ? "text-[oklch(0.5_0.12_70)]" : ""}`}>{money(r.variance)}</TD>
                  </TR>
                  {traceFor === r.id && (
                    <tr><td colSpan={8} className="bg-muted/30 px-5 py-3">
                      <Table>
                        <THead><TR><TH>Step</TH><TH>Formula</TH><TH>Inputs</TH><TH className="num">Result</TH></TR></THead>
                        <TBody>{trace.map((s, i) => (
                          <TR key={i}><TD className="whitespace-nowrap">{s.label}</TD><TD className="font-mono text-xs">{s.formula}</TD>
                            <TD className="font-mono text-xs">{Object.entries(s.inputs).map(([k, v]) => `${k}=${v}`).join("  ")}</TD><TD className="num font-mono text-xs">{s.result}</TD></TR>
                        ))}</TBody>
                      </Table>
                    </td></tr>
                  )}
                </Fragment>
              ))}</TBody>
            </Table>
          </CardContent>
        </Card>
      </> : periods.length > 0 && <Empty>No audit runs yet.</Empty>}
    </div>
  );
}
