import { api } from "@/lib/api";

export type PortSpec = { name: string; label: string; required: boolean; multi: boolean };
export type FieldSpec = {
  key: string;
  label: string;
  type:
    | "text"
    | "textarea"
    | "number"
    | "bool"
    | "select"
    | "column"
    | "columns"
    | "mapping"
    | "conditions"
    | "property"
    | "period"
    | "expression";
  required: boolean;
  default: unknown;
  options: { value: string; label: string }[];
  help: string;
  show_if: [string, string] | null;
};
export type NodeSpec = {
  type: string;
  label: string;
  category: "input" | "transform" | "financial" | "output" | "control";
  description: string;
  inputs: PortSpec[];
  outputs: string[];
  fields: FieldSpec[];
};

export type DefNode = { id: string; type: string; label: string; config: Record<string, unknown>; position: { x: number; y: number } };
export type DefEdge = { id: string; source: string; source_port: string; target: string; target_port: string };
export type Definition = { nodes: DefNode[]; edges: DefEdge[] };
export type GraphError = { node: string; message: string };

export type RunBrief = {
  id: string;
  workflow_id: string;
  workflow_name: string;
  version: number | null;
  status: RunStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string;
  summary: { issues?: Record<string, number>; artifacts?: string[]; steps?: Record<string, number> };
  created_by: string;
  retry_of: string | null;
};
export type RunStatus = "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled" | "rejected";

export type WorkflowItem = {
  id: string;
  name: string;
  description: string;
  category: string;
  status: "draft" | "active" | "archived";
  template_key: string | null;
  owner: string;
  steps: number;
  created_at: string;
  updated_at: string;
  last_run: { id: string; status: RunStatus; created_at: string } | null;
};
export type WorkflowDetail = WorkflowItem & {
  version: { id: string; number: number; hash: string; created_at: string };
  definition: Definition;
  errors: GraphError[];
  versions: { id: string; number: number; created_at: string; created_by: string }[];
};

export type Template = {
  key: string;
  name: string;
  description: string;
  category: string;
  version: number;
  steps: number;
  needs_property: boolean;
  inputs: string[];
  node_types: string[];
};

export type Preview = { columns: string[]; rows: string[][]; source_rows: (number | null)[]; row_count: number };
export type Issue = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  row?: number;
  column?: string;
  value?: string;
  step?: string;
  node?: string;
};
export type StepRun = {
  id: string;
  node_key: string;
  node_type: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped" | "waiting_approval" | "cancelled";
  attempts: number;
  started_at: string | null;
  finished_at: string | null;
  logs: string[];
  outputs: Record<string, Preview>;
  issues: Issue[];
  error: string;
  approval: {
    id: string;
    status: "pending" | "approved" | "rejected" | "cancelled";
    instructions: string;
    note: string;
    decided_by: string;
    decided_at: string | null;
  } | null;
};
export type RunDetail = RunBrief & {
  definition: Definition;
  definition_hash: string;
  inputs: { node: string; label: string; file_id: string; filename: string; sha256: string; size_bytes: number }[];
  cancel_requested: boolean;
  steps: StepRun[];
  artifacts: { id: string; name: string; content_type: string; size_bytes: number; sha256: string; step: string }[];
};
export type UploadedFile = { id: string; filename: string; size_bytes: number; sha256: string; sheets: string[]; preview: Preview };

export const ACTIVE: RunStatus[] = ["queued", "running"];
export const isActive = (s: RunStatus) => ACTIVE.includes(s);

export const CATEGORY: Record<string, string> = {
  data_quality: "Data quality",
  cam: "CAM",
  lease: "Lease",
  billing: "Billing",
  custom: "Custom",
};
export const NODE_CATEGORY: Record<NodeSpec["category"], string> = {
  input: "Inputs",
  transform: "Transform",
  financial: "Financial",
  output: "Outputs",
  control: "Control",
};

/** Fetch the node catalog once per page load. */
let catalog: Promise<NodeSpec[]> | null = null;
export function loadCatalog(): Promise<NodeSpec[]> {
  catalog ??= api.get<NodeSpec[]>("/workflow-nodes").catch((e) => {
    catalog = null;
    throw e;
  });
  return catalog;
}

export function uploadFile(file: File): Promise<UploadedFile> {
  const fd = new FormData();
  fd.append("file", file);
  return api.post<UploadedFile>("/workflow-files", fd);
}

export function duration(a: string | null, b: string | null): string {
  if (!a) return "";
  const ms = (b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime();
  if (ms < 1000) return "<1s";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function newNodeId(type: string, taken: Set<string>): string {
  const base = type.split("_")[0];
  let i = 1;
  while (taken.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

export function defaultConfig(spec: NodeSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of spec.fields) if (f.default !== null && f.default !== undefined) out[f.key] = f.default;
  return out;
}
