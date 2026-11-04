"use client";
import { Plus, Trash2, X } from "lucide-react";
import { useId, useState } from "react";
import { useApp } from "@/components/app/app-context";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { api, type Period } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import type { FieldSpec, NodeSpec } from "@/lib/workflows";

const OPS = [
  ["equals", "equals"],
  ["not_equals", "does not equal"],
  ["contains", "contains"],
  ["not_contains", "does not contain"],
  ["starts_with", "starts with"],
  ["gt", ">"],
  ["gte", "≥"],
  ["lt", "<"],
  ["lte", "≤"],
  ["is_blank", "is blank"],
  ["not_blank", "is not blank"],
] as const;

type Config = Record<string, unknown>;

/** Configuration form generated from the node catalog. `columns` are known upstream columns. */
export function ConfigForm({
  spec,
  config,
  onChange,
  columns,
  errors,
}: {
  spec: NodeSpec;
  config: Config;
  onChange: (c: Config) => void;
  columns: string[];
  errors: string[];
}) {
  const listId = useId();
  const set = (k: string, v: unknown) => onChange({ ...config, [k]: v });
  const visible = spec.fields.filter(
    (f) => !f.show_if || String(config[f.show_if[0]] ?? spec.fields.find((x) => x.key === f.show_if![0])?.default ?? "") === f.show_if[1],
  );
  return (
    <div className="space-y-4">
      <datalist id={listId}>
        {columns.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {visible.map((f) => (
        <FieldEditor
          key={f.key}
          f={f}
          value={config[f.key] ?? f.default}
          onChange={(v) => set(f.key, v)}
          columns={columns}
          listId={listId}
          config={config}
        />
      ))}
      {spec.type !== "approval_gate" && (
        <details className="group border-t border-line pt-3">
          <summary className="cursor-pointer text-xs font-medium text-muted hover:text-ink">Retry policy</summary>
          <div className="mt-3">
            <Field label="Automatic retries" hint="For unexpected errors only. Invalid input or configuration never retries.">
              <Select value={String(config.retries ?? 0)} onChange={(e) => set("retries", Number(e.target.value))}>
                <option value="0">No retries</option>
                <option value="1">1 retry</option>
                <option value="2">2 retries</option>
              </Select>
            </Field>
          </div>
        </details>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-[var(--radius-md)] bg-error-bg px-3 py-2 text-xs text-error">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FieldEditor({
  f,
  value,
  onChange,
  columns,
  listId,
  config,
}: {
  f: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  columns: string[];
  listId: string;
  config: Config;
}) {
  const { properties } = useApp();
  switch (f.type) {
    case "bool":
      return (
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--accent)]"
            checked={value !== false && value !== undefined && value !== null}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>
            {f.label}
            {f.help && <span className="block text-2xs text-muted">{f.help}</span>}
          </span>
        </label>
      );
    case "select":
      return (
        <Field label={f.label} hint={f.help || undefined} required={f.required}>
          <Select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      );
    case "property":
      return (
        <Field label={f.label} hint={f.help || undefined} required={f.required}>
          <Select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
            <option value="">Choose a property</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      );
    case "period":
      return <PeriodField f={f} value={String(value ?? "")} onChange={onChange} propertyId={String(config.property_id ?? "")} />;
    case "textarea":
      return (
        <Field label={f.label} hint={f.help || undefined} required={f.required}>
          <Textarea rows={3} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
    case "column":
      return (
        <Field label={f.label} hint={f.help || undefined} required={f.required}>
          <Input list={listId} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
    case "columns":
      return (
        <ColumnsField f={f} value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} listId={listId} columns={columns} />
      );
    case "mapping":
      return <MappingField f={f} value={Array.isArray(value) ? (value as MapRow[]) : []} onChange={onChange} columns={columns} />;
    case "conditions":
      return <ConditionsField f={f} value={Array.isArray(value) ? (value as Cond[]) : []} onChange={onChange} listId={listId} />;
    case "expression":
      return (
        <Field label={f.label} hint={f.help || "Use [Column], numbers, + - * / ( ), round(x, n), abs, min, max."} required={f.required}>
          <Input className="font-mono text-xs" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
        </Field>
      );
    default:
      return (
        <Field label={f.label} hint={f.help || undefined} required={f.required}>
          <Input
            inputMode={f.type === "number" ? "decimal" : undefined}
            value={value === null || value === undefined ? "" : String(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      );
  }
}

function PeriodField({
  f,
  value,
  onChange,
  propertyId,
}: {
  f: FieldSpec;
  value: string;
  onChange: (v: unknown) => void;
  propertyId: string;
}) {
  const periods = useLoad(
    () => (propertyId ? api.get<Period[]>(`/properties/${propertyId}/periods`) : Promise.resolve([] as Period[])),
    [propertyId],
  );
  return (
    <Field label={f.label} hint={f.help || undefined}>
      <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={!propertyId}>
        <option value="">Latest period</option>
        {(periods.data ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.label} (through {p.through_date})
          </option>
        ))}
      </Select>
    </Field>
  );
}

function ColumnsField({
  f,
  value,
  onChange,
  listId,
  columns,
}: {
  f: FieldSpec;
  value: string[];
  onChange: (v: unknown) => void;
  listId: string;
  columns: string[];
}) {
  const [draft, setDraft] = useState("");
  const add = (v: string) => {
    const t = v.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft("");
  };
  const suggestions = columns.filter((c) => !value.includes(c)).slice(0, 8);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-2">
        {f.label}
        {f.required && <span className="text-muted"> *</span>}
      </span>
      <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-[var(--radius-sm)] border border-line-strong bg-surface px-1.5 py-1">
        {value.map((c) => (
          <span key={c} className="inline-flex h-6 items-center gap-1 rounded-[4px] bg-surface-3 pl-2 pr-1 font-mono text-2xs text-ink">
            {c}
            <button
              type="button"
              aria-label={`Remove ${c}`}
              onClick={() => onChange(value.filter((x) => x !== c))}
              className="rounded p-0.5 text-subtle hover:text-ink"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          list={listId}
          aria-label={`Add ${f.label.toLowerCase()}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => draft && add(draft)}
          placeholder={value.length ? "" : "Type a column, press Enter"}
          className="h-6 min-w-24 flex-1 bg-transparent px-1 text-xs outline-none placeholder:text-subtle"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => add(c)}
              className="rounded-[4px] border border-dashed border-line-strong px-1.5 py-0.5 text-2xs text-muted hover:border-accent hover:text-accent"
            >
              + {c}
            </button>
          ))}
        </div>
      )}
      {f.help && <p className="text-2xs text-muted">{f.help}</p>}
    </div>
  );
}

type MapRow = { target: string; source?: string; required?: boolean };

function MappingField({
  f,
  value,
  onChange,
  columns,
}: {
  f: FieldSpec;
  value: MapRow[];
  onChange: (v: unknown) => void;
  columns: string[];
}) {
  const upd = (i: number, patch: Partial<MapRow>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-2">{f.label}</span>
      <div className="overflow-hidden rounded-[var(--radius-sm)] border border-line">
        <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-x-1.5 border-b border-line bg-surface-2 px-2 py-1 text-2xs font-medium text-muted">
          <span>Output column</span>
          <span>Source</span>
          <span title="Required">Req.</span>
          <span className="w-6" />
        </div>
        {value.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-x-1.5 border-b border-line px-2 py-1 last:border-0">
            <input
              aria-label={`Output column ${i + 1}`}
              value={r.target}
              onChange={(e) => upd(i, { target: e.target.value })}
              className="h-7 min-w-0 rounded-[4px] border border-line bg-surface px-1.5 font-mono text-2xs outline-none focus:border-accent"
            />
            <select
              aria-label={`Source for ${r.target || `row ${i + 1}`}`}
              value={r.source ?? ""}
              onChange={(e) => upd(i, { source: e.target.value })}
              className="h-7 min-w-0 rounded-[4px] border border-line bg-surface px-1 text-2xs outline-none focus:border-accent"
            >
              <option value="">Auto-detect</option>
              {[...new Set([...(r.source ? [r.source] : []), ...columns])].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="checkbox"
              aria-label={`${r.target} required`}
              checked={r.required !== false}
              onChange={(e) => upd(i, { required: e.target.checked })}
              className="size-3.5 accent-[var(--accent)]"
            />
            <button
              type="button"
              aria-label={`Remove ${r.target || "mapping"}`}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="flex size-6 items-center justify-center rounded text-subtle hover:text-error"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="self-start"
        onClick={() => onChange([...value, { target: "", source: "", required: true }])}
      >
        <Plus />
        Add mapping
      </Button>
      {f.help && <p className="text-2xs text-muted">{f.help}</p>}
    </div>
  );
}

type Cond = { column: string; op: string; value?: string; type?: string };

function ConditionsField({ f, value, onChange, listId }: { f: FieldSpec; value: Cond[]; onChange: (v: unknown) => void; listId: string }) {
  const upd = (i: number, patch: Partial<Cond>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-2">{f.label}</span>
      {value.map((c, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto] gap-1.5 rounded-[var(--radius-sm)] border border-line p-2">
          <div className="grid grid-cols-2 gap-1.5">
            <input
              list={listId}
              aria-label={`Condition ${i + 1} column`}
              placeholder="Column"
              value={c.column}
              onChange={(e) => upd(i, { column: e.target.value })}
              className="h-7 rounded-[4px] border border-line px-1.5 text-xs outline-none focus:border-accent"
            />
            <select
              aria-label={`Condition ${i + 1} operator`}
              value={c.op}
              onChange={(e) => upd(i, { op: e.target.value })}
              className="h-7 rounded-[4px] border border-line px-1 text-xs"
            >
              {OPS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            {!["is_blank", "not_blank"].includes(c.op) && (
              <input
                aria-label={`Condition ${i + 1} value`}
                placeholder="Value"
                value={c.value ?? ""}
                onChange={(e) => upd(i, { value: e.target.value })}
                className="h-7 rounded-[4px] border border-line px-1.5 text-xs outline-none focus:border-accent"
              />
            )}
            <select
              aria-label={`Condition ${i + 1} type`}
              value={c.type ?? "text"}
              onChange={(e) => upd(i, { type: e.target.value })}
              className="h-7 rounded-[4px] border border-line px-1 text-xs"
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
            </select>
          </div>
          <button
            type="button"
            aria-label={`Remove condition ${i + 1}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            className="flex size-7 items-center justify-center rounded text-subtle hover:text-error"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="self-start"
        onClick={() => onChange([...value, { column: "", op: "equals", value: "", type: "text" }])}
      >
        <Plus />
        Add condition
      </Button>
    </div>
  );
}
