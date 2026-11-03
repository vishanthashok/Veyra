"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/note-dialog";
import { EmptyState, ErrorBox, PageHeader } from "@/components/app/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { api, errorText, type LeaseRule, type Tenant } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { fmtDate } from "@/lib/utils";
import { crumbs, useProperty } from "../context";

const blank = { name: "", suite: "", rentable_area: "", lease_start: "", lease_end: "", allocation_method: "pro_rata", lease_rule_id: "" };
type Form = typeof blank;

export default function Tenants() {
  const ctx = useProperty();
  const pid = ctx.property.id;
  const t = useLoad(() => api.get<Tenant[]>(`/properties/${pid}/tenants`), [pid]);
  const rules = useLoad(() => api.get<LeaseRule[]>(`/properties/${pid}/lease-rules`), [pid]);
  const ruleById = useMemo(() => Object.fromEntries((rules.data ?? []).map((r) => [r.id, r])), [rules.data]);
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);
  const [deleting, setDeleting] = useState<Tenant | null>(null);

  const columns = useMemo<ColumnDef<Tenant, unknown>[]>(() => [
    { accessorKey: "suite", header: "Suite", meta: { cellClassName: "w-16 tabular" } },
    { accessorKey: "name", header: "Tenant", cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    { accessorKey: "rentable_area", header: "Rentable sq ft", meta: { align: "right" },
      cell: ({ getValue }) => (getValue() as string | null) ? (getValue() as string).replace(/\.00$/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",") : <Badge tone="error">Missing</Badge> },
    { id: "term", header: "Lease term", accessorFn: (r) => r.lease_start ?? "", cell: ({ row }) => <span className="whitespace-nowrap text-ink-2">{fmtDate(row.original.lease_start)} – {row.original.lease_end ? fmtDate(row.original.lease_end) : "open"}</span> },
    { id: "rule", header: "Lease rule", accessorFn: (r) => (r.lease_rule_id ? ruleById[r.lease_rule_id]?.status ?? "" : "none"),
      cell: ({ row }) => {
        const r = row.original.lease_rule_id ? ruleById[row.original.lease_rule_id] : null;
        return r ? <span className="flex items-center gap-2"><span className="font-mono text-xs">{r.ref}</span><StatusBadge status={r.status} /></span> : <Badge tone="error">No rule</Badge>;
      } },
    { id: "actions", header: "", enableSorting: false, enableHiding: false, meta: { align: "right" },
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button size="xs" variant="ghost" aria-label={`Edit ${row.original.name}`} onClick={(e) => { e.stopPropagation(); setEditing({ id: row.original.id, form: {
            name: row.original.name, suite: row.original.suite, rentable_area: row.original.rentable_area ?? "", lease_start: row.original.lease_start ?? "",
            lease_end: row.original.lease_end ?? "", allocation_method: row.original.allocation_method, lease_rule_id: row.original.lease_rule_id ?? "" } }); }}><Pencil /></Button>
          <Button size="xs" variant="ghost" aria-label={`Delete ${row.original.name}`} onClick={(e) => { e.stopPropagation(); setDeleting(row.original); }}><Trash2 /></Button>
        </div>
      ) },
  ], [ruleById]);

  return (
    <>
      <PageHeader title="Tenants" crumbs={crumbs(ctx, "Tenants")} description="Rentable area and lease dates drive allocation and proration. Calculations use the approved lease rule."
        actions={<Button variant="primary" onClick={() => setEditing({ id: null, form: blank })}><Plus />Add tenant</Button>} />
      <ErrorBox error={t.error} />
      <Panel>
        {t.data && t.data.length === 0 ? (
          <EmptyState icon={Users} title="No tenants yet" action={<Button variant="primary" onClick={() => setEditing({ id: null, form: blank })}><Plus />Add tenant</Button>}>Add each tenant with suite, rentable area and lease dates.</EmptyState>
        ) : (
          <DataTable caption="Tenants" data={t.data ?? []} columns={columns} getRowId={(r) => r.id} loading={t.loading} searchPlaceholder="Search tenants"
            exportName="veyra-tenants" initialSorting={[{ id: "suite", desc: false }]} />
        )}
      </Panel>
      {editing && (
        <TenantDialog key={editing.id ?? "new"} pid={pid} id={editing.id} initial={editing.form} rules={rules.data ?? []}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); t.reload(); }} />
      )}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} danger confirm="Delete tenant"
        title={`Delete ${deleting?.name}?`} description="Only tenants with no billings and no audit history can be deleted. This cannot be undone."
        onConfirm={async () => { await api.del(`/tenants/${deleting!.id}`); toast.success("Tenant deleted"); t.reload(); }} />
    </>
  );
}

function TenantDialog({ pid, id, initial, rules, onClose, onSaved }: { pid: string; id: string | null; initial: Form; rules: LeaseRule[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { ...f, rentable_area: f.rentable_area || null, lease_start: f.lease_start || null, lease_end: f.lease_end || null, lease_rule_id: f.lease_rule_id || null };
    try {
      if (id) await api.put(`/tenants/${id}`, body); else await api.post(`/properties/${pid}/tenants`, body);
      toast.success(id ? "Tenant saved" : "Tenant added");
      onSaved();
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={id ? "Edit tenant" : "Add tenant"}>
        <form onSubmit={save} className="grid grid-cols-2 gap-3">
          <Field label="Tenant name" className="col-span-2" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
          <Field label="Suite"><Input value={f.suite} onChange={(e) => setF({ ...f, suite: e.target.value })} /></Field>
          <Field label="Rentable sq ft" hint="Leave blank if unknown. The audit will flag it."><Input inputMode="decimal" value={f.rentable_area} onChange={(e) => setF({ ...f, rentable_area: e.target.value })} /></Field>
          <Field label="Lease start"><Input type="date" value={f.lease_start} onChange={(e) => setF({ ...f, lease_start: e.target.value })} /></Field>
          <Field label="Lease end"><Input type="date" value={f.lease_end} onChange={(e) => setF({ ...f, lease_end: e.target.value })} /></Field>
          <Field label="Lease rule" className="col-span-2" hint="Only approved rules are used in audits.">
            <Select value={f.lease_rule_id} onChange={(e) => setF({ ...f, lease_rule_id: e.target.value })}>
              <option value="">None</option>{rules.map((r) => <option key={r.id} value={r.id}>{r.ref} ({r.status})</option>)}
            </Select>
          </Field>
          {err && <p role="alert" className="col-span-2 text-sm text-error">{err}</p>}
          <div className="col-span-2 flex justify-end gap-2"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>{id ? "Save tenant" : "Add tenant"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
