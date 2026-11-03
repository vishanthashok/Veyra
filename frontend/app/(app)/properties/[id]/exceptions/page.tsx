"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, CheckCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useNoteDialog } from "@/components/app/note-dialog";
import { EmptyState, ErrorBox, KeyValue, PageHeader, ProvisionalBanner } from "@/components/app/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, SheetContent } from "@/components/ui/dialog";
import { Select } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { api, type AuditExc, type HistoryItem, type User } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { fmtDateTime, money } from "@/lib/utils";
import { crumbs, useProperty } from "../context";
import { RunPicker, useRuns } from "../runs";

const OPEN = ["open", "in_review", "reopened"];
const ACTIONS: Record<string, { to: string; label: string; danger?: boolean }[]> = {
  open: [
    { to: "in_review", label: "Start review" },
    { to: "resolved", label: "Resolve" },
    { to: "accepted", label: "Accept exception" },
  ],
  in_review: [
    { to: "resolved", label: "Resolve" },
    { to: "accepted", label: "Accept exception" },
    { to: "open", label: "Back to open" },
  ],
  reopened: [
    { to: "in_review", label: "Start review" },
    { to: "resolved", label: "Resolve" },
    { to: "accepted", label: "Accept exception" },
  ],
  resolved: [{ to: "reopened", label: "Reopen" }],
  accepted: [{ to: "reopened", label: "Reopen" }],
};
const TYPE_HELP: Record<string, string> = {
  MISSING_LEASE_RULE: "Add or approve a lease rule for this tenant, then re-run.",
  MISSING_TENANT_AREA: "Enter the tenant's rentable area, then re-run.",
  UNSUPPORTED_RULE: "The engine cannot compute this term. Calculate it manually and document it, or accept with a reason.",
  MISSING_RULE_TERM: "Complete the lease rule, then re-run.",
  MAPPING_NEEDS_REVIEW: "Decide recoverability on the Expense mapping page, then re-run.",
  UNMAPPED_GL_ACCOUNT: "Map the account on the Expense mapping page, then re-run.",
  DUPLICATE_GL_CANDIDATE: "Check the invoices. Exclude the duplicate on the Expense mapping page if confirmed.",
  TRANSACTION_OUTSIDE_PERIOD: "Outside the audit window. Usually no action; confirm the posting date.",
  VARIANCE_OVER_THRESHOLD: "Compare estimates billed to the provisional share. Not a confirmed billing error.",
  MISSING_BILLINGS: "Import billings for this tenant or confirm none were issued.",
  ROUNDING_DIFFERENCE: "Informational. Rounded tenant lines differ from the pool by cents. No plug is applied.",
  SHARES_EXCEED_100: "Tenant shares in this pool sum above 100%. Check lease denominators.",
};

export default function Exceptions() {
  const ctx = useProperty();
  const [selected, setSelected] = useState<string | null>(null);
  const runs = useRuns(ctx.property.id, selected);
  const runId = runs.data?.run?.id;
  const exc = useLoad(() => (runId ? api.get<AuditExc[]>(`/audit-runs/${runId}/exceptions`) : Promise.resolve([] as AuditExc[])), [runId]);
  const users = useLoad(() => api.get<User[]>("/users"), []);
  const [active, setActive] = useState<AuditExc | null>(null);
  const [view, setView] = useState<"open" | "all">("open");
  const rows = useMemo(() => (exc.data ?? []).filter((e) => view === "all" || OPEN.includes(e.status)), [exc.data, view]);
  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, info: 0 };
    for (const e of exc.data ?? []) if (OPEN.includes(e.status)) c[e.severity]++;
    return c;
  }, [exc.data]);

  const columns = useMemo<ColumnDef<AuditExc, unknown>[]>(
    () => [
      {
        accessorKey: "severity",
        header: "Severity",
        filterFn: "equals",
        sortingFn: (a, b) =>
          ["error", "warning", "info"].indexOf(a.original.severity) - ["error", "warning", "info"].indexOf(b.original.severity),
        cell: ({ getValue }) => <StatusBadge status={getValue() as string} />,
      },
      {
        accessorKey: "type",
        header: "Category",
        filterFn: "equals",
        cell: ({ getValue }) => <span className="font-mono text-2xs">{getValue() as string}</span>,
      },
      {
        id: "subject",
        header: "Tenant / account",
        accessorFn: (r) => [r.tenant_name, r.gl_account && `GL ${r.gl_account}`, r.pool && `Pool ${r.pool}`].filter(Boolean).join(" · "),
        cell: ({ getValue }) => <span className="text-ink-2">{(getValue() as string) || "—"}</span>,
      },
      {
        accessorKey: "message",
        header: "Message",
        cell: ({ getValue }) => <span className="line-clamp-2 max-w-xl">{getValue() as string}</span>,
      },
      { accessorKey: "amount", header: "Amount", meta: { align: "right" }, cell: ({ getValue }) => money(getValue() as string | null) },
      {
        accessorKey: "assigned_to_name",
        header: "Assignee",
        cell: ({ getValue }) => <span className="text-ink-2">{(getValue() as string) ?? "—"}</span>,
      },
      {
        accessorKey: "status",
        header: "Status",
        filterFn: "equals",
        cell: ({ getValue }) => <StatusBadge status={getValue() as string} />,
      },
      {
        accessorKey: "updated_at",
        header: "Updated",
        cell: ({ getValue }) => <span className="whitespace-nowrap text-xs text-muted">{fmtDateTime(getValue() as string)}</span>,
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Exceptions"
        crumbs={crumbs(ctx, "Exceptions")}
        description="Review queue for the selected audit run. Blocking errors clear by fixing data and re-running, or by accepting with a reason. Accepted items stay on the record."
        actions={<RunPicker runs={runs.data?.runs ?? []} value={runId} onChange={setSelected} />}
      />
      <ProvisionalBanner compact />
      <ErrorBox error={runs.error || exc.error} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Queue view" className="inline-flex rounded-md border border-line-strong bg-surface p-0.5">
          {(["open", "all"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={
                view === v
                  ? "rounded-[5px] bg-nav px-3 py-1 text-xs font-medium text-white"
                  : "rounded-[5px] px-3 py-1 text-xs text-ink-2 hover:bg-surface-3"
              }
            >
              {v === "open" ? "Needs action" : "All"}
            </button>
          ))}
        </div>
        <Badge tone="error">{counts.error} errors</Badge>
        <Badge tone="warning">{counts.warning} warnings</Badge>
        <Badge tone="info">{counts.info} info</Badge>
      </div>
      <Panel>
        {!runId && !runs.loading ? (
          <EmptyState icon={AlertTriangle} title="No audit run yet">
            Run an audit to populate the queue.
          </EmptyState>
        ) : rows.length === 0 && !exc.loading && view === "open" ? (
          <EmptyState icon={CheckCheck} title="Nothing needs action">
            Every exception in this run is resolved or accepted.
          </EmptyState>
        ) : (
          <DataTable
            caption="Exceptions"
            data={rows}
            columns={columns}
            getRowId={(r) => r.id}
            loading={exc.loading}
            onRowClick={setActive}
            activeRowId={active?.id}
            searchPlaceholder="Search exceptions"
            exportName={`veyra-exceptions-${runId?.slice(0, 8)}`}
            initialSorting={[{ id: "severity", desc: false }]}
            facets={[
              {
                columnId: "severity",
                label: "Severity",
                options: [
                  { value: "error", label: "Error" },
                  { value: "warning", label: "Warning" },
                  { value: "info", label: "Info" },
                ],
              },
              { columnId: "type", label: "Category" },
              {
                columnId: "status",
                label: "Status",
                options: ["open", "in_review", "reopened", "resolved", "accepted"].map((s) => ({ value: s, label: s.replace("_", " ") })),
              },
            ]}
            initialHidden={["updated_at"]}
          />
        )}
      </Panel>
      <ExceptionSheet
        exc={active}
        users={users.data ?? []}
        onClose={() => setActive(null)}
        onChanged={(e) => {
          setActive(e);
          exc.reload();
        }}
      />
    </>
  );
}

function ExceptionSheet({
  exc,
  users,
  onClose,
  onChanged,
}: {
  exc: AuditExc | null;
  users: User[];
  onClose: () => void;
  onChanged: (e: AuditExc) => void;
}) {
  const hist = useLoad(() => (exc ? api.get<HistoryItem[]>(`/exceptions/${exc.id}/history`) : Promise.resolve([])), [exc?.id, exc?.status]);
  const { ask, dialog } = useNoteDialog();
  if (!exc) return <Dialog open={false} />;
  const actions = (ACTIONS[exc.status] ?? []).filter((a) => !(exc.severity === "error" && a.to === "resolved"));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        className="max-w-xl"
        title={
          <span className="flex items-center gap-2">
            <StatusBadge status={exc.severity} />
            <span className="font-mono text-sm">{exc.type}</span>
          </span>
        }
        description={`Created ${fmtDateTime(exc.created_at)}`}
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-surface p-4 shadow-xs">
            <p className="text-sm text-ink">{exc.message}</p>
            {TYPE_HELP[exc.type] && (
              <p className="mt-2 text-sm text-ink-2">
                <b className="font-medium">How to clear it:</b> {TYPE_HELP[exc.type]}
              </p>
            )}
          </div>
          <KeyValue
            className="rounded-lg border border-line bg-surface p-4"
            items={[
              ["Status", <StatusBadge key="s" status={exc.status} />],
              ["Tenant", exc.tenant_name ?? "—"],
              ["GL account", exc.gl_account ?? "—"],
              ["Pool", exc.pool ?? "—"],
              ["Amount", money(exc.amount)],
              ["Transactions", exc.transaction_ids.length ? `${exc.transaction_ids.length} linked` : "—"],
              [
                "Assignee",
                <Select
                  key="a"
                  aria-label="Assignee"
                  className="max-w-56"
                  value={exc.assigned_to ?? ""}
                  onChange={async (e) => {
                    const r = await api.put<AuditExc>(`/exceptions/${exc.id}/assignee`, { user_id: e.target.value || null });
                    toast.success("Assignee updated");
                    onChanged(r);
                  }}
                >
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>,
              ],
              ["Latest note", exc.resolution_note || "—"],
            ]}
          />
          {exc.severity === "error" && OPEN.includes(exc.status) && (
            <p className="rounded-md border border-error-line bg-error-bg px-3 py-2 text-sm text-error">
              Blocking error. It cannot be marked resolved by hand. Fix the data and re-run, or accept it with a documented reason.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <Button
                key={a.to}
                variant={a.to === "resolved" || a.to === "accepted" ? "primary" : "secondary"}
                onClick={() =>
                  ask({
                    title: a.label,
                    confirm: a.label,
                    description:
                      a.to === "accepted"
                        ? "Accepting keeps the exception on the audit record with your reason. It does not change any figure."
                        : undefined,
                    placeholder: a.to === "accepted" ? "Why this is acceptable, and who agreed" : "What you checked",
                    onSubmit: async (note) => {
                      const r = await api.patch<AuditExc>(`/exceptions/${exc.id}`, { status: a.to, note });
                      toast.success(`Marked ${a.to.replace("_", " ")}`);
                      onChanged(r);
                    },
                  })
                }
              >
                {a.label}
              </Button>
            ))}
          </div>
          <section>
            <h3 className="mb-2 text-sm font-semibold">History</h3>
            {hist.data?.length ? (
              <ol className="relative space-y-3 border-l border-line pl-4">
                {hist.data.map((h, i) => (
                  <li key={i} className="text-sm">
                    <span className="absolute -left-1 mt-1.5 size-2 rounded-full bg-line-strong" aria-hidden />
                    <div className="flex items-center gap-2">
                      <StatusBadge status={h.decision} />
                      <span className="text-2xs text-muted">
                        {h.reviewer} · {fmtDateTime(h.at)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-ink-2">{h.note}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted">No reviewer actions yet.</p>
            )}
          </section>
        </div>
        {dialog}
      </SheetContent>
    </Dialog>
  );
}
