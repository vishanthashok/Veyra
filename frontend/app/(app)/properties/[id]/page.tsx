"use client";
import { useState } from "react";
import { Empty, ErrorBox } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { api, type Category } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { useProperty } from "./context";

export default function Overview() {
  const { property, periods, reload } = useProperty();
  const cats = useLoad(() => api.get<Category[]>(`/properties/${property.id}/categories`), [property.id]);
  const [p, setP] = useState({ ...property, total_rsf: property.total_rsf ?? "" });
  const [per, setPer] = useState({ label: "", fiscal_year_start: "", fiscal_year_end: "", through_date: "" });
  const [cat, setCat] = useState({ code: "", name: "", pool: "CAM", controllable: false, variable: false });
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); setErr(null); return true; } catch (e) { setErr((e as Error).message); return false; }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <ErrorBox error={err} />
      <Card className="xl:col-span-2">
        <CardHeader><CardTitle>Property details</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-3" onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api.put(`/properties/${property.id}`, { ...p, total_rsf: p.total_rsf || null }))) { setSaved(true); reload(); }
          }}>
            <Label>Name<Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Label>
            <Label>Type<Select value={p.property_type} onChange={(e) => setP({ ...p, property_type: e.target.value })}>
              {["retail", "office", "industrial", "mixed", "other"].map((t) => <option key={t}>{t}</option>)}</Select></Label>
            <Label>Address<Input value={p.address} onChange={(e) => setP({ ...p, address: e.target.value })} /></Label>
            <Label>Total rentable sq ft<Input value={p.total_rsf} onChange={(e) => setP({ ...p, total_rsf: e.target.value })} /></Label>
            <Label>Fiscal year-end month<Input type="number" min={1} max={12} value={p.fiscal_year_end_month} onChange={(e) => setP({ ...p, fiscal_year_end_month: Number(e.target.value) })} /></Label>
            <Label>Reconciliation status<Select value={p.reconciliation_status} onChange={(e) => setP({ ...p, reconciliation_status: e.target.value })}>
              {["not_started", "data_collection", "in_review", "ready", "final"].map((t) => <option key={t}>{t}</option>)}</Select></Label>
            <div className="flex items-center gap-3"><Button type="submit">Save</Button>{saved && <span className="text-xs text-muted-foreground">Saved</span>}</div>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">Total RSF is informational. Allocations use the denominator stated in each lease rule.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Reporting periods</CardTitle><CardDescription>An audit covers fiscal-year start through the &quot;through&quot; date.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {periods.length ? (
            <Table><THead><TR><TH>Label</TH><TH>Fiscal year</TH><TH>Through</TH></TR></THead>
              <TBody>{periods.map((x) => <TR key={x.id}><TD>{x.label}</TD><TD>{x.fiscal_year_start} to {x.fiscal_year_end}</TD><TD>{x.through_date}</TD></TR>)}</TBody></Table>
          ) : <Empty>No periods yet.</Empty>}
          <form className="grid grid-cols-2 gap-3" onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api.post(`/properties/${property.id}/periods`, per))) { setPer({ label: "", fiscal_year_start: "", fiscal_year_end: "", through_date: "" }); reload(); }
          }}>
            <Label>Label<Input value={per.label} onChange={(e) => setPer({ ...per, label: e.target.value })} placeholder="FY2026 YTD Sep" required /></Label>
            <Label>Fiscal year start<Input type="date" value={per.fiscal_year_start} onChange={(e) => setPer({ ...per, fiscal_year_start: e.target.value })} required /></Label>
            <Label>Fiscal year end<Input type="date" value={per.fiscal_year_end} onChange={(e) => setPer({ ...per, fiscal_year_end: e.target.value })} required /></Label>
            <Label>Through date<Input type="date" value={per.through_date} onChange={(e) => setPer({ ...per, through_date: e.target.value })} required /></Label>
            <Button type="submit" className="col-span-2">Add period</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Expense categories and pools</CardTitle><CardDescription>Controllable categories are subject to caps. Variable categories are eligible for gross-up.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {cats.data?.length ? (
            <Table><THead><TR><TH>Code</TH><TH>Name</TH><TH>Pool</TH><TH>Controllable</TH><TH>Variable</TH></TR></THead>
              <TBody>{cats.data.map((c) => <TR key={c.id}><TD className="font-mono text-xs">{c.code}</TD><TD>{c.name}</TD><TD>{c.pool}</TD><TD>{c.controllable ? "Yes" : "No"}</TD><TD>{c.variable ? "Yes" : "No"}</TD></TR>)}</TBody></Table>
          ) : <Empty>No categories yet.</Empty>}
          <form className="grid grid-cols-3 gap-3" onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api.post(`/properties/${property.id}/categories`, cat))) { setCat({ code: "", name: "", pool: "CAM", controllable: false, variable: false }); cats.reload(); }
          }}>
            <Label>Code<Input value={cat.code} onChange={(e) => setCat({ ...cat, code: e.target.value.toUpperCase() })} required /></Label>
            <Label>Name<Input value={cat.name} onChange={(e) => setCat({ ...cat, name: e.target.value })} required /></Label>
            <Label>Pool<Input value={cat.pool} onChange={(e) => setCat({ ...cat, pool: e.target.value.toUpperCase() })} required /></Label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cat.controllable} onChange={(e) => setCat({ ...cat, controllable: e.target.checked })} />Controllable</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cat.variable} onChange={(e) => setCat({ ...cat, variable: e.target.checked })} />Variable</label>
            <Button type="submit">Add category</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
