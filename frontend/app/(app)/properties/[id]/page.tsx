"use client";
import { CheckCircle2, Circle, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app/app-context";
import { PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { api, errorText, type Category, type DashboardRow } from "@/lib/api";
import { useLoad, useUnsavedChanges } from "@/lib/hooks";
import { fmtDate } from "@/lib/utils";
import { crumbs, useProperty } from "./context";

const STEPS: [string, string, string][] = [
  ["gl_imported", "Import the general ledger", "import"],
  ["billings_imported", "Import tenant CAM billings", "import"],
  ["accounts_reviewed", "Review every GL account", "mapping"],
  ["tenants_have_area", "Give every tenant a rentable area", "tenants"],
  ["tenants_have_approved_rules", "Approve a lease rule for every tenant", "rules"],
  ["audit_run", "Run the audit", "audit"],
  ["no_open_errors", "Clear or accept blocking errors", "exceptions"],
];

export default function Overview() {
  const ctx = useProperty();
  const { property, periods, reload, base } = ctx;
  const { reloadProperties } = useApp();
  const dash = useLoad(() => api.get<{ properties: DashboardRow[] }>("/dashboard"), [property.id]);
  const row = dash.data?.properties.find((p) => p.id === property.id);
  const cats = useLoad(() => api.get<Category[]>(`/properties/${property.id}/categories`), [property.id]);

  const initial = useMemo(() => ({ ...property, total_rsf: property.total_rsf ?? "" }), [property]);
  const [p, setP] = useState(initial);
  const dirty = JSON.stringify(p) !== JSON.stringify(initial);
  useUnsavedChanges(dirty);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [periodOpen, setPeriodOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/properties/${property.id}`, { ...p, total_rsf: p.total_rsf || null });
      toast.success("Property saved");
      setErr(null);
      reload();
      reloadProperties();
    } catch (x) { setErr(errorText(x)); } finally { setSaving(false); }
  }

  return (
    <>
      <PageHeader title={property.name} crumbs={crumbs(ctx)} description={property.address || undefined}
        meta={<StatusBadge status={property.reconciliation_status === "in_review" ? "in_review_status" : property.reconciliation_status} />} />

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel>
            <PanelHeader title="Reporting periods" description="An audit covers fiscal-year start through the through date."
              actions={<Button size="xs" onClick={() => setPeriodOpen(true)}><Plus />Add period</Button>} />
            {periods.length ? (
              <Table>
                <THead><TR><TH>Label</TH><TH>Fiscal year</TH><TH>Through</TH></TR></THead>
                <TBody>{periods.map((x) => <TR key={x.id}><TD className="font-medium">{x.label}</TD><TD>{fmtDate(x.fiscal_year_start)} – {fmtDate(x.fiscal_year_end)}</TD><TD>{fmtDate(x.through_date)}</TD></TR>)}</TBody>
              </Table>
            ) : <PanelBody className="text-sm text-muted">No periods yet. Add one before running an audit.</PanelBody>}
          </Panel>

          <Panel>
            <PanelHeader title="Expense categories and pools" description="Controllable categories are subject to caps. Variable categories are eligible for gross-up."
              actions={<Button size="xs" onClick={() => setCatOpen(true)}><Plus />Add category</Button>} />
            {cats.data?.length ? (
              <Table>
                <THead><TR><TH>Code</TH><TH>Name</TH><TH>Pool</TH><TH>Controllable</TH><TH>Variable</TH></TR></THead>
                <TBody>{cats.data.map((c) => <TR key={c.id}><TD className="font-mono text-xs">{c.code}</TD><TD>{c.name}</TD><TD>{c.pool}</TD><TD>{c.controllable ? "Yes" : "No"}</TD><TD>{c.variable ? "Yes" : "No"}</TD></TR>)}</TBody>
              </Table>
            ) : <PanelBody className="text-sm text-muted">No categories yet.</PanelBody>}
          </Panel>

          <Panel>
            <PanelHeader title="Property details" />
            <PanelBody>
              <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={save}>
                <Field label="Name" required><Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
                <Field label="Type"><Select value={p.property_type} onChange={(e) => setP({ ...p, property_type: e.target.value })}>
                  {["retail", "office", "industrial", "mixed", "other"].map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</Select></Field>
                <Field label="Address"><Input value={p.address} onChange={(e) => setP({ ...p, address: e.target.value })} /></Field>
                <Field label="Total rentable sq ft" hint="Informational only"><Input inputMode="decimal" value={p.total_rsf} onChange={(e) => setP({ ...p, total_rsf: e.target.value })} /></Field>
                <Field label="Fiscal year-end month"><Select value={p.fiscal_year_end_month} onChange={(e) => setP({ ...p, fiscal_year_end_month: Number(e.target.value) })}>
                  {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Date(2026, i, 1).toLocaleString("en-US", { month: "long" })}</option>)}</Select></Field>
                <Field label="Reconciliation status"><Select value={p.reconciliation_status} onChange={(e) => setP({ ...p, reconciliation_status: e.target.value })}>
                  {[["not_started", "Not started"], ["data_collection", "Data collection"], ["in_review", "In review"], ["ready", "Ready"], ["final", "Final"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
                {err && <p role="alert" className="text-sm text-error sm:col-span-2 lg:col-span-3">{err}</p>}
                <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
                  <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>Save changes</Button>
                  {dirty && <><Button type="button" variant="ghost" onClick={() => setP(initial)}>Discard</Button><span className="text-xs text-warning">Unsaved changes</span></>}
                </div>
              </form>
            </PanelBody>
          </Panel>
        </div>

        <Panel className="h-fit">
          <PanelHeader title="Audit readiness" description={row ? `${row.completeness}% of checks pass` : "Loading"} />
          <ol className="divide-y divide-line">
            {STEPS.map(([k, label, slug], i) => {
              const ok = row?.checks[k];
              return (
                <li key={k}>
                  <Link href={`${base}/${slug}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2">
                    {ok ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <Circle className="size-4 text-subtle" aria-hidden />}
                    <span className={ok ? "text-muted line-through decoration-line-strong" : "text-ink"}>{i + 1}. {label}</span>
                    <span className="sr-only">{ok ? "done" : "to do"}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </Panel>
      </div>

      <PeriodDialog open={periodOpen} onOpenChange={setPeriodOpen} pid={property.id} onDone={reload} />
      <CategoryDialog open={catOpen} onOpenChange={setCatOpen} pid={property.id} onDone={cats.reload} />
    </>
  );
}

function PeriodDialog({ open, onOpenChange, pid, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; pid: string; onDone: () => void }) {
  const [f, setF] = useState({ label: "", fiscal_year_start: "", fiscal_year_end: "", through_date: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add reporting period" description="The through date sets the end of the year-to-date window.">
        <form className="grid grid-cols-2 gap-3" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true);
          try { await api.post(`/properties/${pid}/periods`, f); toast.success("Period added"); onDone(); onOpenChange(false); setErr(null); }
          catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
        }}>
          <Field label="Label" className="col-span-2" required hint="For example: FY2026 YTD Sep"><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} autoFocus /></Field>
          <Field label="Fiscal year start" required><Input type="date" value={f.fiscal_year_start} onChange={(e) => setF({ ...f, fiscal_year_start: e.target.value })} /></Field>
          <Field label="Fiscal year end" required><Input type="date" value={f.fiscal_year_end} onChange={(e) => setF({ ...f, fiscal_year_end: e.target.value })} /></Field>
          <Field label="Through date" className="col-span-2" required><Input type="date" value={f.through_date} onChange={(e) => setF({ ...f, through_date: e.target.value })} /></Field>
          {err && <p role="alert" className="col-span-2 text-sm text-error">{err}</p>}
          <div className="col-span-2 flex justify-end gap-2"><Button type="button" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>Add period</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CategoryDialog({ open, onOpenChange, pid, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; pid: string; onDone: () => void }) {
  const [c, setC] = useState({ code: "", name: "", pool: "CAM", controllable: false, variable: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add expense category">
        <form className="grid grid-cols-2 gap-3" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true);
          try { await api.post(`/properties/${pid}/categories`, c); toast.success(`Category ${c.code} added`); onDone(); onOpenChange(false); setErr(null); setC({ code: "", name: "", pool: "CAM", controllable: false, variable: false }); }
          catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
        }}>
          <Field label="Code" required><Input value={c.code} onChange={(e) => setC({ ...c, code: e.target.value.toUpperCase() })} autoFocus /></Field>
          <Field label="Pool" required hint="CAM, TAX, INS ..."><Input value={c.pool} onChange={(e) => setC({ ...c, pool: e.target.value.toUpperCase() })} /></Field>
          <Field label="Name" className="col-span-2" required><Input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--accent)]" checked={c.controllable} onChange={(e) => setC({ ...c, controllable: e.target.checked })} />Controllable (subject to caps)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--accent)]" checked={c.variable} onChange={(e) => setC({ ...c, variable: e.target.checked })} />Variable (eligible for gross-up)</label>
          {err && <p role="alert" className="col-span-2 text-sm text-error">{err}</p>}
          <div className="col-span-2 flex justify-end gap-2"><Button type="button" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>Add category</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
