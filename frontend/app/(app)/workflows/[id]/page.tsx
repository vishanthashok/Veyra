"use client";
import "@xyflow/react/dist/style.css";
import {
  addEdge,
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { ChevronDown, History, Play, Save, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ErrorBox } from "@/components/app/page";
import { SeverityIcon, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { ConfigForm } from "@/components/workflows/config-form";
import { DataPreview } from "@/components/workflows/data-preview";
import { IssueList } from "@/components/workflows/issue-list";
import { RunDialog } from "@/components/workflows/run-dialog";
import { CATEGORY_ICON, type StepData, type StepNode, StepNodeView } from "@/components/workflows/step-node";
import { api, errorText } from "@/lib/api";
import { useUnsavedChanges } from "@/lib/hooks";
import { cn, fmtDateTime } from "@/lib/utils";
import {
  type Definition,
  type GraphError,
  type NodeSpec,
  NODE_CATEGORY,
  type RunDetail,
  type WorkflowDetail,
  defaultConfig,
  duration,
  isActive,
  loadCatalog,
  newNodeId,
} from "@/lib/workflows";

const nodeTypes = { step: StepNodeView };
const DND = "application/veyra-step";

export default function BuilderPage() {
  return (
    <ReactFlowProvider>
      <Builder />
    </ReactFlowProvider>
  );
}

function toFlow(def: Definition, catalog: NodeSpec[]): { nodes: StepNode[]; edges: Edge[] } {
  const spec = Object.fromEntries(catalog.map((s) => [s.type, s]));
  return {
    nodes: def.nodes.map((n) => ({
      id: n.id,
      type: "step",
      position: n.position,
      data: { label: n.label, type: n.type, config: n.config, spec: spec[n.type], errors: [] },
    })),
    edges: def.edges.map((e) => edgeFrom(e.source, e.source_port, e.target, e.target_port)),
  };
}

function edgeFrom(source: string, sourcePort: string, target: string, targetPort: string): Edge {
  return {
    id: `${source}.${sourcePort}-${target}.${targetPort}`,
    source,
    sourceHandle: sourcePort,
    target,
    targetHandle: targetPort,
    label: sourcePort !== "out" ? sourcePort : undefined,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
  };
}

function toDef(nodes: StepNode[], edges: Edge[]): Definition {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.type,
      label: n.data.label,
      config: n.data.config,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      source_port: e.sourceHandle ?? "out",
      target: e.target,
      target_port: e.targetHandle ?? "in",
    })),
  };
}

function Builder() {
  const { id } = useParams<{ id: string }>();
  const flow = useReactFlow();
  const [wf, setWf] = useState<WorkflowDetail | null>(null);
  const [catalog, setCatalog] = useState<NodeSpec[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [problems, setProblems] = useState<GraphError[]>([]);
  const [saving, setSaving] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [tab, setTab] = useState<"problems" | "logs" | "data" | "issues">("problems");
  const [panelOpen, setPanelOpen] = useState(true);
  useUnsavedChanges(dirty);

  // Load workflow, catalog and the latest run.
  useEffect(() => {
    let live = true;
    Promise.all([api.get<WorkflowDetail>(`/workflows/${id}`), loadCatalog()])
      .then(async ([w, cat]) => {
        if (!live) return;
        setWf(w);
        setCatalog(cat);
        setName(w.name);
        const f = toFlow(w.definition, cat);
        setNodes(f.nodes);
        setEdges(f.edges);
        setProblems(w.errors);
        if (w.last_run) setRun(await api.get<RunDetail>(`/workflow-runs/${w.last_run.id}`));
        requestAnimationFrame(() => flow.fitView({ padding: 0.08, maxZoom: 1 }));
      })
      .catch((e) => setLoadErr(errorText(e)));
    return () => {
      live = false;
    };
  }, [id, flow, setNodes, setEdges]);

  // Poll an active run.
  useEffect(() => {
    if (!run || !isActive(run.status)) return;
    const t = setInterval(async () => {
      try {
        setRun(await api.get<RunDetail>(`/workflow-runs/${run.id}`));
      } catch {}
    }, 1000);
    return () => clearInterval(t);
  }, [run]);

  // Validate on change (debounced, server is the source of truth).
  const def = useMemo(() => toDef(nodes, edges), [nodes, edges]);
  const defKey = JSON.stringify({ n: def.nodes.map((n) => [n.id, n.type, n.config]), e: def.edges });
  useEffect(() => {
    if (!wf) return;
    const t = setTimeout(async () => {
      try {
        const r = await api.post<{ errors: GraphError[] }>("/workflows/validate", def);
        setProblems(r.errors);
      } catch {}
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defKey, wf]);

  // Decorate nodes with problems and last-run status.
  const decorated = useMemo(
    () =>
      nodes.map((n) => {
        const errors = problems.filter((p) => p.node === n.id).map((p) => p.message);
        const step = run?.steps.find((s) => s.node_key === n.id);
        return errors.join() === n.data.errors.join() && step === n.data.run ? n : { ...n, data: { ...n.data, errors, run: step } };
      }),
    [nodes, problems, run],
  );

  const sel = nodes.find((n) => n.id === selected) ?? null;
  const selStep = run?.steps.find((s) => s.node_key === selected);

  const upstreamColumns = useMemo(() => {
    if (!sel || !run) return [] as string[];
    const cols = new Set<string>();
    for (const e of edges.filter((x) => x.target === sel.id)) {
      const st = run.steps.find((s) => s.node_key === e.source);
      st?.outputs?.[e.sourceHandle ?? "out"]?.columns.forEach((c) => cols.add(c));
    }
    return [...cols];
  }, [sel, run, edges]);

  const markDirty = () => setDirty(true);

  const updateNode = (nid: string, patch: Partial<StepData>) => {
    setNodes((ns) => ns.map((n) => (n.id === nid ? { ...n, data: { ...n.data, ...patch } } : n)));
    markDirty();
  };

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      const target = nodes.find((n) => n.id === c.target);
      const port = target?.data.spec?.inputs.find((p) => p.name === c.targetHandle);
      setEdges((es) => {
        // A single-input port takes the newest connection; multi-input ports accept several.
        const kept = port?.multi ? es : es.filter((e) => !(e.target === c.target && e.targetHandle === c.targetHandle));
        return addEdge(edgeFrom(c.source!, c.sourceHandle ?? "out", c.target!, c.targetHandle ?? "in"), kept);
      });
      markDirty();
    },
    [nodes, setEdges],
  );

  const addStep = (spec: NodeSpec, position?: { x: number; y: number }) => {
    const taken = new Set(nodes.map((n) => n.id));
    const nid = newNodeId(spec.type, taken);
    const pos = position ?? flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2.5 });
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      {
        id: nid,
        type: "step",
        position: pos,
        selected: true,
        data: { label: spec.label, type: spec.type, config: defaultConfig(spec), spec, errors: [] },
      },
    ]);
    setSelected(nid);
    markDirty();
  };

  const removeSelected = () => {
    if (!selected) return;
    setNodes((ns) => ns.filter((n) => n.id !== selected));
    setEdges((es) => es.filter((e) => e.source !== selected && e.target !== selected));
    setSelected(null);
    markDirty();
  };

  async function save(): Promise<WorkflowDetail | null> {
    setSaving(true);
    try {
      const w = await api.put<WorkflowDetail>(`/workflows/${id}`, { name, definition: def });
      const created = w.version.number !== wf?.version.number;
      setWf(w);
      setDirty(false);
      setProblems(w.errors);
      toast.success(created ? `Saved as version ${w.version.number}` : "Saved. No changes to the steps.");
      return w;
    } catch (e) {
      toast.error(errorText(e));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function startRun() {
    const w = dirty ? await save() : wf;
    if (!w) return;
    if (w.errors.length) {
      setTab("problems");
      setPanelOpen(true);
      toast.error("Fix the problems listed below before running.");
      return;
    }
    setRunOpen(true);
  }

  // Keyboard: Cmd/Ctrl+S saves.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  if (loadErr) return <ErrorBox error={loadErr} />;
  if (!wf) return <Skeleton className="h-[70vh] w-full rounded-[var(--radius-lg)]" />;

  const issueCount = run?.steps.reduce((a, s) => a + s.issues.length, 0) ?? 0;

  return (
    <div className="flex h-[calc(100dvh-var(--topbar-h))] min-h-[560px] flex-col">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2.5 sm:px-6">
        <nav aria-label="Breadcrumb" className="text-xs text-muted">
          <Link href="/workflows" className="hover:text-ink">
            Workflows
          </Link>
        </nav>
        <input
          aria-label="Workflow name"
          value={name}
          onChange={(e) => (setName(e.target.value), markDirty())}
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1.5 py-1 text-lg font-semibold tracking-[-0.01em] text-ink outline-none hover:border-line focus:border-accent sm:max-w-md"
        />
        <StatusBadge status={wf.status} />
        <span className="text-xs text-muted">
          Version {wf.version.number}
          {dirty && <span className="ml-2 font-medium text-warning">Unsaved changes</span>}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {run && (
            <Link href={`/workflows/runs/${run.id}`} className="hidden items-center gap-1.5 text-xs text-muted hover:text-ink md:flex">
              <History className="size-3.5" />
              Last run <StatusBadge status={run.status} />
            </Link>
          )}
          <Button onClick={save} loading={saving} disabled={!dirty && name === wf.name}>
            <Save />
            Save
          </Button>
          <Button variant="primary" onClick={startRun} disabled={run ? isActive(run.status) : false}>
            <Play />
            Run
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <StepLibrary catalog={catalog} onAdd={addStep} />

        {/* Canvas */}
        <div
          className="relative min-h-[320px] flex-1 bg-bg"
          onDragOver={(e) => (e.preventDefault(), (e.dataTransfer.dropEffect = "move"))}
          onDrop={(e) => {
            e.preventDefault();
            const type = e.dataTransfer.getData(DND);
            const spec = catalog.find((s) => s.type === type);
            if (spec) addStep(spec, flow.screenToFlowPosition({ x: e.clientX - 100, y: e.clientY - 30 }));
          }}
        >
          <ReactFlow<StepNode, Edge>
            nodes={decorated}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={(ch) => {
              onNodesChange(ch);
              if (ch.some((c) => c.type === "position" && !c.dragging) || ch.some((c) => c.type === "remove")) markDirty();
            }}
            onEdgesChange={(ch) => {
              onEdgesChange(ch);
              if (ch.some((c) => c.type === "remove")) markDirty();
            }}
            onConnect={onConnect}
            onSelectionChange={({ nodes: s }) => setSelected(s[0]?.id ?? null)}
            onNodesDelete={() => setSelected(null)}
            deleteKeyCode={["Backspace", "Delete"]}
            defaultEdgeOptions={{ style: { strokeWidth: 1.5 } }}
            proOptions={{ hideAttribution: true }}
            minZoom={0.3}
            maxZoom={1.6}
            aria-label="Workflow canvas"
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--line-strong)" />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              className="!hidden !h-[90px] !w-[140px] !rounded-md !border !border-line xl:!block"
              style={{ width: 140, height: 90 }}
              maskColor="rgb(250 250 248 / 0.7)"
              nodeColor="var(--line-strong)"
            />
          </ReactFlow>
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="max-w-xs text-center text-sm text-muted">
                Drag a step from the library, or click it to add. Start with a spreadsheet upload or property data.
              </p>
            </div>
          )}
        </div>

        {/* Configuration */}
        <aside
          aria-label="Step configuration"
          className="scroll-quiet w-full shrink-0 overflow-y-auto border-t border-line bg-surface lg:w-[300px] lg:border-l lg:border-t-0"
        >
          {sel && sel.data.spec ? (
            <div className="p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <p className="text-2xs font-medium uppercase tracking-wide text-subtle">{NODE_CATEGORY[sel.data.spec.category]}</p>
                  <h2 className="text-md font-semibold text-ink">{sel.data.spec.label}</h2>
                  <p className="mt-0.5 text-xs text-muted">{sel.data.spec.description}</p>
                </div>
                <Tooltip content="Delete step">
                  <Button size="icon-sm" variant="ghost" onClick={removeSelected} aria-label="Delete step">
                    <Trash2 />
                  </Button>
                </Tooltip>
              </div>
              <Field label="Step name" className="mb-4">
                <Input value={sel.data.label} onChange={(e) => updateNode(sel.id, { label: e.target.value })} />
              </Field>
              <ConfigForm
                spec={sel.data.spec}
                config={sel.data.config}
                onChange={(config) => updateNode(sel.id, { config })}
                columns={upstreamColumns}
                errors={problems.filter((p) => p.node === sel.id).map((p) => p.message)}
              />
              <p className="mt-4 border-t border-line pt-3 text-2xs text-muted">
                Step id <span className="font-mono">{sel.id}</span>
                {upstreamColumns.length === 0 &&
                  sel.data.spec.inputs.length > 0 &&
                  " · Run once to get column suggestions from upstream steps."}
              </p>
            </div>
          ) : (
            <div className="p-4 text-sm text-muted">
              <h2 className="mb-1 text-md font-semibold text-ink">Workflow</h2>
              <p className="mb-3">Select a step to configure it. Connect outputs (right) to inputs (left). Delete with Backspace.</p>
              <dl className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <dt>Steps</dt>
                  <dd className="tabular text-ink">{nodes.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Saved versions</dt>
                  <dd className="tabular text-ink">{wf.versions.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Last saved</dt>
                  <dd className="text-ink">{fmtDateTime(wf.version.created_at)}</dd>
                </div>
              </dl>
            </div>
          )}
        </aside>
      </div>

      {/* Bottom panel */}
      <section
        aria-label="Run output"
        className={cn("flex shrink-0 flex-col border-t border-line bg-surface", panelOpen ? "h-[260px]" : "h-10")}
      >
        <div className="flex items-center gap-3 border-b border-line px-3 py-1.5">
          <Segmented
            label="Output panel"
            value={tab}
            onChange={(t) => (setTab(t), setPanelOpen(true))}
            options={[
              { value: "problems", label: "Problems", count: problems.length },
              { value: "logs", label: "Logs" },
              { value: "data", label: "Data preview" },
              { value: "issues", label: "Errors and warnings", count: issueCount },
            ]}
          />
          {run && (
            <span className="hidden items-center gap-2 text-xs text-muted sm:flex">
              <StatusBadge status={run.status} />
              {duration(run.started_at, run.finished_at)}
              {sel && <span>· {sel.data.label}</span>}
            </span>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            className="ml-auto"
            aria-label={panelOpen ? "Collapse panel" : "Expand panel"}
            onClick={() => setPanelOpen((o) => !o)}
          >
            <ChevronDown className={cn("transition-transform", !panelOpen && "rotate-180")} />
          </Button>
        </div>
        {panelOpen && (
          <div className="scroll-quiet min-h-0 flex-1 overflow-auto">
            {tab === "problems" &&
              (problems.length === 0 ? (
                <p className="p-4 text-sm text-success">No problems. The workflow can run.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {problems.map((p, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-surface-2"
                        onClick={() =>
                          p.node && (setSelected(p.node), setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === p.node }))))
                        }
                      >
                        <SeverityIcon severity="error" />
                        <span className="text-ink">{p.message}</span>
                        {p.node && <span className="ml-auto font-mono text-2xs text-muted">{p.node}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
            {tab === "logs" &&
              (!run ? (
                <p className="p-4 text-sm text-muted">Run the workflow to see step logs.</p>
              ) : (
                <ol className="space-y-2 p-4 font-mono text-xs">
                  {run.steps
                    .filter((s) => !selected || s.node_key === selected)
                    .map((s) => (
                      <li key={s.id}>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={s.status} />
                          <span className="font-sans font-medium text-ink">{s.label}</span>
                          <span className="text-subtle">{duration(s.started_at, s.finished_at)}</span>
                        </div>
                        {[...s.logs, ...(s.error ? [`Error: ${s.error}`] : [])].map((l, i) => (
                          <p key={i} className={cn("ml-1 mt-0.5 whitespace-pre-wrap", l.startsWith("Error") ? "text-error" : "text-ink-2")}>
                            {l}
                          </p>
                        ))}
                      </li>
                    ))}
                </ol>
              ))}
            {tab === "data" && <StepData step={selStep} hasRun={!!run} />}
            {tab === "issues" &&
              (!run ? (
                <p className="p-4 text-sm text-muted">Run the workflow to see row-level errors and warnings.</p>
              ) : (
                <IssueList issues={run.steps.filter((s) => !selected || s.node_key === selected).flatMap((s) => s.issues)} />
              ))}
          </div>
        )}
      </section>

      <RunDialog
        open={runOpen}
        onOpenChange={setRunOpen}
        workflowId={id}
        definition={def}
        prior={run?.inputs.map((i) => ({ node: i.node, file_id: i.file_id, filename: i.filename }))}
        onStarted={(r) => {
          setRun(r);
          setTab("logs");
          setPanelOpen(true);
        }}
      />
    </div>
  );
}

function StepLibrary({ catalog, onAdd }: { catalog: NodeSpec[]; onAdd: (s: NodeSpec) => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const list = catalog.filter((s) => !ql || s.label.toLowerCase().includes(ql) || s.description.toLowerCase().includes(ql));
    return (Object.keys(NODE_CATEGORY) as NodeSpec["category"][])
      .map((c) => [c, list.filter((s) => s.category === c)] as const)
      .filter(([, l]) => l.length);
  }, [catalog, q]);
  return (
    <aside
      aria-label="Step library"
      className="scroll-quiet flex max-h-56 w-full shrink-0 flex-col overflow-y-auto border-b border-line bg-surface lg:max-h-none lg:w-[248px] lg:border-b-0 lg:border-r"
    >
      <div className="sticky top-0 z-[1] bg-surface p-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search steps"
            aria-label="Search steps"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>
      <div className="px-2 pb-3">
        {groups.map(([cat, list]) => (
          <div key={cat} className="mb-2">
            <h3 className="px-2 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-subtle">{NODE_CATEGORY[cat]}</h3>
            <ul>
              {list.map((s) => {
                const Icon = CATEGORY_ICON[s.category];
                return (
                  <li key={s.type}>
                    <button
                      type="button"
                      draggable
                      onDragStart={(e) => (e.dataTransfer.setData(DND, s.type), (e.dataTransfer.effectAllowed = "move"))}
                      onClick={() => onAdd(s)}
                      title={s.description}
                      aria-label={`Add ${s.label}`}
                      className="flex w-full cursor-grab items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink active:cursor-grabbing"
                    >
                      <Icon className="size-3.5 shrink-0 text-subtle" aria-hidden />
                      <span className="truncate">{s.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  );
}

function StepData({ step, hasRun }: { step: RunDetail["steps"][number] | undefined; hasRun: boolean }) {
  const ports = step ? Object.keys(step.outputs) : [];
  const [port, setPort] = useState(ports[0] ?? "out");
  const active = ports.includes(port) ? port : ports[0];
  if (!hasRun) return <p className="p-4 text-sm text-muted">Run the workflow, then select a step to preview its output.</p>;
  if (!step) return <p className="p-4 text-sm text-muted">Select a step on the canvas to preview its output.</p>;
  if (!ports.length)
    return (
      <p className="p-4 text-sm text-muted">
        {step.status === "completed"
          ? "This step has no table output. See the run's files."
          : `This step is ${step.status.replace("_", " ")}.`}
      </p>
    );
  return (
    <div className="flex h-full flex-col">
      {ports.length > 1 && (
        <div className="px-3 pt-2">
          <Segmented
            label="Output"
            value={active}
            onChange={setPort}
            options={ports.map((p) => ({ value: p, label: p, count: step.outputs[p].row_count }))}
          />
        </div>
      )}
      <DataPreview data={step.outputs[active]} maxHeight="200px" caption={`${step.label} output ${active}`} />
    </div>
  );
}
