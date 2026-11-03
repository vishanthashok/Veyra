"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, RotateCcw, UploadCloud } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ErrorBox, PageHeader, Stepper } from "@/components/app/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Field, Select } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ApiError, api, errorText, type CommitResult, type ImportBatch, type ImportPreview, type RejectedRow } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { cn, fmtDateTime, idemKey } from "@/lib/utils";
import { crumbs, useProperty } from "../context";

const KINDS = {
  gl: { label: "General ledger", hint: "Account, date, amount. One row per transaction. CSV or XLSX export from your accounting system." },
  billings: { label: "Tenant CAM billings", hint: "Tenant name or suite, bill date, amount. Estimates billed during the year." },
  lease_rules: { label: "Lease-rule spreadsheet", hint: "One row per tenant pool. Imported rules are drafts until approved." },
} as const;
type Kind = keyof typeof KINDS;
const STEPS = ["Import type", "Upload", "Map columns", "Validate", "Confirm", "Done"];
const FIELD_LABELS: Record<string, string> = {
  gl_account: "GL account", txn_date: "Transaction date", amount: "Amount", account_name: "Account name", vendor: "Vendor",
  description: "Description", tenant: "Tenant (name or suite)", bill_date: "Bill date", rule_ref: "Rule reference", pool: "Pool", method: "Method",
};

export default function ImportPage() {
  const ctx = useProperty();
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
    setStep(0); setFile(null); setPreview(null); setMap({}); setCheck(null); setResult(null); setAllowDup(false); setErr(null); setFailed(false);
    uploadKey.current = idemKey("upload");
  }

  async function upload() {
    if (!file) return;
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", file);
    setBusy(true); setErr(null);
    try {
      const p = await api.post<ImportPreview>(`/properties/${pid}/imports`, fd, { idempotencyKey: uploadKey.current });
      setPreview(p); setMap(p.suggested_map); setStep(2);
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  }

  const cleanMap = () => Object.fromEntries(Object.entries(map).filter(([, v]) => v));
  const missingRequired = preview ? preview.required_fields.filter((f) => !map[f]) : [];

  async function validate() {
    if (!preview) return;
    setBusy(true); setErr(null);
    try {
      setCheck(await api.post<CommitResult>(`/imports/${preview.batch.id}/validate`, { column_map: cleanMap() }));
      setStep(3);
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true); setErr(null); setFailed(false);
    try {
      const r = await api.post<CommitResult>(`/imports/${preview.batch.id}/commit`, { column_map: cleanMap(), allow_duplicate_file: allowDup });
      setResult(r); setStep(5); history.reload();
      toast.success(`Imported ${r.batch.accepted_count} rows`);
    } catch (x) {
      setErr(errorText(x));
      if (x instanceof ApiError && x.status >= 500) setFailed(true);
      history.reload();
    } finally { setBusy(false); }
  }

  const dupWarning = preview?.warnings.some((w) => w.includes("identical file"));

  return (
    <>
      <PageHeader title="Data import" crumbs={crumbs(ctx, "Data import")}
        description="Original files are stored unchanged. Every committed row keeps its file and row number. Nothing is written until you confirm." />

      <Panel className="mb-6">
        <div className="border-b border-line px-4 py-3"><Stepper steps={STEPS} current={step} /></div>
        <PanelBody>
          <ErrorBox error={err} />

          {step === 0 && (
            <div className="space-y-4">
              <p className="text-sm text-ink-2">Importing into <b>{ctx.property.name}</b>. Use the property switcher in the sidebar to change property.</p>
              <fieldset className="grid gap-3 md:grid-cols-3">
                <legend className="sr-only">Import type</legend>
                {(Object.keys(KINDS) as Kind[]).map((k) => (
                  <label key={k} className={cn("flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors",
                    kind === k ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-line hover:border-line-strong")}>
                    <span className="flex items-center gap-2 text-sm font-medium"><input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="accent-[var(--accent)]" />{KINDS[k].label}</span>
                    <span className="text-xs text-muted">{KINDS[k].hint}</span>
                  </label>
                ))}
              </fieldset>
              <Button variant="primary" onClick={() => setStep(1)}>Continue</Button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <DropZone file={file} onFile={setFile} />
              <div className="flex gap-2">
                <Button onClick={() => setStep(0)}>Back</Button>
                <Button variant="primary" disabled={!file} loading={busy} onClick={upload}>Upload and preview</Button>
              </div>
            </div>
          )}

          {step === 2 && preview && (
            <div className="space-y-5">
              {preview.warnings.map((w) => <div key={w} className="flex gap-2 rounded-md border border-warning-line bg-warning-bg px-3 py-2 text-sm text-warning"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{w}</div>)}
              <div>
                <h3 className="mb-1 text-sm font-semibold">Map columns</h3>
                <p className="mb-3 text-xs text-muted">Suggestions are based on header names. Check each one. Required fields are marked.</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[...preview.required_fields, ...preview.optional_fields].map((f) => (
                    <Field key={f} label={FIELD_LABELS[f] ?? f.replace(/_/g, " ")} required={preview.required_fields.includes(f)}
                      error={preview.required_fields.includes(f) && !map[f] ? "Required" : null}>
                      <Select value={map[f] ?? ""} onChange={(e) => setMap({ ...map, [f]: e.target.value })}>
                        <option value="">Not mapped</option>{preview.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                      </Select>
                    </Field>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Preview <span className="font-normal text-muted">· first {preview.rows.length} of {preview.batch.row_count} rows · {preview.batch.filename}</span></h3>
                <div className="max-h-80 overflow-auto rounded-md border border-line">
                  <Table>
                    <THead><TR><TH className="sticky top-0 bg-surface-2">Row</TH>{preview.columns.map((c) => <TH key={c} className="sticky top-0 bg-surface-2">{c}{Object.entries(map).find(([, v]) => v === c) && <Badge tone="accent" className="ml-1 normal-case">{FIELD_LABELS[Object.entries(map).find(([, v]) => v === c)![0]] ?? Object.entries(map).find(([, v]) => v === c)![0]}</Badge>}</TH>)}</TR></THead>
                    <TBody>{preview.rows.map((r, i) => <TR key={i}><TD className="tabular text-muted">{i + 2}</TD>{preview.columns.map((c) => <TD key={c} className="whitespace-nowrap">{r[c]}</TD>)}</TR>)}</TBody>
                  </Table>
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={reset}>Start over</Button>
                <Button variant="primary" disabled={missingRequired.length > 0} loading={busy} onClick={validate}>Validate rows</Button>
              </div>
            </div>
          )}

          {step === 3 && check && preview && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Summary label="Rows in file" value={preview.batch.row_count} />
                <Summary label="Will be imported" value={check.batch.accepted_count} tone="success" />
                <Summary label="Will be rejected" value={check.batch.rejected_rows.length} tone={check.batch.rejected_rows.length ? "error" : undefined} />
              </div>
              {check.warnings.length > 0 && (
                <div className="rounded-md border border-warning-line bg-warning-bg px-3 py-2 text-sm text-warning">
                  <div className="mb-1 font-semibold">{check.warnings.length} warning{check.warnings.length > 1 ? "s" : ""}</div>
                  <ul className="list-disc space-y-0.5 pl-5">{check.warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}</ul>
                  {check.warnings.length > 8 && <p className="mt-1">and {check.warnings.length - 8} more.</p>}
                </div>
              )}
              {check.batch.rejected_rows.length > 0 && <RejectedTable rows={check.batch.rejected_rows} />}
              <p className="text-sm text-muted">Rejected rows are not imported. They stay on the import record so you can download and fix them.</p>
              <div className="flex gap-2">
                <Button onClick={() => setStep(2)}>Back to mapping</Button>
                <Button variant="primary" onClick={() => setStep(4)} disabled={check.batch.accepted_count === 0}>Continue</Button>
              </div>
            </div>
          )}

          {step === 4 && check && preview && (
            <div className="max-w-xl space-y-4">
              <h3 className="text-sm font-semibold">Confirm import</h3>
              <dl className="grid grid-cols-[160px_1fr] gap-y-1.5 text-sm">
                <dt className="text-muted">Property</dt><dd>{ctx.property.name}</dd>
                <dt className="text-muted">Type</dt><dd>{KINDS[kind].label}</dd>
                <dt className="text-muted">File</dt><dd className="break-all">{preview.batch.filename}</dd>
                <dt className="text-muted">Fingerprint</dt><dd className="font-mono text-xs">{preview.batch.sha256.slice(0, 16)}</dd>
                <dt className="text-muted">Rows to import</dt><dd className="font-semibold tabular">{check.batch.accepted_count}</dd>
                <dt className="text-muted">Rows rejected</dt><dd className="tabular">{check.batch.rejected_rows.length}</dd>
              </dl>
              {dupWarning && (
                <label className="flex items-start gap-2 rounded-md border border-warning-line bg-warning-bg px-3 py-2 text-sm text-warning">
                  <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={allowDup} onChange={(e) => setAllowDup(e.target.checked)} />
                  This exact file was already imported. I understand importing it again duplicates every row.
                </label>
              )}
              <p className="text-sm text-muted">The commit is all-or-nothing. If anything fails, nothing is written and you can retry.</p>
              <div className="flex gap-2">
                <Button onClick={() => setStep(3)}>Back</Button>
                <Button variant="primary" loading={busy} disabled={!!dupWarning && !allowDup} onClick={commit}>
                  {failed ? <><RotateCcw />Retry import</> : `Import ${check.batch.accepted_count} rows`}
                </Button>
              </div>
            </div>
          )}

          {step === 5 && result && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-success"><CheckCircle2 className="size-5" /><span className="font-semibold">Import committed</span></div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Summary label="Imported" value={result.batch.accepted_count} tone="success" />
                <Summary label="Rejected" value={result.batch.rejected_rows.length} tone={result.batch.rejected_rows.length ? "error" : undefined} />
                <Summary label="Warnings" value={result.warnings.length} tone={result.warnings.length ? "warning" : undefined} />
              </div>
              {result.warnings.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-sm text-warning">{result.warnings.slice(0, 10).map((w, i) => <li key={i}>{w}</li>)}</ul>}
              <div className="flex flex-wrap gap-2">
                {result.batch.rejected_rows.length > 0 && <a className={buttonVariants()} href={`/api/v1/imports/${result.batch.id}/errors.csv`}><Download />Download error report</a>}
                <Button variant="primary" onClick={reset}>Import another file</Button>
                <Link className={buttonVariants({ variant: "ghost" })} href={`${ctx.base}/${kind === "gl" ? "mapping" : kind === "lease_rules" ? "rules" : "audit"}`}>
                  {kind === "gl" ? "Review GL mappings" : kind === "lease_rules" ? "Approve lease rules" : "Go to audit"}
                </Link>
              </div>
            </div>
          )}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Import history" description="Each import keeps its original file, fingerprint, parser version and rejected rows." />
        <HistoryTable rows={history.data ?? []} loading={history.loading} />
      </Panel>
    </>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone?: "success" | "error" | "warning" }) {
  return (
    <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className={cn("text-xl font-semibold tabular-nums", tone === "success" && "text-success", tone === "error" && "text-error", tone === "warning" && "text-warning")}>{value}</div>
    </div>
  );
}

function DropZone({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  function take(f: File | undefined) {
    if (!f) return;
    if (!/\.(csv|xlsx)$/i.test(f.name)) { setErr("Only .csv and .xlsx files are accepted."); return; }
    if (f.size > 10 * 1024 * 1024) { setErr("File is larger than 10 MB."); return; }
    setErr(null); onFile(f);
  }
  return (
    <div>
      <div
        role="button" tabIndex={0} aria-label="Choose a file to upload, or drop it here"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); }}
        className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
          over ? "border-accent bg-accent-soft" : "border-line-strong bg-surface-2 hover:border-accent/60")}
      >
        {file ? <FileSpreadsheet className="size-8 text-accent" aria-hidden /> : <UploadCloud className="size-8 text-subtle" aria-hidden />}
        {file ? <><div className="text-sm font-medium">{file.name}</div><div className="text-xs text-muted">{(file.size / 1024).toFixed(1)} KB · click to choose another file</div></> :
          <><div className="text-sm font-medium">Drop a CSV or XLSX file here, or click to browse</div><div className="text-xs text-muted">Up to 10 MB. The first worksheet is read.</div></>}
        <input ref={input} type="file" accept=".csv,.xlsx" className="sr-only" tabIndex={-1} onChange={(e) => take(e.target.files?.[0])} />
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-error">{err}</p>}
    </div>
  );
}

function RejectedTable({ rows }: { rows: RejectedRow[] }) {
  const cols = useMemo<ColumnDef<RejectedRow, unknown>[]>(() => [
    { accessorKey: "row", header: "Source row", meta: { align: "right", cellClassName: "w-24" } },
    { id: "errors", header: "Errors", accessorFn: (r) => r.errors.join("; "), cell: ({ getValue }) => <span className="text-error">{getValue() as string}</span> },
    { id: "values", header: "Values", accessorFn: (r) => Object.entries(r.values).map(([k, v]) => `${k}=${v}`).join(", "), cell: ({ getValue }) => <span className="font-mono text-xs text-ink-2">{getValue() as string}</span> },
  ], []);
  return (
    <div className="rounded-md border border-line">
      <DataTable caption="Rejected rows" data={rows} columns={cols} getRowId={(r) => String(r.row)} pageSize={20} searchPlaceholder="Search rejected rows" exportName="rejected-rows" compact />
    </div>
  );
}

function HistoryTable({ rows, loading }: { rows: ImportBatch[]; loading: boolean }) {
  const cols = useMemo<ColumnDef<ImportBatch, unknown>[]>(() => [
    { accessorKey: "created_at", header: "Uploaded", cell: ({ getValue }) => <span className="whitespace-nowrap">{fmtDateTime(getValue() as string)}</span> },
    { accessorKey: "kind", header: "Type", cell: ({ getValue }) => KINDS[getValue() as Kind]?.label ?? (getValue() as string) },
    { accessorKey: "filename", header: "File", cell: ({ row }) => <div><div className="max-w-72 truncate">{row.original.filename}</div><div className="font-mono text-2xs text-muted">{row.original.sha256.slice(0, 12)} · parser v{row.original.parser_version}</div></div> },
    { accessorKey: "status", header: "Status", cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { accessorKey: "row_count", header: "Rows", meta: { align: "right" } },
    { accessorKey: "accepted_count", header: "Imported", meta: { align: "right" } },
    { id: "rejected", header: "Rejected", accessorFn: (r) => r.rejected_rows.length, meta: { align: "right" },
      cell: ({ row }) => row.original.rejected_rows.length ? <a className="font-medium text-error hover:underline" href={`/api/v1/imports/${row.original.id}/errors.csv`}>{row.original.rejected_rows.length} · CSV</a> : <span className="text-muted">0</span> },
  ], []);
  return <DataTable caption="Import history" data={rows} columns={cols} getRowId={(r) => r.id} loading={loading} facets={[{ columnId: "status", label: "Status" }]}
    initialSorting={[{ id: "created_at", desc: true }]} pageSize={20} empty="No imports yet." />;
}
