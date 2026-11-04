"use client";
import { FileSpreadsheet, Play, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { errorText, api } from "@/lib/api";
import { cn, idemKey } from "@/lib/utils";
import { type Definition, type RunDetail, type UploadedFile, uploadFile } from "@/lib/workflows";
import { DataPreview } from "./data-preview";

type Prior = { node: string; file_id: string; filename: string }[];

/** Ask for one file per spreadsheet-upload step, preview it, then start the run. */
export function RunDialog({
  open,
  onOpenChange,
  workflowId,
  definition,
  prior,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workflowId: string;
  definition: Definition;
  prior?: Prior;
  onStarted: (run: RunDetail) => void;
}) {
  const uploads = definition.nodes.filter((n) => n.type === "spreadsheet_upload");
  const [files, setFiles] = useState<Record<string, UploadedFile | { id: string; filename: string; reused: true }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const keyRef = useRef(idemKey("wf-run"));

  const ready = uploads.every((n) => files[n.id]);

  async function pick(nodeId: string, f: File | undefined) {
    if (!f) return;
    setBusy(nodeId);
    setErr(null);
    try {
      const up = await uploadFile(f);
      setFiles((s) => ({ ...s, [nodeId]: up }));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    setStarting(true);
    setErr(null);
    try {
      const inputs = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.id]));
      const run = await api.post<RunDetail>(`/workflows/${workflowId}/runs`, { inputs }, { idempotencyKey: keyRef.current });
      keyRef.current = idemKey("wf-run");
      setFiles({});
      onOpenChange(false);
      toast.success(uploads.length ? "Run started" : "Run started with Veyra data");
      onStarted(run);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Run workflow"
        description={
          uploads.length
            ? "Choose a CSV or XLSX file for each input. Files are stored unchanged and referenced by SHA-256 in the run record."
            : "This workflow reads Veyra property data only. Nothing is written back to the property."
        }
        className="max-w-2xl"
        footer={
          <>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" onClick={start} disabled={!ready} loading={starting}>
              <Play />
              Run now
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {uploads.map((n) => {
            const f = files[n.id];
            const prev = prior?.find((p) => p.node === n.id);
            const label = String(n.config.input_label || n.label);
            return (
              <section key={n.id} aria-label={label} className="rounded-[var(--radius-md)] border border-line">
                <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <FileSpreadsheet className="size-4 text-subtle" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">{label}</div>
                    <div className="truncate text-xs text-muted">
                      {f
                        ? `${f.filename}${"size_bytes" in f ? ` · ${(f.size_bytes / 1024).toFixed(1)} KB · ${f.preview.row_count.toLocaleString()} rows` : " · same file as the previous run"}`
                        : "No file chosen"}
                    </div>
                  </div>
                  {prev && !f && (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setFiles((s) => ({ ...s, [n.id]: { id: prev.file_id, filename: prev.filename, reused: true } }))}
                    >
                      Reuse {prev.filename}
                    </Button>
                  )}
                  {f && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove file for ${label}`}
                      onClick={() => setFiles((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== n.id)))}
                    >
                      <X />
                    </Button>
                  )}
                  <label className={cn("inline-flex", busy === n.id && "pointer-events-none opacity-60")}>
                    <input
                      type="file"
                      accept=".csv,.xlsx"
                      className="peer sr-only"
                      aria-label={`File for ${label}`}
                      onChange={(e) => {
                        pick(n.id, e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    <span className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] border border-line-strong bg-surface px-2.5 text-xs font-medium text-ink shadow-xs peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)] hover:bg-surface-2">
                      <Upload className="size-3.5" aria-hidden />
                      {busy === n.id ? "Uploading…" : f ? "Replace" : "Choose file"}
                    </span>
                  </label>
                </div>
                {f && "preview" in f && (
                  <div className="border-t border-line">
                    {f.sheets.length > 1 && (
                      <p className="px-3 pt-2 text-2xs text-muted">
                        Sheets: {f.sheets.join(", ")}. The step reads {String(n.config.sheet || f.sheets[0])}.
                      </p>
                    )}
                    <DataPreview
                      data={{ ...f.preview, rows: f.preview.rows.slice(0, 6) }}
                      maxHeight="180px"
                      caption={`Preview of ${f.filename}`}
                    />
                  </div>
                )}
              </section>
            );
          })}
          {err && (
            <p role="alert" className="text-sm text-error">
              {err}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
