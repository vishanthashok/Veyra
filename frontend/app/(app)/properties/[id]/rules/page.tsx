"use client";
import { useState } from "react";
import { Empty, ErrorBox } from "@/components/common";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { api, type AllocationRule, type LeaseRule } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { money, pct } from "@/lib/utils";
import { useProperty } from "../context";

const blankPool: AllocationRule = {
  pool: "CAM", method: "pro_rata", denominator_sqft: null, fixed_pct: null, excluded_categories: [], base_year_amount: null,
  gross_up_enabled: false, gross_up_target: null, gross_up_actual: null, cap_kind: null, cap_pct: null, cap_prior_year: null,
};
type Draft = Omit<LeaseRule, "id" | "status" | "approved_at"> & { id?: string };
const blankRule: Draft = { ref: "", admin_fee_pct: null, admin_fee_pools: [], admin_fee_order: null, unsupported_terms: [], source_ref: "", notes: "", pools: [{ ...blankPool }] };

export default function Rules() {
  const { property } = useProperty();
  const pid = property.id;
  const rules = useLoad(() => api.get<LeaseRule[]>(`/properties/${pid}/lease-rules`), [pid]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(path: string, label: string) {
    const note = window.prompt(label);
    if (!note) return;
    try { await api.post(path, { note }); setErr(null); rules.reload(); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="space-y-6">
      <ErrorBox error={err} />
      <div className="rounded-md border bg-card px-4 py-3 text-sm text-muted-foreground">
        Supported in v0.1: pro-rata with a lease-defined denominator, fixed percentage, category exclusions, base year, gross-up of variable categories,
        non-cumulative caps on controllables, admin fees, partial-year proration. Anything else goes in <b>unsupported terms</b> and the tenant is flagged for manual review.
        Only <b>approved</b> rules are used in an audit.
      </div>
      <div className="flex justify-end"><Button onClick={() => setDraft(structuredClone(blankRule))}>New lease rule</Button></div>
      {draft && <RuleEditor pid={pid} draft={draft} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); rules.reload(); }} />}
      {(rules.data ?? []).length === 0 && <Empty>No lease rules. Import a lease-rule spreadsheet or create one.</Empty>}
      {(rules.data ?? []).map((r) => (
        <Card key={r.id}>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">{r.ref} <StatusBadge status={r.status} /></CardTitle>
              <CardDescription>Source: {r.source_ref || "not recorded"}{r.approved_at && ` · approved ${new Date(r.approved_at).toLocaleString()}`}</CardDescription>
            </div>
            <div className="flex gap-2">
              {r.status === "draft" ? <>
                <Button size="sm" variant="outline" onClick={() => setDraft(structuredClone(r))}>Edit</Button>
                <Button size="sm" onClick={() => act(`/lease-rules/${r.id}/approve`, "Approval note (what you checked against the lease)")}>Approve</Button>
              </> : <Button size="sm" variant="outline" onClick={() => act(`/lease-rules/${r.id}/unapprove`, "Reason for returning to draft")}>Return to draft</Button>}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <THead><TR><TH>Pool</TH><TH>Method</TH><TH className="num">Denominator sq ft</TH><TH className="num">Fixed %</TH><TH>Exclusions</TH><TH className="num">Base year</TH><TH>Gross-up</TH><TH>Cap</TH></TR></THead>
              <TBody>{r.pools.map((p) => (
                <TR key={p.pool}><TD>{p.pool}</TD><TD>{p.method}</TD><TD className="num">{p.denominator_sqft ?? "—"}</TD><TD className="num">{p.fixed_pct ? pct(p.fixed_pct) : "—"}</TD>
                  <TD>{p.excluded_categories.join(", ") || "—"}</TD><TD className="num">{p.base_year_amount ? money(p.base_year_amount) : "—"}</TD>
                  <TD>{p.gross_up_enabled ? `${pct(p.gross_up_target)} target, ${pct(p.gross_up_actual)} actual` : "—"}</TD>
                  <TD>{p.cap_kind ? `${p.cap_kind} ${pct(p.cap_pct)} on prior ${money(p.cap_prior_year)}` : "—"}</TD></TR>
              ))}</TBody>
            </Table>
            <div className="text-sm">
              Admin fee: {r.admin_fee_pct ? `${pct(r.admin_fee_pct)} on ${r.admin_fee_pools.join(", ")}${r.admin_fee_order ? `, ${r.admin_fee_order.replace("_", " ")}` : ""}` : "none"}
              {r.unsupported_terms.length > 0 && <div className="mt-1 text-destructive">Unsupported terms: {r.unsupported_terms.join("; ")}</div>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RuleEditor({ pid, draft, onClose, onSaved }: { pid: string; draft: Draft; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Draft>(draft);
  const [err, setErr] = useState<string | null>(null);
  const n = (v: string) => (v.trim() === "" ? null : v.trim());
  const setPool = (i: number, patch: Partial<AllocationRule>) => setD({ ...d, pools: d.pools.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...d, pools: d.pools.map((p) => { const copy = { ...p }; delete copy.id; return copy; }) };
    try {
      if (d.id) await api.put(`/lease-rules/${d.id}`, body); else await api.post(`/properties/${pid}/lease-rules`, body);
      onSaved();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>{d.id ? `Edit ${d.ref}` : "New lease rule"}</CardTitle></CardHeader>
      <CardContent>
        <ErrorBox error={err} />
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Label>Rule reference<Input value={d.ref} onChange={(e) => setD({ ...d, ref: e.target.value })} required /></Label>
            <Label>Lease source (page, section)<Input value={d.source_ref} onChange={(e) => setD({ ...d, source_ref: e.target.value })} /></Label>
            <Label>Admin fee (decimal, 0.10 = 10%)<Input value={d.admin_fee_pct ?? ""} onChange={(e) => setD({ ...d, admin_fee_pct: n(e.target.value) })} /></Label>
            <Label>Admin fee pools (comma separated)<Input value={d.admin_fee_pools.join(", ")} onChange={(e) => setD({ ...d, admin_fee_pools: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></Label>
            <Label>Admin fee order<Select value={d.admin_fee_order ?? ""} onChange={(e) => setD({ ...d, admin_fee_order: e.target.value || null })}>
              <option value="">Not stated</option><option value="after_cap">after cap</option><option value="before_cap">before cap</option></Select></Label>
            <Label className="md:col-span-3">Unsupported terms (one per line)<Textarea value={d.unsupported_terms.join("\n")} onChange={(e) => setD({ ...d, unsupported_terms: e.target.value.split("\n").filter((s) => s.trim()) })} /></Label>
          </div>
          {d.pools.map((p, i) => (
            <div key={i} className="grid gap-3 rounded-md border p-3 md:grid-cols-6">
              <Label>Pool<Input value={p.pool} onChange={(e) => setPool(i, { pool: e.target.value.toUpperCase() })} /></Label>
              <Label>Method<Select value={p.method} onChange={(e) => setPool(i, { method: e.target.value })}><option value="pro_rata">pro_rata</option><option value="fixed_pct">fixed_pct</option></Select></Label>
              <Label>Denominator sq ft<Input value={p.denominator_sqft ?? ""} onChange={(e) => setPool(i, { denominator_sqft: n(e.target.value) })} /></Label>
              <Label>Fixed % (decimal)<Input value={p.fixed_pct ?? ""} onChange={(e) => setPool(i, { fixed_pct: n(e.target.value) })} /></Label>
              <Label>Excluded categories<Input value={p.excluded_categories.join(", ")} onChange={(e) => setPool(i, { excluded_categories: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></Label>
              <Label>Base-year amount (full year)<Input value={p.base_year_amount ?? ""} onChange={(e) => setPool(i, { base_year_amount: n(e.target.value) })} /></Label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.gross_up_enabled} onChange={(e) => setPool(i, { gross_up_enabled: e.target.checked })} />Gross-up</label>
              <Label>Target occupancy<Input value={p.gross_up_target ?? ""} onChange={(e) => setPool(i, { gross_up_target: n(e.target.value) })} /></Label>
              <Label>Actual occupancy<Input value={p.gross_up_actual ?? ""} onChange={(e) => setPool(i, { gross_up_actual: n(e.target.value) })} /></Label>
              <Label>Cap type<Select value={p.cap_kind ?? ""} onChange={(e) => setPool(i, { cap_kind: e.target.value || null })}>
                <option value="">None</option><option value="noncumulative">noncumulative</option><option value="cumulative">cumulative (unsupported)</option><option value="cpi">CPI (unsupported)</option></Select></Label>
              <Label>Cap % (decimal)<Input value={p.cap_pct ?? ""} onChange={(e) => setPool(i, { cap_pct: n(e.target.value) })} /></Label>
              <Label>Prior-year controllable charge<Input value={p.cap_prior_year ?? ""} onChange={(e) => setPool(i, { cap_prior_year: n(e.target.value) })} /></Label>
              <div><Button type="button" size="sm" variant="ghost" onClick={() => setD({ ...d, pools: d.pools.filter((_, j) => j !== i) })}>Remove pool</Button></div>
            </div>
          ))}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setD({ ...d, pools: [...d.pools, { ...blankPool, pool: "" }] })}>Add pool</Button>
            <Button type="submit">Save draft</Button>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
