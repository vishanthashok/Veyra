"use client";
import Link from "next/link";
import { useState } from "react";
import { ErrorBox, PageHeader } from "@/components/common";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { api, type Property } from "@/lib/api";
import { useLoad } from "@/lib/hooks";

export default function Properties() {
  const { data, error, reload } = useLoad(() => api.get<Property[]>("/properties"), []);
  const [form, setForm] = useState({ name: "", property_type: "retail", address: "", total_rsf: "", fiscal_year_end_month: "12" });
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post("/properties", { ...form, total_rsf: form.total_rsf || null, fiscal_year_end_month: Number(form.fiscal_year_end_month) });
      setForm({ name: "", property_type: "retail", address: "", total_rsf: "", fiscal_year_end_month: "12" });
      setErr(null);
      reload();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <>
      <PageHeader title="Properties" />
      <ErrorBox error={error || err} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-0">
            <Table>
              <THead><TR><TH>Name</TH><TH>Type</TH><TH>Address</TH><TH className="num">Total RSF</TH><TH>FY end</TH><TH>Status</TH></TR></THead>
              <TBody>
                {(data ?? []).map((p) => (
                  <TR key={p.id}>
                    <TD><Link className="font-medium hover:underline" href={`/properties/${p.id}`}>{p.name}</Link></TD>
                    <TD>{p.property_type}</TD><TD>{p.address}</TD><TD className="num">{p.total_rsf ?? "—"}</TD>
                    <TD>Month {p.fiscal_year_end_month}</TD><TD><StatusBadge status={p.reconciliation_status} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>New property</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={create} className="flex flex-col gap-3">
              <Label>Name<Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Label>
              <Label>Type<Select value={form.property_type} onChange={(e) => setForm({ ...form, property_type: e.target.value })}>
                {["retail", "office", "industrial", "mixed", "other"].map((t) => <option key={t}>{t}</option>)}
              </Select></Label>
              <Label>Address<Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Label>
              <Label>Total rentable sq ft<Input inputMode="decimal" value={form.total_rsf} onChange={(e) => setForm({ ...form, total_rsf: e.target.value })} /></Label>
              <Label>Fiscal year-end month<Input type="number" min={1} max={12} value={form.fiscal_year_end_month} onChange={(e) => setForm({ ...form, fiscal_year_end_month: e.target.value })} /></Label>
              <Button type="submit">Create property</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
