"use client";
import { useState } from "react";
import { Empty, ErrorBox } from "@/components/common";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { api, type LeaseRule, type Tenant } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { useProperty } from "../context";

const blank = { name: "", suite: "", rentable_area: "", lease_start: "", lease_end: "", allocation_method: "pro_rata", lease_rule_id: "" };

export default function Tenants() {
  const { property } = useProperty();
  const pid = property.id;
  const t = useLoad(() => api.get<Tenant[]>(`/properties/${pid}/tenants`), [pid]);
  const rules = useLoad(() => api.get<LeaseRule[]>(`/properties/${pid}/lease-rules`), [pid]);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ruleById = Object.fromEntries((rules.data ?? []).map((r) => [r.id, r]));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...form, rentable_area: form.rentable_area || null, lease_start: form.lease_start || null, lease_end: form.lease_end || null, lease_rule_id: form.lease_rule_id || null };
    try {
      if (editing) await api.put(`/tenants/${editing}`, body); else await api.post(`/properties/${pid}/tenants`, body);
      setForm(blank); setEditing(null); setErr(null); t.reload();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardContent className="p-0">
          {t.data?.length ? (
            <Table>
              <THead><TR><TH>Suite</TH><TH>Tenant</TH><TH className="num">Rentable area</TH><TH>Lease term</TH><TH>Method</TH><TH>Lease rule</TH><TH /></TR></THead>
              <TBody>
                {t.data.map((x) => {
                  const r = x.lease_rule_id ? ruleById[x.lease_rule_id] : null;
                  return (
                    <TR key={x.id}>
                      <TD>{x.suite}</TD><TD className="font-medium">{x.name}</TD>
                      <TD className="num">{x.rentable_area ?? <StatusBadge status="needs_review" />}</TD>
                      <TD className="whitespace-nowrap">{x.lease_start ?? "?"} to {x.lease_end ?? "open"}</TD>
                      <TD>{x.allocation_method}</TD>
                      <TD>{r ? <span className="space-x-2"><span>{r.ref}</span><StatusBadge status={r.status} /></span> : <StatusBadge status="unresolved" />}</TD>
                      <TD><Button size="sm" variant="ghost" onClick={() => { setEditing(x.id); setForm({ name: x.name, suite: x.suite, rentable_area: x.rentable_area ?? "", lease_start: x.lease_start ?? "", lease_end: x.lease_end ?? "", allocation_method: x.allocation_method, lease_rule_id: x.lease_rule_id ?? "" }); }}>Edit</Button></TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          ) : <div className="p-5"><Empty>No tenants yet.</Empty></div>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{editing ? "Edit tenant" : "Add tenant"}</CardTitle></CardHeader>
        <CardContent>
          <ErrorBox error={err} />
          <form onSubmit={save} className="flex flex-col gap-3">
            <Label>Tenant name<Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Label>
            <Label>Suite<Input value={form.suite} onChange={(e) => setForm({ ...form, suite: e.target.value })} /></Label>
            <Label>Rentable area (sq ft)<Input inputMode="decimal" value={form.rentable_area} onChange={(e) => setForm({ ...form, rentable_area: e.target.value })} placeholder="Leave blank if unknown" /></Label>
            <div className="grid grid-cols-2 gap-3">
              <Label>Lease start<Input type="date" value={form.lease_start} onChange={(e) => setForm({ ...form, lease_start: e.target.value })} /></Label>
              <Label>Lease end<Input type="date" value={form.lease_end} onChange={(e) => setForm({ ...form, lease_end: e.target.value })} /></Label>
            </div>
            <Label>Allocation method<Select value={form.allocation_method} onChange={(e) => setForm({ ...form, allocation_method: e.target.value })}><option value="pro_rata">pro_rata</option><option value="fixed_pct">fixed_pct</option></Select></Label>
            <Label>Lease rule<Select value={form.lease_rule_id} onChange={(e) => setForm({ ...form, lease_rule_id: e.target.value })}>
              <option value="">None</option>{(rules.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.ref} ({r.status})</option>)}</Select></Label>
            <div className="flex gap-2"><Button type="submit">{editing ? "Save" : "Add tenant"}</Button>{editing && <Button type="button" variant="outline" onClick={() => { setEditing(null); setForm(blank); }}>Cancel</Button>}</div>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">The allocation method shown here is descriptive. Calculations use the approved lease rule.</p>
        </CardContent>
      </Card>
    </div>
  );
}
