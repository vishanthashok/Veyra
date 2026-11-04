"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { History, LayoutTemplate, Plus, Workflow as WorkflowIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useApp } from "@/components/app/app-context";
import { EmptyState, ErrorBox, PageHeader } from "@/components/app/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Segmented, Select, Textarea } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { Tooltip } from "@/components/ui/tooltip";
import { api, errorText } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { CATEGORY, type RunBrief, type Template, type WorkflowDetail, type WorkflowItem, duration } from "@/lib/workflows";

type Tab = "mine" | "templates" | "runs";

export default function WorkflowsPage() {
  return (
    <Suspense>
      <Library />
    </Suspense>
  );
}

function Library() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get("tab") as Tab) || "mine";
  const setTab = (t: Tab) => router.replace(t === "mine" ? "/workflows" : `/workflows?tab=${t}`);
  const wfs = useLoad(() => api.get<WorkflowItem[]>("/workflows"), []);
  const tpls = useLoad(() => api.get<Template[]>("/workflow-templates"), []);
  const runs = useLoad(() => api.get<RunBrief[]>("/workflow-runs?limit=100"), [tab]);
  const [creating, setCreating] = useState<Template | "blank" | null>(null);

  return (
    <>
      <PageHeader
        title="Workflows"
        description="Repeatable spreadsheet workflows for CAM review. Every run records its inputs, version, steps and outputs."
        actions={
          <>
            <Button onClick={() => setTab("templates")}>
              <LayoutTemplate />
              Templates
            </Button>
            <Button variant="primary" onClick={() => setCreating("blank")}>
              <Plus />
              New workflow
            </Button>
          </>
        }
      />
      <Segmented
        label="Workflow views"
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: "mine", label: "My workflows", count: wfs.data?.length },
          { value: "templates", label: "Templates", count: tpls.data?.length },
          { value: "runs", label: "Run history", count: runs.data?.length },
        ]}
      />
      {tab === "mine" && <MyWorkflows state={wfs} onCreate={() => setTab("templates")} />}
      {tab === "templates" && <Templates state={tpls} onUse={setCreating} />}
      {tab === "runs" && <Runs state={runs} />}
      {creating && <CreateDialog template={creating === "blank" ? null : creating} onClose={() => setCreating(null)} />}
    </>
  );
}

function MyWorkflows({ state, onCreate }: { state: ReturnType<typeof useLoad<WorkflowItem[]>>; onCreate: () => void }) {
  const router = useRouter();
  const columns = useMemo<ColumnDef<WorkflowItem, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Workflow",
        cell: ({ row }) => (
          <div className="min-w-0 py-0.5">
            <Link
              href={`/workflows/${row.original.id}`}
              className="font-medium text-ink hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {row.original.name}
            </Link>
            {row.original.description && <div className="max-w-xl truncate text-xs text-muted">{row.original.description}</div>}
          </div>
        ),
      },
      {
        id: "category",
        accessorFn: (r) => r.category,
        header: "Category",
        filterFn: "equals",
        cell: ({ row }) => <span className="whitespace-nowrap text-ink-2">{CATEGORY[row.original.category] ?? row.original.category}</span>,
      },
      {
        id: "last_run",
        header: "Last run",
        accessorFn: (r) => r.last_run?.created_at ?? "",
        cell: ({ row }) =>
          row.original.last_run ? (
            <Link
              href={`/workflows/runs/${row.original.last_run.id}`}
              className="flex items-center gap-2 whitespace-nowrap"
              onClick={(e) => e.stopPropagation()}
            >
              <StatusBadge status={row.original.last_run.status} />
              <Tooltip content={fmtDateTime(row.original.last_run.created_at)}>
                <span className="text-xs text-muted">{fmtDate(row.original.last_run.created_at)}</span>
              </Tooltip>
            </Link>
          ) : (
            <span className="text-xs text-subtle">Never run</span>
          ),
      },
      {
        id: "status",
        accessorFn: (r) => r.status,
        header: "Status",
        filterFn: "equals",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "steps",
        header: "Steps",
        meta: { align: "right" },
        cell: ({ getValue }) => <span className="tabular">{getValue() as number}</span>,
      },
      {
        accessorKey: "owner",
        header: "Owner",
        cell: ({ getValue }) => <span className="whitespace-nowrap text-ink-2">{getValue() as string}</span>,
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { align: "right" },
        cell: ({ row }) => (
          <Button size="xs" onClick={(e) => (e.stopPropagation(), router.push(`/workflows/${row.original.id}`))}>
            Open
          </Button>
        ),
      },
    ],
    [router],
  );
  return (
    <Panel>
      <ErrorBox error={state.error} onRetry={state.reload} className="m-4" />
      {state.data && state.data.length === 0 ? (
        <EmptyState
          icon={WorkflowIcon}
          title="No workflows yet"
          action={
            <Button variant="primary" onClick={onCreate}>
              <LayoutTemplate />
              Start from a template
            </Button>
          }
        >
          Start with the GL expense cleaner: upload a GL export, get a cleaned workbook and an exception sheet.
        </EmptyState>
      ) : (
        <DataTable
          caption="Workflows"
          data={state.data ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          loading={state.loading}
          onRowClick={(r) => router.push(`/workflows/${r.id}`)}
          searchPlaceholder="Search workflows"
          facets={[
            { columnId: "category", label: "Category", options: Object.entries(CATEGORY).map(([value, label]) => ({ value, label })) },
            {
              columnId: "status",
              label: "Status",
              options: [
                { value: "active", label: "Active" },
                { value: "draft", label: "Draft" },
              ],
            },
          ]}
        />
      )}
    </Panel>
  );
}

function Templates({ state, onUse }: { state: ReturnType<typeof useLoad<Template[]>>; onUse: (t: Template) => void }) {
  return (
    <Panel>
      <ErrorBox error={state.error} onRetry={state.reload} className="m-4" />
      <ul className="divide-y divide-line">
        {(state.data ?? []).map((t) => (
          <li key={t.key} className="flex flex-wrap items-start gap-4 px-5 py-4">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-accent-soft text-accent">
              <LayoutTemplate className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-md font-semibold text-ink">{t.name}</h2>
                <Badge tone="outline">{CATEGORY[t.category] ?? t.category}</Badge>
                <span className="text-xs text-muted">{t.steps} steps</span>
              </div>
              <p className="mt-0.5 max-w-3xl text-sm text-muted">{t.description}</p>
              <p className="mt-1.5 text-xs text-ink-2">
                <span className="text-muted">Inputs: </span>
                {[...t.inputs, ...(t.needs_property ? ["Veyra property data"] : [])].join(" · ") || "None"}
              </p>
            </div>
            <Button variant="primary" size="sm" onClick={() => onUse(t)} aria-label={`Use template ${t.name}`}>
              Use template
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Runs({ state }: { state: ReturnType<typeof useLoad<RunBrief[]>> }) {
  const router = useRouter();
  const columns = useMemo<ColumnDef<RunBrief, unknown>[]>(
    () => [
      {
        accessorKey: "workflow_name",
        header: "Workflow",
        cell: ({ row }) => (
          <span className="font-medium text-ink">
            {row.original.workflow_name} <span className="font-normal text-muted">v{row.original.version}</span>
          </span>
        ),
      },
      {
        id: "status",
        accessorFn: (r) => r.status,
        header: "Status",
        filterFn: "equals",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "issues",
        header: "Issues",
        accessorFn: (r) => (r.summary.issues?.error ?? 0) * 1000 + (r.summary.issues?.warning ?? 0),
        cell: ({ row }) => {
          const i = row.original.summary.issues ?? {};
          return (
            <span className="tabular whitespace-nowrap text-xs">
              <span className={i.error ? "text-error" : "text-subtle"}>{i.error ?? 0} errors</span>
              <span className="text-subtle"> · </span>
              <span className={i.warning ? "text-warning" : "text-subtle"}>{i.warning ?? 0} warnings</span>
            </span>
          );
        },
      },
      {
        id: "outputs",
        header: "Outputs",
        accessorFn: (r) => r.summary.artifacts?.length ?? 0,
        meta: { align: "right" },
        cell: ({ getValue }) => <span className="tabular">{getValue() as number}</span>,
      },
      {
        accessorKey: "created_at",
        header: "Started",
        cell: ({ row }) => <span className="whitespace-nowrap text-ink-2">{fmtDateTime(row.original.created_at)}</span>,
      },
      {
        id: "duration",
        header: "Duration",
        accessorFn: (r) => duration(r.started_at, r.finished_at),
        cell: ({ getValue }) => <span className="tabular text-ink-2">{getValue() as string}</span>,
      },
      {
        accessorKey: "created_by",
        header: "By",
        cell: ({ getValue }) => <span className="whitespace-nowrap text-ink-2">{getValue() as string}</span>,
      },
    ],
    [],
  );
  return (
    <Panel>
      <ErrorBox error={state.error} onRetry={state.reload} className="m-4" />
      {state.data && state.data.length === 0 ? (
        <EmptyState icon={History} title="No runs yet">
          Runs appear here with their status, issues and output files.
        </EmptyState>
      ) : (
        <DataTable
          caption="Workflow runs"
          data={state.data ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          loading={state.loading}
          onRowClick={(r) => router.push(`/workflows/runs/${r.id}`)}
          searchPlaceholder="Search runs"
          facets={[
            {
              columnId: "status",
              label: "Status",
              options: ["completed", "waiting_approval", "failed", "running", "cancelled", "rejected"].map((s) => ({
                value: s,
                label: s.replace("_", " "),
              })),
            },
          ]}
        />
      )}
    </Panel>
  );
}

function CreateDialog({ template, onClose }: { template: Template | null; onClose: () => void }) {
  const router = useRouter();
  const { properties, current } = useApp();
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [category, setCategory] = useState(template?.category ?? "custom");
  const [pid, setPid] = useState(current?.id ?? properties[0]?.id ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const wf = await api.post<WorkflowDetail>("/workflows", {
        name,
        description,
        category,
        template_key: template?.key,
        property_id: template?.needs_property ? pid : undefined,
      });
      router.push(`/workflows/${wf.id}`);
    } catch (x) {
      setErr(errorText(x));
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={template ? `Use ${template.name}` : "New workflow"}
        description={template ? "Creates an editable copy. The template itself never changes." : "Start with an empty canvas."}
      >
        <form onSubmit={create} className="space-y-3">
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={200} />
          </Field>
          <Field label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </Field>
          {!template && (
            <Field label="Category">
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(CATEGORY).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {template?.needs_property && (
            <Field label="Property" required hint="Steps that read Veyra data use this property. Read only.">
              <Select value={pid} onChange={(e) => setPid(e.target.value)}>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {err && (
            <p role="alert" className="text-sm text-error">
              {err}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || (template?.needs_property && !pid)}>
              Create workflow
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
