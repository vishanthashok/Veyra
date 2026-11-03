"use client";
import { Info } from "lucide-react";
import * as React from "react";
import { KeyValue } from "@/components/app/page";
import { StatusBadge } from "@/components/ui/badge";
import { Dialog, SheetContent } from "@/components/ui/dialog";
import { TableSkeleton } from "@/components/ui/skeleton";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { api, type Result, type Trace } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { cn, fmtDate, fmtDateTime, money, pct, sign } from "@/lib/utils";

/** Display a Decimal string rounded to 6 places for reading. Stored values keep full precision. */
function short(v: string | null | undefined) {
  if (v == null) return "—";
  if (!/^-?\d+(\.\d+)?$/.test(v)) return v;
  const [i, f = ""] = v.split(".");
  return f.length > 6 ? `${i}.${f.slice(0, 6)}…` : v;
}

function Section({ n, title, children, tone }: { n: number; title: string; children: React.ReactNode; tone?: "source" | "rule" | "calc" | "billed" | "diff" }) {
  const bar = { source: "bg-[#9aa7bb]", rule: "bg-accent", calc: "bg-[#0e9384]", billed: "bg-[#6172f3]", diff: "bg-[#dc6803]" }[tone ?? "calc"];
  return (
    <section className="relative rounded-lg border border-line bg-surface p-4 pl-5 shadow-xs">
      <span className={cn("absolute inset-y-3 left-0 w-1 rounded-r", bar)} aria-hidden />
      <h3 className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="flex size-5 items-center justify-center rounded-full bg-surface-3 text-2xs font-semibold text-ink-2">{n}</span>{title}
      </h3>
      {children}
    </section>
  );
}

export function TraceInspector({ result, onClose, periodLabel }: { result: Result | null; onClose: () => void; periodLabel: string }) {
  const trace = useLoad(() => (result ? api.get<Trace>(`/audit-results/${result.id}/trace`) : Promise.resolve(null)), [result?.id]);
  const t = trace.data;
  const rule = t?.lease_rule;
  const steps = t?.steps ?? [];
  const occ = steps.find((s) => s.label === "Occupancy factor");
  const fee = steps.find((s) => s.label === "Admin fee");

  return (
    <Dialog open={!!result} onOpenChange={(o) => !o && onClose()}>
      {result && (
        <SheetContent title={<span className="flex items-center gap-2">{result.suite && <span className="text-muted">Suite {result.suite}</span>}{result.tenant_name}<StatusBadge status={result.status} /></span>}
          description={<>Calculation inspector · {periodLabel} · engine {t?.engine_version ?? "…"} · input {t?.input_hash.slice(0, 12) ?? "…"}</>}>
          {!t ? <TableSkeleton rows={8} /> : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted" aria-label="Legend">
                {[["bg-[#9aa7bb]", "Source data"], ["bg-accent", "Approved rule"], ["bg-[#0e9384]", "Calculated"], ["bg-[#6172f3]", "Billed"], ["bg-[#dc6803]", "Difference"]].map(([c, l]) => (
                  <span key={l} className="flex items-center gap-1.5"><span className={cn("h-2.5 w-1 rounded", c)} aria-hidden />{l}</span>
                ))}
              </div>

              {result.status === "unresolved" && (
                <div role="alert" className="rounded-md border border-error-line bg-error-bg px-3 py-2 text-sm text-error">
                  <b>No amount calculated.</b> {result.unresolved_reasons.join(" ")}
                </div>
              )}

              <Section n={1} title="Source expense pools" tone="source">
                <Table>
                  <THead><TR><TH>Pool</TH><TH>Category</TH><TH className="text-right">Eligible YTD</TH></TR></THead>
                  <TBody>
                    {Object.entries(t.pools).filter(([pool]) => !rule || rule.pools.some((p) => p.pool === pool)).flatMap(([pool, ps]) =>
                      Object.entries(ps.by_category).map(([cat, amt]) => <TR key={pool + cat}><TD>{pool}</TD><TD className="font-mono text-xs">{cat}</TD><TD className="num">{money(amt)}</TD></TR>))}
                  </TBody>
                </Table>
              </Section>

              <Section n={2} title="Excluded transactions" tone="source">
                <p className="mb-2 text-sm text-ink-2">Excluded from every pool in this run:</p>
                <ul className="flex flex-wrap gap-2 text-sm">
                  {Object.entries(t.excluded_counts).length ? Object.entries(t.excluded_counts).map(([k, v]) => <li key={k} className="rounded border border-line bg-surface-2 px-2 py-0.5">{k.replace(/_/g, " ")}: <b className="tabular">{v}</b></li>) : <li className="text-muted">None</li>}
                </ul>
                {rule?.pools.some((p) => p.excluded_categories.length) && (
                  <p className="mt-2 text-sm text-ink-2">Excluded for this tenant by lease: {rule.pools.filter((p) => p.excluded_categories.length).map((p) => `${p.pool}: ${p.excluded_categories.join(", ")}`).join("; ")}</p>
                )}
              </Section>

              <Section n={3} title="Approved recoverable total" tone="source">
                <KeyValue items={(rule?.pools ?? []).map((p) => [p.pool, t.pools[p.pool] ? <span className="tabular">{money(t.pools[p.pool].recoverable_total)}</span> : <span className="text-muted">No eligible transactions</span>])} />
              </Section>

              <Section n={4} title="Allocation rule" tone="rule">
                {rule ? <KeyValue items={[
                  ["Rule", <span key="r" className="font-mono">{rule.ref} v{rule.version}</span>],
                  ["Approved", `${rule.approved_by ?? "Unknown"}, ${fmtDateTime(rule.approved_at)}`],
                  ["Lease source", rule.source_ref || "Not recorded"],
                  ["Lease term", `${fmtDate(t.tenant?.lease_start)} – ${t.tenant?.lease_end ? fmtDate(t.tenant.lease_end) : "open"}`],
                ]} /> : <p className="text-sm text-error">No approved lease rule in this run.</p>}
              </Section>

              <Section n={5} title="Allocation basis" tone="rule">
                <Table>
                  <THead><TR><TH>Pool</TH><TH>Method</TH><TH className="text-right">Tenant area</TH><TH className="text-right">Denominator / fixed %</TH></TR></THead>
                  <TBody>{(rule?.pools ?? []).map((p) => (
                    <TR key={p.pool}><TD>{p.pool}</TD><TD>{p.method === "pro_rata" ? "Pro-rata by area" : "Fixed percentage"}</TD>
                      <TD className="num">{p.method === "pro_rata" ? (t.tenant?.rentable_area ?? <span className="text-error">Missing</span>) : "—"}</TD>
                      <TD className="num">{p.method === "pro_rata" ? (p.denominator_sqft ?? <span className="text-error">Missing</span>) : pct(p.fixed_pct, 4)}</TD></TR>
                  ))}</TBody>
                </Table>
              </Section>

              <Section n={6} title="Tenant share" tone="calc">
                <KeyValue items={[
                  ...result.lines.map((l) => [l.pool, <span key={l.pool} className="tabular">{pct(l.share, 4)} of {money(l.tenant_pool_amount)}</span>] as [string, React.ReactNode]),
                  ["Occupancy factor", occ ? <span className="tabular">{short(occ.result)} ({occ.inputs.occupied_days} of {occ.inputs.ytd_days} days)</span> : "—"],
                ]} />
              </Section>

              <Section n={7} title="Approved adjustments" tone="calc">
                {(() => {
                  const adj = steps.filter((s) => /Gross-up|Base year|Controllable cap|Exclude/.test(s.label));
                  return adj.length ? (
                    <ul className="space-y-2 text-sm">
                      {adj.map((s, i) => (
                        <li key={i} className="rounded-md bg-surface-2 px-3 py-2">
                          <div className="flex justify-between gap-3"><span className="font-medium">{s.label}</span><span className="tabular">{short(s.result)}</span></div>
                          <div className="font-mono text-2xs text-muted">{s.formula}</div>
                          {s.inputs.note && <div className="mt-1 flex gap-1 text-2xs text-info"><Info className="size-3" />{s.inputs.note}</div>}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-muted">No gross-up, base year, cap or category exclusion applies.</p>;
                })()}
              </Section>

              <Section n={8} title="Administrative fee" tone="calc">
                {fee ? <KeyValue items={[["Fee", <b key="f" className="tabular">{money(fee.result)}</b>], ["Rate", pct(fee.inputs.admin_pct, 2)], ["Applied to", `${fee.inputs.pools} pools, ${fee.inputs.order}`], ["Fee base", <span key="b" className="tabular">{money(fee.inputs.fee_base)}</span>]]} />
                  : <p className="text-sm text-muted">No admin fee in this lease rule. Applied once per tenant when present.</p>}
              </Section>

              <Section n={9} title="Provisional calculated amount" tone="calc">
                <Table>
                  <THead><TR><TH>Component</TH><TH className="text-right">Unrounded</TH><TH className="text-right">Amount</TH></TR></THead>
                  <TBody>
                    {result.lines.map((l) => <TR key={l.pool}><TD>{l.pool} pool line{l.cap_reduction !== "0" && l.cap_reduction !== "0.00" && <span className="text-2xs text-muted"> (after cap −{money(l.cap_reduction)})</span>}</TD><TD className="num text-muted">{short(l.amount_unrounded)}</TD><TD className="num">{money(l.amount)}</TD></TR>)}
                    <TR><TD>Admin fee</TD><TD /><TD className="num">{money(result.admin_fee)}</TD></TR>
                    <TR className="bg-surface-2 font-semibold"><TD>Provisional total</TD><TD /><TD className="num">{money(result.total)}</TD></TR>
                  </TBody>
                </Table>
                <p className="mt-2 text-2xs text-muted">Each line and the fee are rounded half up to cents. The total is the sum of rounded components.</p>
              </Section>

              <Section n={10} title="Recorded billings" tone="billed">
                <p className="text-sm">{result.billed !== null ? <>Billed in the audit window: <b className="tabular">{money(result.billed)}</b></> : <span className="text-warning">No billings recorded for this tenant in the window. Variance is not computed.</span>}</p>
              </Section>

              <Section n={11} title="Provisional variance" tone="diff">
                {result.variance !== null ? (
                  <p className="text-sm">
                    <b className="tabular">{money(result.variance)}</b> = {money(result.total)} − {money(result.billed)}.{" "}
                    {sign(result.variance) > 0 ? "Billed less than the provisional share." : sign(result.variance) < 0 ? "Billed more than the provisional share." : "Matches."}{" "}
                    <span className="text-muted">A potential discrepancy to verify, not a confirmed error.</span>
                  </p>
                ) : <p className="text-sm text-muted">Not computed.</p>}
              </Section>

              <details className="rounded-lg border border-line bg-surface">
                <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold">Full step log ({steps.length} steps)</summary>
                <Table>
                  <THead><TR><TH>Step</TH><TH>Formula</TH><TH>Inputs</TH><TH className="text-right">Result</TH></TR></THead>
                  <TBody>{steps.map((s, i) => (
                    <TR key={i}><TD className="whitespace-nowrap">{s.label}</TD><TD className="font-mono text-2xs">{s.formula}</TD>
                      <TD className="font-mono text-2xs text-ink-2">{Object.entries(s.inputs).map(([k, v]) => `${k}=${short(v)}`).join("  ")}</TD><TD className="num font-mono text-2xs">{short(s.result)}</TD></TR>
                  ))}</TBody>
                </Table>
              </details>
            </div>
          )}
        </SheetContent>
      )}
    </Dialog>
  );
}
