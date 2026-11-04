"use client";
import { Handle, type NodeProps, Position, type Node } from "@xyflow/react";
import {
  Calculator,
  CheckCircle2,
  CircleDashed,
  FileInput,
  FileOutput,
  Loader2,
  PauseCircle,
  ShieldCheck,
  Shuffle,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NodeSpec, StepRun } from "@/lib/workflows";

export type StepData = {
  label: string;
  type: string;
  config: Record<string, unknown>;
  spec?: NodeSpec;
  errors: string[];
  run?: StepRun;
};
export type StepNode = Node<StepData, "step">;

export const CATEGORY_ICON = {
  input: FileInput,
  transform: Shuffle,
  financial: Calculator,
  output: FileOutput,
  control: ShieldCheck,
} as const;
const CATEGORY_TONE = {
  input: "bg-info-bg text-info",
  transform: "bg-surface-3 text-ink-2",
  financial: "bg-accent-soft text-accent",
  output: "bg-success-bg text-success",
  control: "bg-warning-bg text-warning",
} as const;

function RunMark({ run }: { run?: StepRun }) {
  if (!run) return null;
  const map = {
    completed: [CheckCircle2, "text-success", "Completed"],
    failed: [XCircle, "text-error", "Failed"],
    running: [Loader2, "text-info animate-spin", "Running"],
    waiting_approval: [PauseCircle, "text-warning", "Awaiting approval"],
    skipped: [CircleDashed, "text-subtle", "Skipped"],
    cancelled: [CircleDashed, "text-subtle", "Cancelled"],
    pending: [CircleDashed, "text-subtle", "Pending"],
  } as const;
  const [Icon, cls, label] = map[run.status];
  return <Icon className={cn("size-3.5 shrink-0", cls)} aria-label={`Last run: ${label}`} />;
}

export function StepNodeView({ data, selected }: NodeProps<StepNode>) {
  const spec = data.spec;
  const Icon = spec ? CATEGORY_ICON[spec.category] : Shuffle;
  const inputs = spec?.inputs ?? [];
  const outputs = spec?.outputs ?? [];
  const rows = data.run?.outputs?.out?.row_count ?? Object.values(data.run?.outputs ?? {})[0]?.row_count;
  const issues = data.run?.issues ?? [];
  const errs = issues.filter((i) => i.severity === "error").length;
  const warns = issues.filter((i) => i.severity === "warning").length;
  const handleTop = (i: number, n: number) => `${((i + 1) / (n + 1)) * 100}%`;
  return (
    <div
      className={cn(
        "relative w-[208px] rounded-[10px] border bg-surface text-left shadow-sm transition-shadow",
        selected ? "border-accent ring-2 ring-[var(--ring)]" : "border-line-strong",
        data.errors.length > 0 && !selected && "border-error/60",
      )}
    >
      {inputs.map((p, i) => (
        <Handle
          key={p.name}
          id={p.name}
          type="target"
          position={Position.Left}
          style={{ top: handleTop(i, inputs.length) }}
          className="!size-2.5 !border-2 !border-surface !bg-ink-2"
          title={`${p.label}${p.multi ? " (accepts several)" : ""}`}
        />
      ))}
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[6px]",
            spec ? CATEGORY_TONE[spec.category] : "bg-surface-3",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="truncate text-[13px] font-medium leading-5 text-ink">{data.label}</div>
            <RunMark run={data.run} />
          </div>
          <div className="truncate text-2xs text-muted">{spec?.label ?? data.type}</div>
        </div>
      </div>
      {(data.run || data.errors.length > 0) && (
        <div className="flex items-center gap-2 border-t border-line px-3 py-1.5 text-2xs">
          {data.errors.length > 0 ? (
            <span className="text-error">{data.errors.length === 1 ? "1 problem" : `${data.errors.length} problems`}</span>
          ) : (
            <>
              {rows !== undefined && <span className="tabular text-ink-2">{rows.toLocaleString()} rows</span>}
              {errs > 0 && <span className="tabular text-error">{errs} err</span>}
              {warns > 0 && <span className="tabular text-warning">{warns} warn</span>}
            </>
          )}
        </div>
      )}
      {inputs.length > 1 &&
        inputs.map((p, i) => (
          <span
            key={p.name}
            className="pointer-events-none absolute -left-1 -translate-x-full -translate-y-1/2 whitespace-nowrap text-[10px] text-muted"
            style={{ top: handleTop(i, inputs.length) }}
          >
            {p.label}
          </span>
        ))}
      {outputs.map((p, i) => (
        <Handle
          key={p}
          id={p}
          type="source"
          position={Position.Right}
          style={{ top: handleTop(i, outputs.length) }}
          className={cn("!size-2.5 !border-2 !border-surface", p === "out" ? "!bg-accent" : "!bg-subtle")}
          title={p}
        />
      ))}
      {outputs.length > 1 &&
        outputs.map((p, i) => (
          <span
            key={p}
            className="pointer-events-none absolute -right-1 translate-x-full -translate-y-1/2 whitespace-nowrap text-[10px] text-muted"
            style={{ top: handleTop(i, outputs.length) }}
          >
            {p}
          </span>
        ))}
    </div>
  );
}
