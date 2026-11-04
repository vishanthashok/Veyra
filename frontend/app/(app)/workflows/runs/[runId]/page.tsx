"use client";
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  Download,
  FileSpreadsheet,
  Loader2,
  PauseCircle,
  PencilRuler,
  RotateCcw,
  Upload,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useNoteDialog } from "@/components/app/note-dialog";
import { ErrorBox, KeyValue, PageHeader, ProvisionalTag, SectionHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Segmented } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { DataPreview } from "@/components/workflows/data-preview";
import { IssueList } from "@/components/workflows/issue-list";
import { RunDialog } from "@/components/workflows/run-dialog";
import { api, errorText } from "@/lib/api";
import { cn, fmtDateTime } from "@/lib/utils";
import { type Preview, type RunDetail, type StepRun, duration, isActive } from "@/lib/workflows";

const STEP_ICON: Record<StepRun["status"], [React.ElementType, string]> = {
  completed: [CheckCircle2, "text-success"],
  failed: [XCircle, "text-error"],
  running: [Loader2, "text-info animate-spin"],
  waiting_approval: [PauseCircle, "text-warning"],
  skipped: [CircleDashed, "text-subtle"],
  cancelled: [Ban, "text-subtle"],
  pending: [CircleDashed, "text-subtle"],
};

export default function RunPage() {
  const { runId } = useParams<{ runId: string }>();
  const router = useRouter();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [rerun, setRerun] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { ask, dialog } = useNoteDialog();

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const r = await api.get<RunDetail>(`/workflow-runs/${runId}`);
        if (!live) return;
        setRun(r);
        setErr(null);
        if (isActive(r.status)) timer = setTimeout(load, 1000);
      } catch (e) {
        if (live) setErr(errorText(e));
      }
    };
    load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [runId]);

  if (err && !run) return <ErrorBox error={err} />;
  if (!run) return <Skeleton className="h-96 w-full rounded-[var(--radius-lg)]" />;

  // Default to the step that needs attention, else the last step that produced a table.
  const step =
    run.steps.find((s) => s.node_key === sel) ??
    run.steps.find((s) => s.status === "failed" || s.status === "waiting_approval") ??
    [...run.steps].reverse().find((s) => Object.keys(s.outputs).length > 0) ??
    run.steps[0];
  const gate = run.steps.find((s) => s.approval?.status === "pending");
  const counts = run.summary.issues ?? {};
  const allIssues = run.steps.flatMap((s) => s.issues);

  const act = async (label: string, fn: () => Promise<RunDetail>, ok: string) => {
    setBusy(label);
    try {
      const r = await fn();
      if (r.id !== run.id) router.push(`/workflows/runs/${r.id}`);
      else setRun(r);
      toast.success(ok);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const decide = (decision: "approve" | "reject") =>
    ask({
      title: decision === "approve" ? "Approve and continue" : "Reject run",
      description:
        decision === "approve"
          ? "The run continues after this step. Your note is stored with the run."
          : "The run stops here and produces no outputs. Your note is stored with the run.",
      confirm: decision === "approve" ? "Approve" : "Reject",
      danger: decision === "reject",
      onSubmit: async (note: string) => {
        const r = await api.post<RunDetail>(`/workflow-approvals/${gate!.approval!.id}`, { decision, note });
        setRun(r);
        toast.success(decision === "approve" ? "Approved. The run continues." : "Run rejected");
      },
    });

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Workflows", href: "/workflows" },
          { label: run.workflow_name, href: `/workflows/${run.workflow_id}` },
          { label: "Run" },
        ]}
        title={
          <span className="flex items-center gap-2.5">
            Run of {run.workflow_name}
            <span className="text-base font-normal text-muted">v{run.version}</span>
          </span>
        }
        meta={
          <>
            <StatusBadge status={run.status} />
            <ProvisionalTag />
          </>
        }
        description={
          <>
            Started {fmtDateTime(run.created_at)} by {run.created_by || "a reviewer"}
            {run.finished_at && ` · took ${duration(run.started_at, run.finished_at)}`}
            {run.retry_of && (
              <>
                {" · retry of "}
                <Link href={`/workflows/runs/${run.retry_of}`} className="underline">
                  an earlier run
                </Link>
              </>
            )}
          </>
        }
        actions={
          <>
            <Link href={`/workflows/${run.workflow_id}`} className={buttonVariants({ variant: "ghost" })}>
              <PencilRuler />
              Open builder
            </Link>
            {(isActive(run.status) || run.status === "waiting_approval") && (
              <Button
                loading={busy === "cancel"}
                onClick={() => act("cancel", () => api.post<RunDetail>(`/workflow-runs/${run.id}/cancel`), "Cancellation requested")}
              >
                <Ban />
                Cancel run
              </Button>
            )}
            {!isActive(run.status) && run.status !== "waiting_approval" && (
              <Tooltip content="Same version, same input files">
                <Button
                  loading={busy === "retry"}
                  onClick={() => act("retry", () => api.post<RunDetail>(`/workflow-runs/${run.id}/retry`), "Run started again")}
                >
                  <RotateCcw />
                  Retry
                </Button>
              </Tooltip>
            )}
            <Button variant="primary" onClick={() => setRerun(true)}>
              <Upload />
              Run with new files
            </Button>
          </>
        }
      />

      {run.status === "failed" && run.error && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-3 rounded-[var(--radius-lg)] border border-error/30 bg-error-bg px-4 py-3 text-sm"
        >
          <XCircle className="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
          <div>
            <p className="font-medium text-error">The run failed. No outputs were produced after the failed step.</p>
            <p className="text-ink-2">{run.error}</p>
          </div>
        </div>
      )}
      {run.status === "rejected" && <p className="mb-5 rounded-[var(--radius-lg)] bg-error-bg px-4 py-3 text-sm text-error">{run.error}</p>}

      {gate?.approval && run.status === "waiting_approval" && (
        <section
          aria-label="Approval required"
          className="mb-5 flex flex-wrap items-center gap-4 rounded-[var(--radius-lg)] border border-warning/40 bg-warning-bg px-4 py-3"
        >
          <PauseCircle className="size-5 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">Waiting for approval at {gate.label}</p>
            <p className="text-sm text-ink-2">{gate.approval.instructions}</p>
            <p className="mt-0.5 text-xs text-muted">
              {counts.error ?? allIssues.filter((i) => i.severity === "error").length} errors and{" "}
              {counts.warning ?? allIssues.filter((i) => i.severity === "warning").length} warnings so far.
            </p>
          </div>
          <Button variant="danger" onClick={() => decide("reject")}>
            Reject
          </Button>
          <Button variant="primary" onClick={() => decide("approve")}>
            Approve and continue
          </Button>
        </section>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
            <Panel className="self-start">
              <ol aria-label="Steps" className="divide-y divide-line">
                {run.steps.map((s, i) => {
                  const [Icon, cls] = STEP_ICON[s.status];
                  const active = s.id === step?.id;
                  const errs = s.issues.filter((x) => x.severity === "error").length;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setSel(s.node_key)}
                        aria-current={active ? "step" : undefined}
                        className={cn(
                          "flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-surface-2",
                          active && "bg-accent-soft/60 shadow-[inset_2px_0_0_var(--accent)]",
                        )}
                      >
                        <span className="tabular w-4 text-2xs text-subtle">{i + 1}</span>
                        <Icon className={cn("size-4 shrink-0", cls)} aria-label={s.status} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{s.label}</span>
                          <span className="block text-2xs text-muted">
                            {s.status.replace("_", " ")}
                            {s.finished_at && ` · ${duration(s.started_at, s.finished_at)}`}
                            {s.attempts > 1 && ` · ${s.attempts} attempts`}
                          </span>
                        </span>
                        {errs > 0 && (
                          <span className="tabular rounded-full bg-error-bg px-1.5 text-2xs font-medium text-error">{errs}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </Panel>
            {step && <StepDetail key={step.id} runId={run.id} step={step} />}
          </div>

          <section aria-labelledby="issues-h">
            <SectionHeader
              id="issues-h"
              title="Errors and warnings"
              count={allIssues.length}
              description="Row numbers refer to the original spreadsheet."
            />
            <Panel className="max-h-[420px] overflow-auto">
              <IssueList issues={allIssues} />
            </Panel>
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          <section aria-labelledby="files-h">
            <SectionHeader id="files-h" title="Output files" count={run.artifacts.length} />
            <Panel>
              {run.artifacts.length === 0 ? (
                <p className="p-4 text-sm text-muted">
                  {isActive(run.status) || run.status === "waiting_approval"
                    ? "Files appear when the output steps finish."
                    : "This run produced no files."}
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {run.artifacts.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                      <FileSpreadsheet className="size-4 shrink-0 text-accent" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">{a.name}</div>
                        <div className="text-2xs text-muted">
                          {(a.size_bytes / 1024).toFixed(1)} KB · {a.step}
                        </div>
                      </div>
                      <a
                        href={`/api/v1/workflow-artifacts/${a.id}/download`}
                        className={buttonVariants({ size: "xs" })}
                        aria-label={`Download ${a.name}`}
                      >
                        <Download />
                        Download
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </section>
          <section aria-labelledby="prov-h">
            <SectionHeader id="prov-h" title="Provenance" />
            <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-4 shadow-xs">
              <KeyValue
                className="grid-cols-[96px_1fr]"
                items={[
                  [
                    "Run ID",
                    <span key="r" className="font-mono text-xs">
                      {run.id.slice(0, 8)}…
                    </span>,
                  ],
                  ["Version", `v${run.version} · ${run.definition_hash.slice(0, 12)}`],
                  ...run.inputs.map(
                    (i) =>
                      [
                        i.label,
                        <span key={i.file_id} className="break-all text-xs">
                          {i.filename}
                          <span className="block font-mono text-2xs text-muted">sha256 {i.sha256.slice(0, 16)}…</span>
                        </span>,
                      ] as [React.ReactNode, React.ReactNode],
                  ),
                  ...(run.inputs.length ? [] : ([["Inputs", "Veyra property data (read only)"]] as [React.ReactNode, React.ReactNode][])),
                ]}
              />
            </div>
          </section>
        </aside>
      </div>

      <RunDialog
        open={rerun}
        onOpenChange={setRerun}
        workflowId={run.workflow_id}
        definition={run.definition}
        prior={run.inputs.map((i) => ({ node: i.node, file_id: i.file_id, filename: i.filename }))}
        onStarted={(r) => router.push(`/workflows/runs/${r.id}`)}
      />
      {dialog}
    </>
  );
}

function StepDetail({ runId, step }: { runId: string; step: StepRun }) {
  const ports = Object.keys(step.outputs);
  const [port, setPort] = useState(ports[0] ?? "out");
  const [more, setMore] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const data = more ?? step.outputs[port];

  async function loadAll() {
    setLoading(true);
    try {
      setMore(await api.get<Preview>(`/workflow-runs/${runId}/steps/${step.node_key}/data?port=${port}&limit=1000`));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel className="min-w-0">
      <div className="border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-md font-semibold text-ink">{step.label}</h2>
          <StatusBadge status={step.status} />
        </div>
        {step.error && <p className="mt-1 text-sm text-error">{step.error}</p>}
        <ol className="mt-2 space-y-0.5 font-mono text-xs text-ink-2">
          {step.logs.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      </div>
      {ports.length > 0 && data && (
        <>
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
            {ports.length > 1 && (
              <Segmented
                label="Output"
                value={port}
                onChange={(p) => (setPort(p), setMore(null))}
                options={ports.map((p) => ({ value: p, label: p, count: step.outputs[p].row_count }))}
              />
            )}
            {data.row_count > data.rows.length && (
              <Button size="xs" variant="ghost" loading={loading} onClick={loadAll}>
                Load up to 1,000 rows
              </Button>
            )}
          </div>
          <DataPreview data={data} maxHeight="380px" caption={`${step.label} ${port} rows`} className="mt-2" />
        </>
      )}
    </Panel>
  );
}
