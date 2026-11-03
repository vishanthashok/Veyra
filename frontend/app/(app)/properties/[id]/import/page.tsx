"use client";
import type { ColumnDef } from "@tanstack/react-table";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  RotateCcw,
  UploadCloud,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app/app-context";
import { ErrorBox, PageHeader, SectionHeader, Stepper } from "@/components/app/page";
import { StatusBadge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Segmented, Select } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { ApiError, type CommitResult, type ImportBatch, type ImportPreview, type RejectedRow, api, errorText } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { cn, fmtDateTime, idemKey } from "@/lib/utils";
import { crumbs, useProperty } from "../context";

const KINDS = {
  gl: {
    label: "General ledger",
    short: "GL",
    hint: "One row per transaction, exported from your accounting system.",
    columns: ["Account", "Date", "Amount", "Account name (optional)", "Vendor (optional)", "Memo (optional)"],
  },
  billings: {
    label: "Tenant billings",
    short: "Billings",
    hint: "CAM estimates billed during the year. Tenants are matched by name or suite.",
    columns: ["Tenant name or suite", "Bill date", "Amount", "Description (optional)"],
  },
  lease_rules: {
    label: "Lease rules",
    short: "Rules",
    hint: "One row per tenant pool. Imported rules are drafts until approved.",
    columns: ["Rule ref", "Tenant", "Pool", "Method", "Denominator or fixed %", "Caps, base year, fees (optional)"],
  },
} as const;
type Kind = keyof typeof KINDS;

const STEPS = ["Upload", "Map columns", "Validate", "Review", "Confirm"];
const FIELD_LABELS: Record<string, string> = {
  gl_account: "GL account",
  txn_date: "Transaction date",
  amount: "Amount",
  account_name: "Account name",
  vendor: "Vendor",
  description: "Description",
  tenant: "Tenant (name or suite)",
  bill_date: "Bill date",
  rule_ref: "Rule reference",
  pool: "Pool",
  method: "Method",
};
const HELP: string[] = [
  "Files are stored unchanged with a fingerprint. Nothing is written to your data until the final step.",
  "Suggestions come from header names. Check every required field. Each mapped column is highlighted in the preview.",
  "Validation is a dry run: it shows exactly which rows would be imported and why others would be rejected.",
  "Rejected rows are not imported but stay on the import record, so you can download, fix and re-import them.",
  "The commit is all or nothing. If anything fails, nothing is written and you can retry.",
];
const letter = (i: number) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : "");

export default function ImportPage() {
  const ctx = useProperty();
  const { reloadReadiness } = useApp();
  const pid = ctx.property.id;
  const history = useLoad(() => api.get<ImportBatch[]>(`/properties/${pid}/imports`), [pid]);
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<Kind>("gl");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [check, setCheck] = useState<CommitResult | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [allowDup, setAllowDup] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const uploadKey = useRef<string>(idemKey("upload"));

  function reset() {
    setStep(0);
    setFile(null);
    setPreview(null);
    setMap({});
    setCheck(null);
    setResult(null);
    setAllowDup(false);
    setErr(null);
    setFailed(false);
    uploadKey.current = idemKey("upload");
  }

  async function upload() {
    if (!file) return;
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", file);
    setBusy(true);
    setErr(null);
    try {
      const p = await api.post<ImportPreview>(`/properties/${pid}/imports`, fd, { idempotencyKey: uploadKey.current });
      setPreview(p);
      setMap(p.suggested_map);
      setStep(1);
    } catch (x) {
      setErr(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  const cleanMap = () => Object.fromEntries(Object.entries(map).filter(([, v]) => v));
  const missingRequired = preview ? preview.required_fields.filter((f) => !map[f]) : [];

  async function validate() {
    if (!preview) return;
    setBusy(true);
    setErr(null);
    try {
      setCheck(await api.post<CommitResult>(`/imports/${preview.batch.id}/validate`, { column_map: cleanMap() }));
      setStep(2);
    } catch (x) {
      setErr(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    setErr(null);
    setFailed(false);
    try {
      const r = await api.post<CommitResult>(`/imports/${preview.batch.id}/commit`, {
        column_map: cleanMap(),
        allow_duplicate_file: allowDup,
      });
      setResult(r);
      history.reload();
      reloadReadiness();
      toast.success(`Imported ${r.batch.accepted_count} rows`);
    } catch (x) {
      setErr(errorText(x));
      if (x instanceof ApiError && x.status >= 500) setFailed(true);
      history.reload();
    } finally {
      setBusy(false);
    }
  }

  const dupWarning = preview?.warnings.some((w) => w.includes("identical file"));
  const mappedCol = (c: string) => Object.entries(map).find(([, v]) => v === c)?.[0];
  const rejectedByRow = useMemo(() => new Map((check?.batch.rejected_rows ?? []).map((r) => [r.row, r.errors])), [check]);

  return (
    <>
      <PageHeader
        title="Data imports"
        crumbs={crumbs(ctx, "Data imports")}
        description="Bring in the general ledger, tenant billings and lease rules. Original files are kept, and every row keeps its file and row number."
      />

      <Panel className="mb-10">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <Stepper steps={STEPS} current={result ? 5 : step} />
          {step > 0 && !result && (
            <Button size="xs" variant="ghost" onClick={reset}>
              <X />
              Cancel import
            </Button>
          )}
        </div>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 p-5">
            <ErrorBox error={err} />

            {step === 0 && (
              <div className="space-y-5">
                <div>
                  <div className="mb-2 text-xs font-medium text-ink-2">What are you importing?</div>
                  <Segmented
                    label="Import type"
                    value={kind}
                    onChange={setKind}
                    options={(Object.keys(KINDS) as Kind[]).map((k) => ({ value: k, label: KINDS[k].label }))}
                  />
                  <p className="mt-2 text-sm text-muted">{KINDS[kind].hint}</p>
                </div>
                <DropZone file={file} onFile={setFile} />
                <div className="flex justify-end">
                  <Button variant="primary" size="md" disabled={!file} loading={busy} onClick={upload}>
                    Upload and preview
                    <ArrowRight />
                  </Button>
                </div>
              </div>
            )}

            {step === 1 && preview && (
              <div className="space-y-5">
                {preview.warnings.map((w) => (
                  <div key={w} className="flex gap-2 rounded-[var(--radius-md)] bg-warning-bg px-3 py-2 text-sm text-warning">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    {w}
                  </div>
                ))}
                <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                  {[...preview.required_fields, ...preview.optional_fields].map((f) => {
                    const req = preview.required_fields.includes(f);
                    const sample = map[f] ? preview.rows[0]?.[map[f]] : "";
                    return (
                      <div key={f} className="flex items-center gap-3">
                        <label htmlFor={`map-${f}`} className="flex w-40 shrink-0 items-center gap-1.5 text-sm text-ink-2">
                          {map[f] ? (
                            <Check className="size-3.5 text-success" aria-hidden />
                          ) : (
                            <span className={cn("size-3.5 rounded-full border", req ? "border-error" : "border-line-strong")} aria-hidden />
                          )}
                          {FIELD_LABELS[f] ?? f.replace(/_/g, " ")}
                          {req && <span className="text-muted">*</span>}
                        </label>
                        <div className="min-w-0 flex-1">
                          <Select
                            id={`map-${f}`}
                            value={map[f] ?? ""}
                            aria-invalid={req && !map[f] ? true : undefined}
                            onChange={(e) => setMap({ ...map, [f]: e.target.value })}
                          >
                            <option value="">Not mapped</option>
                            {preview.columns.map((c, i) => (
                              <option key={c} value={c}>
                                {letter(i)} · {c}
                              </option>
                            ))}
                          </Select>
                          {sample !== "" && sample !== undefined && (
                            <div className="mt-0.5 truncate text-2xs text-muted">e.g. {sample}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <SheetPreview preview={preview} mappedCol={mappedCol} />
                <div className="flex justify-between">
                  <Button onClick={reset}>
                    <ArrowLeft />
                    Back
                  </Button>
                  <Button variant="primary" size="md" disabled={missingRequired.length > 0} loading={busy} onClick={validate}>
                    Validate rows
                    <ArrowRight />
                  </Button>
                </div>
              </div>
            )}

            {step === 2 && check && preview && (
              <div className="space-y-5">
                <Summary
                  items={[
                    ["Rows in file", preview.batch.row_count],
                    ["Will be imported", check.batch.accepted_count, "success"],
                    ["Will be rejected", check.batch.rejected_rows.length, check.batch.rejected_rows.length ? "error" : undefined],
                  ]}
                />
                {check.batch.rejected_rows.length > 0 ? (
                  <>
                    <p className="text-sm text-ink-2">
                      These rows have problems. Fix them in the file and re-upload, or continue without them.
                    </p>
                    <SheetPreview preview={preview} mappedCol={mappedCol} errors={rejectedByRow} onlyErrors />
                  </>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-success">
                    <CheckCircle2 className="size-4" />
                    Every row passed validation.
                  </p>
                )}
                <div className="flex justify-between">
                  <Button onClick={() => setStep(1)}>
                    <ArrowLeft />
                    Back to mapping
                  </Button>
                  <Button variant="primary" size="md" onClick={() => setStep(3)} disabled={check.batch.accepted_count === 0}>
                    Continue
                    <ArrowRight />
                  </Button>
                </div>
              </div>
            )}

            {step === 3 && check && preview && (
              <div className="space-y-5">
                <dl className="grid max-w-xl grid-cols-[160px_1fr] gap-y-2 text-sm">
                  <dt className="text-muted">Property</dt>
                  <dd>{ctx.property.name}</dd>
                  <dt className="text-muted">Type</dt>
                  <dd>{KINDS[kind].label}</dd>
                  <dt className="text-muted">File</dt>
                  <dd className="break-all">{preview.batch.filename}</dd>
                  <dt className="text-muted">Fingerprint</dt>
                  <dd className="font-mono text-xs">{preview.batch.sha256.slice(0, 16)}</dd>
                  <dt className="text-muted">Rows to import</dt>
                  <dd className="font-semibold tabular">{check.batch.accepted_count}</dd>
                  <dt className="text-muted">Rows rejected</dt>
                  <dd className="tabular">{check.batch.rejected_rows.length}</dd>
                </dl>
                {check.warnings.length > 0 && (
                  <div className="rounded-[var(--radius-md)] bg-warning-bg px-3.5 py-2.5 text-sm text-warning">
                    <div className="mb-1 font-medium">
                      {check.warnings.length} warning{check.warnings.length > 1 ? "s" : ""} to note
                    </div>
                    <ul className="list-disc space-y-0.5 pl-5">
                      {check.warnings.slice(0, 6).map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                    {check.warnings.length > 6 && <p className="mt-1">and {check.warnings.length - 6} more.</p>}
                  </div>
                )}
                {dupWarning && (
                  <label className="flex items-start gap-2 rounded-[var(--radius-md)] bg-warning-bg px-3.5 py-2.5 text-sm text-warning">
                    <input
                      type="checkbox"
                      className="mt-1 accent-[var(--accent)]"
                      checked={allowDup}
                      onChange={(e) => setAllowDup(e.target.checked)}
                    />
                    This exact file was already imported. I understand importing it again duplicates every row.
                  </label>
                )}
                <div className="flex justify-between">
                  <Button onClick={() => setStep(2)}>
                    <ArrowLeft />
                    Back
                  </Button>
                  <Button variant="primary" size="md" onClick={() => setStep(4)} disabled={!!dupWarning && !allowDup}>
                    Continue to confirm
                    <ArrowRight />
                  </Button>
                </div>
              </div>
            )}

            {step === 4 && check && preview && !result && (
              <div className="flex flex-col items-start gap-4">
                <div>
                  <h3 className="text-lg font-semibold">
                    Import {check.batch.accepted_count} rows into {ctx.property.name}?
                  </h3>
                  <p className="mt-1 text-sm text-muted">
                    {KINDS[kind].label} from {preview.batch.filename}. All rows are written together, or none are.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => setStep(3)}>
                    <ArrowLeft />
                    Back
                  </Button>
                  <Button variant="primary" size="md" loading={busy} onClick={commit}>
                    {failed ? (
                      <>
                        <RotateCcw />
                        Retry import
                      </>
                    ) : (
                      `Import ${check.batch.accepted_count} rows`
                    )}
                  </Button>
                </div>
              </div>
            )}

            {result && (
              <div className="space-y-5">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 items-center justify-center rounded-full bg-success-bg text-success">
                    <CheckCircle2 className="size-5" />
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold">Import committed</h3>
                    <p className="text-sm text-muted">
                      {result.batch.accepted_count} rows written from {result.batch.filename}.
                    </p>
                  </div>
                </div>
                <Summary
                  items={[
                    ["Imported", result.batch.accepted_count, "success"],
                    ["Rejected", result.batch.rejected_rows.length, result.batch.rejected_rows.length ? "error" : undefined],
                    ["Warnings", result.warnings.length, result.warnings.length ? "warning" : undefined],
                  ]}
                />
                <div className="flex flex-wrap gap-2">
                  <Link
                    className={buttonVariants({ variant: "primary", size: "md" })}
                    href={`${ctx.base}/${kind === "gl" ? "mapping" : kind === "lease_rules" ? "rules" : "audit"}`}
                  >
                    {kind === "gl" ? "Classify GL accounts" : kind === "lease_rules" ? "Review lease rules" : "Go to audit"}
                    <ArrowRight />
                  </Link>
                  {result.batch.rejected_rows.length > 0 && (
                    <a className={buttonVariants({ size: "md" })} href={`/api/v1/imports/${result.batch.id}/errors.csv`}>
                      <Download />
                      Rejected rows (CSV)
                    </a>
                  )}
                  <Button size="md" variant="ghost" onClick={reset}>
                    Import another file
                  </Button>
                </div>
              </div>
            )}
          </div>

          <aside className="border-t border-line bg-surface-2/60 p-5 lg:border-l lg:border-t-0" aria-label="Help">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
              <Info className="size-3.5" aria-hidden />
              {result ? "Done" : `Step ${step + 1} of ${STEPS.length}`}
            </div>
            <p className="text-sm text-ink-2">
              {result ? "Next, review the data you imported. Re-run the audit once mappings and rules are reviewed." : HELP[step]}
            </p>
            <div className="mt-5 text-xs font-medium text-muted">Expected columns · {KINDS[kind].label}</div>
            <ul className="mt-2 space-y-1 text-sm text-ink-2">
              {KINDS[kind].columns.map((c) => (
                <li key={c} className="flex items-center gap-2">
                  <span className="size-1 rounded-full bg-subtle" aria-hidden />
                  {c}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted">
              CSV (UTF-8) or XLSX up to 10 MB. Dates as YYYY-MM-DD or MM/DD/YYYY. Amounts with up to 2 decimals.
            </p>
          </aside>
        </div>
      </Panel>

      <SectionHeader
        title="Import history"
        count={history.data?.length}
        description="Each import keeps its original file, fingerprint, parser version and rejected rows."
      />
      <Panel>
        <HistoryTable rows={history.data ?? []} loading={history.loading} />
      </Panel>
    </>
  );
}

function Summary({ items }: { items: [string, number, ("success" | "error" | "warning")?][] }) {
  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[var(--radius-md)] border border-line bg-line">
      {items.map(([label, value, tone]) => (
        <div key={label} className="bg-surface px-4 py-3">
          <div className="text-xs text-muted">{label}</div>
          <div
            className={cn(
              "mt-0.5 text-xl font-semibold tabular-nums",
              tone === "success" && "text-success",
              tone === "error" && "text-error",
              tone === "warning" && "text-warning",
            )}
          >
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Spreadsheet-style preview: column letters, row numbers, mapped columns highlighted, errors inline. */
function SheetPreview({
  preview,
  mappedCol,
  errors,
  onlyErrors,
}: {
  preview: ImportPreview;
  mappedCol: (c: string) => string | undefined;
  errors?: Map<number, string[]>;
  onlyErrors?: boolean;
}) {
  const rows = preview.rows.map((r, i) => ({ r, n: i + 2 })).filter(({ n }) => !onlyErrors || errors?.has(n));
  const hiddenErrors = onlyErrors && errors ? [...errors.keys()].filter((n) => n > preview.rows.length + 1).length : 0;
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-line">
      <div className="scroll-quiet max-h-80 overflow-auto">
        <table className="w-full border-collapse font-mono text-xs">
          <caption className="sr-only">File preview</caption>
          <thead className="sticky top-0 z-[1]">
            <tr className="bg-surface-2 text-2xs text-muted">
              <th scope="col" className="w-10 border-b border-r border-line px-2 py-1 font-normal" aria-label="Row" />
              {preview.columns.map((c, i) => (
                <th
                  key={c}
                  scope="col"
                  className={cn(
                    "border-b border-r border-line px-2 py-1 text-center font-normal",
                    mappedCol(c) && "bg-accent-soft text-accent",
                  )}
                >
                  {letter(i)}
                </th>
              ))}
              {errors && (
                <th scope="col" className="border-b border-line px-2 py-1 text-left font-sans font-normal">
                  Problem
                </th>
              )}
            </tr>
            <tr className="bg-surface font-sans">
              <th className="border-b border-r border-line px-2 py-1.5 text-2xs font-normal text-muted">1</th>
              {preview.columns.map((c) => {
                const f = mappedCol(c);
                return (
                  <th
                    key={c}
                    className={cn(
                      "whitespace-nowrap border-b border-r border-line px-2 py-1.5 text-left font-medium",
                      f ? "bg-accent-soft/60 text-ink" : "text-muted",
                    )}
                  >
                    {c}
                    {f && <div className="text-2xs font-normal text-accent">→ {FIELD_LABELS[f] ?? f}</div>}
                  </th>
                );
              })}
              {errors && <th className="border-b border-line" />}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, n }) => {
              const e = errors?.get(n);
              return (
                <tr key={n} className={cn(e && "bg-error-bg/60")}>
                  <td className="border-b border-r border-line px-2 py-1 text-center text-2xs text-muted">{n}</td>
                  {preview.columns.map((c) => (
                    <td key={c} className={cn("whitespace-nowrap border-b border-r border-line px-2 py-1", !mappedCol(c) && "text-muted")}>
                      {r[c]}
                    </td>
                  ))}
                  {errors && <td className="min-w-64 border-b border-line px-2 py-1 font-sans text-error">{e?.join("; ")}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line bg-surface-2 px-3 py-1.5 text-2xs text-muted">
        {onlyErrors
          ? `${errors?.size ?? 0} row${errors?.size === 1 ? "" : "s"} with problems${hiddenErrors ? `, ${hiddenErrors} beyond the preview (see the rejected rows file after import)` : ""}`
          : `Showing ${preview.rows.length} of ${preview.batch.row_count} rows · ${preview.batch.filename}`}
      </div>
    </div>
  );
}

function DropZone({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  function take(f: File | undefined) {
    if (!f) return;
    if (!/\.(csv|xlsx)$/i.test(f.name)) {
      setErr("Only .csv and .xlsx files are accepted.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setErr("File is larger than 10 MB.");
      return;
    }
    setErr(null);
    onFile(f);
  }
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Choose a file to upload, or drop it here"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed px-6 py-12 text-center outline-none transition-colors duration-[var(--dur-fast)] focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]",
          over ? "border-accent bg-accent-soft" : "border-line-strong bg-surface-2/50 hover:border-[#bdbcb5] hover:bg-surface-2",
        )}
      >
        {file ? (
          <>
            <FileSpreadsheet className="size-7 text-accent" aria-hidden />
            <div className="text-sm font-medium">{file.name}</div>
            <div className="text-xs text-muted">{(file.size / 1024).toFixed(1)} KB · click to choose another file</div>
          </>
        ) : (
          <>
            <UploadCloud className="size-7 text-subtle" aria-hidden />
            <div className="text-sm font-medium text-ink">Drop a file here, or click to browse</div>
            <div className="text-xs text-muted">CSV or XLSX up to 10 MB. The first worksheet is read.</div>
          </>
        )}
        <input ref={input} type="file" accept=".csv,.xlsx" className="sr-only" tabIndex={-1} onChange={(e) => take(e.target.files?.[0])} />
      </div>
      {err && (
        <p role="alert" className="mt-2 text-sm text-error">
          {err}
        </p>
      )}
    </div>
  );
}

function HistoryTable({ rows, loading }: { rows: ImportBatch[]; loading: boolean }) {
  const cols = useMemo<ColumnDef<ImportBatch, unknown>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: "Uploaded",
        cell: ({ getValue }) => <span className="whitespace-nowrap text-ink-2">{fmtDateTime(getValue() as string)}</span>,
      },
      { accessorKey: "kind", header: "Type", cell: ({ getValue }) => KINDS[getValue() as Kind]?.label ?? (getValue() as string) },
      {
        accessorKey: "filename",
        header: "File",
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="max-w-72 truncate">{row.original.filename}</div>
            <div className="font-mono text-2xs text-muted">
              {row.original.sha256.slice(0, 12)} · parser v{row.original.parser_version}
            </div>
          </div>
        ),
      },
      { accessorKey: "status", header: "Status", cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
      { accessorKey: "row_count", header: "Rows", meta: { align: "right" } },
      { accessorKey: "accepted_count", header: "Imported", meta: { align: "right" } },
      {
        id: "rejected",
        header: "Rejected",
        accessorFn: (r) => r.rejected_rows.length,
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.rejected_rows.length ? (
            <a className="font-medium text-error hover:underline" href={`/api/v1/imports/${row.original.id}/errors.csv`}>
              {row.original.rejected_rows.length} · CSV
            </a>
          ) : (
            <span className="text-muted">0</span>
          ),
      },
    ],
    [],
  );
  return (
    <DataTable
      caption="Import history"
      data={rows}
      columns={cols}
      getRowId={(r) => r.id}
      loading={loading}
      noToolbar={rows.length < 8}
      facets={[{ columnId: "status", label: "Status" }]}
      initialSorting={[{ id: "created_at", desc: true }]}
      pageSize={20}
      empty="No imports yet."
    />
  );
}

export type { RejectedRow };
