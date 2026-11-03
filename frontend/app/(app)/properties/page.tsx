"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app/app-context";
import { EmptyState, PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { api, errorText, type Property } from "@/lib/api";

const blank = { name: "", property_type: "retail", address: "", total_rsf: "", fiscal_year_end_month: "12" };

function NewPropertyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { reloadProperties } = useApp();
  const [form, setForm] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await api.post<Property>("/properties", {
        ...form,
        total_rsf: form.total_rsf || null,
        fiscal_year_end_month: Number(form.fiscal_year_end_month),
      });
      reloadProperties();
      toast.success(`${p.name} created`);
      onOpenChange(false);
      router.push(`/properties/${p.id}`);
    } catch (x) {
      setErr(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setErr(null);
        onOpenChange(o);
      }}
    >
      <DialogContent title="New property" description="You can import data after the property exists.">
        <form onSubmit={create} className="grid grid-cols-2 gap-3">
          <Field label="Name" className="col-span-2" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <Field label="Type">
            <Select value={form.property_type} onChange={(e) => setForm({ ...form, property_type: e.target.value })}>
              {["retail", "office", "industrial", "mixed", "other"].map((t) => (
                <option key={t} value={t}>
                  {t[0].toUpperCase() + t.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fiscal year-end month">
            <Select value={form.fiscal_year_end_month} onChange={(e) => setForm({ ...form, fiscal_year_end_month: e.target.value })}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {new Date(2026, i, 1).toLocaleString("en-US", { month: "long" })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Address" className="col-span-2">
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <Field label="Total rentable sq ft" hint="Informational. Allocations use each lease's denominator.">
            <Input inputMode="decimal" value={form.total_rsf} onChange={(e) => setForm({ ...form, total_rsf: e.target.value })} />
          </Field>
          {err && (
            <p role="alert" className="col-span-2 text-sm text-error">
              {err}
            </p>
          )}
          <div className="col-span-2 flex justify-end gap-2 pt-1">
            <Button type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Create property
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PropertiesInner() {
  const { properties } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(params.get("new") === "1");
  const columns = useMemo<ColumnDef<Property, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <Link className="font-medium hover:text-accent hover:underline" href={`/properties/${row.original.id}`}>
            {row.original.name}
          </Link>
        ),
      },
      { accessorKey: "property_type", header: "Type", cell: ({ getValue }) => <span className="capitalize">{getValue() as string}</span> },
      {
        accessorKey: "address",
        header: "Address",
        cell: ({ getValue }) => <span className="text-ink-2">{(getValue() as string) || "—"}</span>,
      },
      {
        accessorKey: "total_rsf",
        header: "Total RSF",
        meta: { align: "right" },
        cell: ({ getValue }) => (getValue() as string | null)?.replace(/\.00$/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",") ?? "—",
      },
      {
        accessorKey: "fiscal_year_end_month",
        header: "FY end",
        cell: ({ getValue }) => new Date(2026, (getValue() as number) - 1, 1).toLocaleString("en-US", { month: "short" }),
      },
      {
        accessorKey: "reconciliation_status",
        header: "Status",
        cell: ({ getValue }) => (
          <StatusBadge status={(getValue() as string) === "in_review" ? "in_review_status" : (getValue() as string)} />
        ),
      },
    ],
    [],
  );
  return (
    <>
      <PageHeader
        title="Properties"
        crumbs={[{ label: "Properties" }]}
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            <Plus />
            New property
          </Button>
        }
      />
      <Panel>
        {properties.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No properties yet"
            action={
              <Button variant="primary" onClick={() => setOpen(true)}>
                <Plus />
                New property
              </Button>
            }
          >
            Create one to start an audit.
          </EmptyState>
        ) : (
          <DataTable
            caption="Properties"
            data={properties}
            columns={columns}
            getRowId={(r) => r.id}
            onRowClick={(r) => router.push(`/properties/${r.id}`)}
            facets={[{ columnId: "property_type", label: "Type" }]}
            exportName="veyra-properties"
          />
        )}
      </Panel>
      <NewPropertyDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o && params.get("new")) router.replace("/properties");
        }}
      />
    </>
  );
}

export default function PropertiesPage() {
  return (
    <Suspense>
      <PropertiesInner />
    </Suspense>
  );
}
