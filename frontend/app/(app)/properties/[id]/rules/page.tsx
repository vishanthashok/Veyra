"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertOctagon, BookOpenCheck, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useNoteDialog } from "@/components/app/note-dialog";
import { EmptyState, ErrorBox, KeyValue, PageHeader } from "@/components/app/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { api, errorText, type AllocationRule, type LeaseRule } from "@/lib/api";
import { useLoad, useUnsavedChanges } from "@/lib/hooks";
import { fmtDateTime, money, pct } from "@/lib/utils";
import { crumbs, useProperty } from "../context";

const blankPool: AllocationRule = {
  pool: "CAM",
  method: "pro_rata",
  denominator_sqft: null,
  fixed_pct: null,
  excluded_categories: [],
  base_year_amount: null,
  gross_up_enabled: false,
  gross_up_target: null,
  gross_up_actual: null,
  cap_kind: null,
  cap_pct: null,
  cap_prior_year: null,
};
type Draft = Omit<LeaseRule, "id" | "status" | "approved_at" | "version" | "approved_by_name" | "tenants"> & { id?: string };
const blankRule: Draft = {
  ref: "",
  admin_fee_pct: null,
  admin_fee_pools: [],
  admin_fee_order: null,
  unsupported_terms: [],
  source_ref: "",
  notes: "",
  pools: [{ ...blankPool }],
};

function isUnsupported(r: LeaseRule) {
  return (
    r.unsupported_terms.length > 0 ||
    r.pools.some((p) => p.cap_kind && p.cap_kind !== "noncumulative") ||
    r.pools.some((p) => p.cap_kind && p.base_year_amount)
  );
}

export default function Rules() {
  const ctx = useProperty();
  const pid = ctx.property.id;
  const rules = useLoad(() => api.get<LeaseRule[]>(`/properties/${pid}/lease-rules`), [pid]);
  const rows = useMemo(() => rules.data ?? [], [rules.data]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [approving, setApproving] = useState<LeaseRule | null>(null);
  const { ask, dialog } = useNoteDialog();
  const current = rows.find((r) => r.id === selected) ?? null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!selected && rows.length) setSelected((rows.find((r) => r.status === "draft") ?? rows[0]).id);
  }, [rows, selected]);

  const columns = useMemo<ColumnDef<LeaseRule, unknown>[]>(
    () => [
      {
        accessorKey: "ref",
        header: "Rule",
        cell: ({ row }) => (
          <div>
            <div className="flex items-center gap-1.5 whitespace-nowrap font-mono text-xs font-medium">
              {row.original.ref} <span className="text-muted">v{row.original.version}</span>
              {isUnsupported(row.original) && (
                <Badge tone="error" className="font-sans">
                  <AlertOctagon className="size-3" />
                  Unsupported
                </Badge>
              )}
            </div>
            <div className="max-w-52 truncate text-2xs text-muted">{row.original.tenants.join(", ") || "No tenant linked"}</div>
          </div>
        ),
      },
      {
        id: "pools",
        header: "Pools",
        accessorFn: (r) => r.pools.map((p) => p.pool).join(", "),
        meta: { cellClassName: "whitespace-nowrap text-xs text-ink-2" },
      },
      { accessorKey: "status", header: "Status", cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    ],
    [],
  );

  const drafts = rows.filter((r) => r.status === "draft").length;

  return (
    <>
      <PageHeader
        title="Lease rules"
        crumbs={crumbs(ctx, "Lease rules")}
        description="Structured terms a person checked against the lease. Only approved rules are used. Terms the engine cannot compute are flagged, never guessed."
        meta={
          drafts ? (
            <Badge tone="warning">
              {drafts} draft{drafts > 1 ? "s" : ""} to review
            </Badge>
          ) : rows.length ? (
            <Badge tone="success">All approved</Badge>
          ) : null
        }
        actions={
          <Button variant="primary" onClick={() => setEditing(structuredClone(blankRule))}>
            <Plus />
            New rule
          </Button>
        }
      />
      <ErrorBox error={rules.error} />
      {rows.length === 0 && !rules.loading ? (
        <Panel>
          <EmptyState
            icon={BookOpenCheck}
            title="No lease rules"
            action={
              <Button variant="primary" onClick={() => setEditing(structuredClone(blankRule))}>
                <Plus />
                New rule
              </Button>
            }
          >
            Import a lease-rule spreadsheet or create rules here.
          </EmptyState>
        </Panel>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(340px,420px)_1fr]">
          <Panel>
            <DataTable
              caption="Lease rules"
              data={rows}
              columns={columns}
              getRowId={(r) => r.id}
              loading={rules.loading}
              onRowClick={(r) => setSelected(r.id)}
              activeRowId={selected}
              compact
              hideColumnsMenu
              searchPlaceholder="Search rules or tenants"
              facets={[
                {
                  columnId: "status",
                  label: "Status",
                  options: [
                    { value: "draft", label: "Draft" },
                    { value: "approved", label: "Approved" },
                  ],
                },
              ]}
            />
          </Panel>
          {current && (
            <Panel>
              <PanelHeader
                title={
                  <span className="flex items-center gap-2">
                    <span className="font-mono">{current.ref}</span>
                    <span className="text-xs font-normal text-muted">version {current.version}</span>
                  </span>
                }
                description={
                  current.tenants.length
                    ? `Applies to ${current.tenants.join(", ")}`
                    : "Not linked to a tenant yet. Link it on the Tenants page."
                }
                actions={
                  current.status === "draft" ? (
                    <>
                      <Button onClick={() => setEditing(structuredClone(current))}>Edit</Button>
                      <Button variant="primary" onClick={() => setApproving(current)}>
                        <ShieldCheck />
                        Review and approve
                      </Button>
                    </>
                  ) : (
                    <>
                      <StatusBadge status="approved" />
                      <Button
                        onClick={() =>
                          ask({
                            title: `Return ${current.ref} to draft`,
                            description:
                              "The rule stops being used in new audits until approved again. Past audit runs keep the version they used.",
                            confirm: "Return to draft",
                            onSubmit: async (note) => {
                              await api.post(`/lease-rules/${current.id}/unapprove`, { note });
                              toast.success("Returned to draft");
                              rules.reload();
                            },
                          })
                        }
                      >
                        Return to draft
                      </Button>
                    </>
                  )
                }
              />
              <PanelBody className="space-y-5">
                {isUnsupported(current) && (
                  <div role="alert" className="flex gap-2 rounded-md border border-error-line bg-error-bg px-3 py-2 text-sm text-error">
                    <AlertOctagon className="mt-0.5 size-4 shrink-0" />
                    <div>
                      <b>Contains terms the engine cannot compute.</b> Tenants on this rule will be unresolved and need manual review.
                      <ul className="mt-1 list-disc pl-5">
                        {current.unsupported_terms.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                        {current.pools
                          .filter((p) => p.cap_kind && p.cap_kind !== "noncumulative")
                          .map((p) => (
                            <li key={p.pool}>
                              {p.pool}: {p.cap_kind} cap
                            </li>
                          ))}
                        {current.pools
                          .filter((p) => p.cap_kind && p.base_year_amount)
                          .map((p) => (
                            <li key={p.pool + "by"}>{p.pool}: base year combined with a cap</li>
                          ))}
                      </ul>
                    </div>
                  </div>
                )}
                <KeyValue
                  items={[
                    ["Lease source", current.source_ref || <span className="text-warning">Not recorded</span>],
                    [
                      "Admin fee",
                      current.admin_fee_pct ? (
                        <>
                          {pct(current.admin_fee_pct, 2)} on{" "}
                          {current.admin_fee_pools.join(", ") || <span className="text-error">no pools</span>}
                          {current.admin_fee_order ? `, ${current.admin_fee_order.replace("_", " ")}` : ""}
                        </>
                      ) : (
                        "None"
                      ),
                    ],
                    [
                      "Approval",
                      current.approved_at ? (
                        `${current.approved_by_name ?? "Unknown"}, ${fmtDateTime(current.approved_at)}`
                      ) : (
                        <span className="text-warning">Not approved</span>
                      ),
                    ],
                    ["Notes", current.notes || "—"],
                  ]}
                />
                <div className="overflow-hidden rounded-md border border-line">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Pool</TH>
                        <TH>Method</TH>
                        <TH className="text-right">Basis</TH>
                        <TH>Exclusions</TH>
                        <TH className="text-right">Base year</TH>
                        <TH>Gross-up</TH>
                        <TH>Cap</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {current.pools.map((p) => (
                        <TR key={p.pool}>
                          <TD className="font-medium">{p.pool}</TD>
                          <TD>{p.method === "pro_rata" ? "Pro-rata" : "Fixed %"}</TD>
                          <TD className="num">
                            {p.method === "pro_rata" ? (
                              p.denominator_sqft ? (
                                `÷ ${p.denominator_sqft.replace(/\.00$/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",")} sf`
                              ) : (
                                <span className="text-error">No denominator</span>
                              )
                            ) : p.fixed_pct ? (
                              pct(p.fixed_pct, 2)
                            ) : (
                              <span className="text-error">No %</span>
                            )}
                          </TD>
                          <TD>{p.excluded_categories.join(", ") || "—"}</TD>
                          <TD className="num">{p.base_year_amount ? money(p.base_year_amount) : "—"}</TD>
                          <TD>{p.gross_up_enabled ? `${pct(p.gross_up_target, 0)} target · ${pct(p.gross_up_actual, 0)} actual` : "—"}</TD>
                          <TD>
                            {p.cap_kind ? (
                              <span className={p.cap_kind !== "noncumulative" ? "text-error" : ""}>
                                {p.cap_kind} {pct(p.cap_pct, 1)} on {money(p.cap_prior_year)}
                              </span>
                            ) : (
                              "—"
                            )}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              </PanelBody>
            </Panel>
          )}
        </div>
      )}
      {editing && (
        <RuleEditor
          pid={pid}
          draft={editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null);
            setSelected(id);
            rules.reload();
          }}
        />
      )}
      {approving && (
        <ApproveDialog
          rule={approving}
          onClose={() => setApproving(null)}
          onDone={() => {
            setApproving(null);
            rules.reload();
          }}
        />
      )}
      {dialog}
    </>
  );
}

function ApproveDialog({ rule, onClose, onDone }: { rule: LeaseRule; onClose: () => void; onDone: () => void }) {
  const [checks, setChecks] = useState([false, false, false]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const items = [
    "I compared every pool, method, denominator and percentage to the lease.",
    "Exclusions, caps, base year, gross-up and admin fee match the lease text.",
    "Terms the engine cannot compute are listed as unsupported.",
  ];
  const ready = checks.every(Boolean) && note.trim().length >= 3;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Approve ${rule.ref}`}
        description="Approved rules are used in new audit runs and locked until returned to draft."
      >
        <fieldset className="space-y-2">
          <legend className="sr-only">Approval checklist</legend>
          {items.map((t, i) => (
            <label key={i} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 accent-[var(--accent)]"
                checked={checks[i]}
                onChange={(e) => setChecks(checks.map((c, j) => (j === i ? e.target.checked : c)))}
              />
              {t}
            </label>
          ))}
        </fieldset>
        <Field label="Approval note" className="mt-4" required hint="For example: checked against lease pages 12 to 14">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {err && (
          <p role="alert" className="mt-3 text-sm text-error">
            {err}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!ready}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post(`/lease-rules/${rule.id}/approve`, { note: note.trim() });
                toast.success(`${rule.ref} approved`);
                onDone();
              } catch (x) {
                setErr(errorText(x));
              } finally {
                setBusy(false);
              }
            }}
          >
            <ShieldCheck />
            Approve rule
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RuleEditor({ pid, draft, onClose, onSaved }: { pid: string; draft: Draft; onClose: () => void; onSaved: (id: string) => void }) {
  const [d, setD] = useState<Draft>(draft);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(draft);
  useUnsavedChanges(dirty);
  const n = (v: string) => (v.trim() === "" ? null : v.trim());
  const setPool = (i: number, patch: Partial<AllocationRule>) =>
    setD({ ...d, pools: d.pools.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const list = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = {
      ...d,
      pools: d.pools.map((p) => {
        const c = { ...p };
        delete c.id;
        return c;
      }),
    };
    try {
      const r = d.id
        ? await api.put<LeaseRule>(`/lease-rules/${d.id}`, body)
        : await api.post<LeaseRule>(`/properties/${pid}/lease-rules`, body);
      toast.success(`${r.ref} saved as draft v${r.version}`);
      onSaved(r.id);
    } catch (x) {
      setErr(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && (!dirty || window.confirm("Discard unsaved changes to this rule?"))) onClose();
      }}
    >
      <DialogContent
        title={d.id ? `Edit ${draft.ref}` : "New lease rule"}
        className="max-w-4xl"
        description="Rules are saved as drafts. Approve them separately."
      >
        <form onSubmit={save} className="space-y-5">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Rule reference" required>
              <Input value={d.ref} onChange={(e) => setD({ ...d, ref: e.target.value })} />
            </Field>
            <Field label="Lease source" hint="Document, page and section" className="md:col-span-2">
              <Input value={d.source_ref} onChange={(e) => setD({ ...d, source_ref: e.target.value })} />
            </Field>
            <Field label="Admin fee" hint="Decimal, 0.10 = 10%">
              <Input inputMode="decimal" value={d.admin_fee_pct ?? ""} onChange={(e) => setD({ ...d, admin_fee_pct: n(e.target.value) })} />
            </Field>
            <Field label="Admin fee pools" hint="Comma separated, must be pools below">
              <Input value={d.admin_fee_pools.join(", ")} onChange={(e) => setD({ ...d, admin_fee_pools: list(e.target.value) })} />
            </Field>
            <Field label="Admin fee order" hint="Required when a fee pool has a cap">
              <Select value={d.admin_fee_order ?? ""} onChange={(e) => setD({ ...d, admin_fee_order: e.target.value || null })}>
                <option value="">Not stated</option>
                <option value="after_cap">After cap</option>
                <option value="before_cap">Before cap</option>
              </Select>
            </Field>
            <Field label="Unsupported terms" hint="One per line. Any entry makes the tenant unresolved." className="md:col-span-3">
              <Textarea
                value={d.unsupported_terms.join("\n")}
                onChange={(e) => setD({ ...d, unsupported_terms: e.target.value.split("\n").filter((s) => s.trim()) })}
              />
            </Field>
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Expense pools</h3>
            {d.pools.map((p, i) => (
              <fieldset key={i} className="grid gap-3 rounded-md border border-line bg-surface-2 p-3 md:grid-cols-4">
                <legend className="px-1 text-xs font-semibold text-ink-2">Pool {i + 1}</legend>
                <Field label="Pool" required>
                  <Input value={p.pool} onChange={(e) => setPool(i, { pool: e.target.value.toUpperCase() })} />
                </Field>
                <Field label="Method">
                  <Select value={p.method} onChange={(e) => setPool(i, { method: e.target.value })}>
                    <option value="pro_rata">Pro-rata by area</option>
                    <option value="fixed_pct">Fixed percentage</option>
                  </Select>
                </Field>
                {p.method === "pro_rata" ? (
                  <Field label="Denominator sq ft" required hint="As defined in the lease">
                    <Input
                      inputMode="decimal"
                      value={p.denominator_sqft ?? ""}
                      onChange={(e) => setPool(i, { denominator_sqft: n(e.target.value) })}
                    />
                  </Field>
                ) : (
                  <Field label="Fixed share" required hint="Decimal, 0.125 = 12.5%">
                    <Input inputMode="decimal" value={p.fixed_pct ?? ""} onChange={(e) => setPool(i, { fixed_pct: n(e.target.value) })} />
                  </Field>
                )}
                <Field label="Excluded categories" hint="Comma separated codes">
                  <Input
                    value={p.excluded_categories.join(", ")}
                    onChange={(e) => setPool(i, { excluded_categories: list(e.target.value) })}
                  />
                </Field>
                <Field label="Base-year amount" hint="Full-year pool amount">
                  <Input
                    inputMode="decimal"
                    value={p.base_year_amount ?? ""}
                    onChange={(e) => setPool(i, { base_year_amount: n(e.target.value) })}
                  />
                </Field>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-ink-2">Gross-up</span>
                  <label className="flex h-8 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)]"
                      checked={p.gross_up_enabled}
                      onChange={(e) => setPool(i, { gross_up_enabled: e.target.checked })}
                    />
                    Gross up variable costs
                  </label>
                </div>
                {p.gross_up_enabled && (
                  <>
                    <Field label="Target occupancy" hint="0.95 = 95%">
                      <Input
                        inputMode="decimal"
                        value={p.gross_up_target ?? ""}
                        onChange={(e) => setPool(i, { gross_up_target: n(e.target.value) })}
                      />
                    </Field>
                    <Field label="Actual occupancy">
                      <Input
                        inputMode="decimal"
                        value={p.gross_up_actual ?? ""}
                        onChange={(e) => setPool(i, { gross_up_actual: n(e.target.value) })}
                      />
                    </Field>
                  </>
                )}
                <Field label="Cap type">
                  <Select value={p.cap_kind ?? ""} onChange={(e) => setPool(i, { cap_kind: e.target.value || null })}>
                    <option value="">None</option>
                    <option value="noncumulative">Non-cumulative</option>
                    <option value="cumulative">Cumulative (unsupported)</option>
                    <option value="cpi">CPI (unsupported)</option>
                  </Select>
                </Field>
                {p.cap_kind && (
                  <>
                    <Field label="Cap %" hint="0.05 = 5%">
                      <Input inputMode="decimal" value={p.cap_pct ?? ""} onChange={(e) => setPool(i, { cap_pct: n(e.target.value) })} />
                    </Field>
                    <Field label="Prior-year controllable charge">
                      <Input
                        inputMode="decimal"
                        value={p.cap_prior_year ?? ""}
                        onChange={(e) => setPool(i, { cap_prior_year: n(e.target.value) })}
                      />
                    </Field>
                  </>
                )}
                <div className="flex items-end md:col-start-4 md:justify-end">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => setD({ ...d, pools: d.pools.filter((_, j) => j !== i) })}
                    disabled={d.pools.length === 1}
                  >
                    <Trash2 />
                    Remove pool
                  </Button>
                </div>
              </fieldset>
            ))}
            <Button type="button" size="xs" onClick={() => setD({ ...d, pools: [...d.pools, { ...blankPool, pool: "" }] })}>
              <Plus />
              Add pool
            </Button>
          </div>
          {err && (
            <p role="alert" className="text-sm text-error">
              {err}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Save draft
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
