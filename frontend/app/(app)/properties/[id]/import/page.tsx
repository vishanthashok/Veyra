"use client";
import { useState } from "react";
import { Empty, ErrorBox } from "@/components/common";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Select } from "@/components/ui/input";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { api, type ImportBatch, type ImportPreview } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { useProperty } from "../context";

const KINDS = { gl: "General ledger", billings: "Tenant CAM billings", lease_rules: "Lease-rule spreadsheet" };

export default function ImportPage() {
  const { property } = useProperty();
  const pid = property.id;
  const history = useLoad(() => api.get<ImportBatch[]>(`/properties/${pid}/imports`), [pid]);
  const [kind, setKind] = useState<keyof typeof KINDS>("gl");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ batch: ImportBatch; warnings: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", file);
    setBusy(true);
    try {
      const p = await api.post<ImportPreview>(`/properties/${pid}/imports`, fd);
      setPreview(p); setMap(p.suggested_map); setResult(null); setErr(null);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    try {
      const clean = Object.fromEntries(Object.entries(map).filter(([, v]) => v));
      setResult(await api.post(`/imports/${preview.batch.id}/commit`, { column_map: clean }));
      setPreview(null); setErr(null); history.reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <ErrorBox error={err} />
      <Card>
        <CardHeader><CardTitle>Upload</CardTitle><CardDescription>CSV or XLSX, up to 10 MB. Original files are stored unchanged. Invalid rows are kept and reported, never dropped.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={upload} className="flex flex-wrap items-end gap-3">
            <Label>File type<Select value={kind} onChange={(e) => setKind(e.target.value as keyof typeof KINDS)}>
              {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Label>
            <Label>File<input type="file" accept=".csv,.xlsx" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Label>
            <Button type="submit" disabled={!file || busy}>Preview</Button>
          </form>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader><CardTitle>Map columns: {preview.batch.filename}</CardTitle><CardDescription>{preview.batch.row_count} data rows. Confirm each field before committing.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {preview.warnings.map((w) => <div key={w} className="rounded-md bg-warning/10 px-3 py-2 text-sm">{w}</div>)}
            <div className="grid gap-3 md:grid-cols-4">
              {[...preview.required_fields, ...preview.optional_fields].map((f) => (
                <Label key={f}>{f}{preview.required_fields.includes(f) ? " *" : ""}
                  <Select value={map[f] ?? ""} onChange={(e) => setMap({ ...map, [f]: e.target.value })}>
                    <option value="">Not mapped</option>{preview.columns.map((c) => <option key={c}>{c}</option>)}
                  </Select>
                </Label>
              ))}
            </div>
            <Table>
              <THead><TR><TH>Row</TH>{preview.columns.map((c) => <TH key={c}>{c}</TH>)}</TR></THead>
              <TBody>{preview.rows.map((r, i) => <TR key={i}><TD className="text-muted-foreground">{i + 2}</TD>{preview.columns.map((c) => <TD key={c}>{r[c]}</TD>)}</TR>)}</TBody>
            </Table>
            <Button onClick={commit} disabled={busy}>Validate and commit</Button>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader><CardTitle>Import result</CardTitle><CardDescription>{result.batch.accepted_count} accepted, {result.batch.rejected_rows.length} rejected of {result.batch.row_count} rows.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {result.warnings.map((w, i) => <div key={i} className="rounded-md bg-warning/10 px-3 py-1.5 text-sm">{w}</div>)}
            {result.batch.rejected_rows.length > 0 && <RejectedTable rows={result.batch.rejected_rows} />}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Import history</CardTitle></CardHeader>
        <CardContent className="p-0">
          {history.data?.length ? (
            <Table>
              <THead><TR><TH>Uploaded</TH><TH>Type</TH><TH>File</TH><TH>Status</TH><TH className="num">Rows</TH><TH className="num">Accepted</TH><TH className="num">Rejected</TH></TR></THead>
              <TBody>{history.data.map((b) => (
                <TR key={b.id}><TD>{new Date(b.created_at).toLocaleString()}</TD><TD>{KINDS[b.kind as keyof typeof KINDS]}</TD><TD>{b.filename}</TD><TD><StatusBadge status={b.status} /></TD>
                  <TD className="num">{b.row_count}</TD><TD className="num">{b.accepted_count}</TD><TD className="num">{b.rejected_rows.length}</TD></TR>
              ))}</TBody>
            </Table>
          ) : <div className="p-5"><Empty>No imports yet.</Empty></div>}
        </CardContent>
      </Card>
    </div>
  );
}

function RejectedTable({ rows }: { rows: ImportBatch["rejected_rows"] }) {
  return (
    <Table>
      <THead><TR><TH>Source row</TH><TH>Errors</TH><TH>Values</TH></TR></THead>
      <TBody>{rows.map((r) => (
        <TR key={r.row}><TD>{r.row}</TD><TD className="text-destructive">{r.errors.join("; ")}</TD>
          <TD className="font-mono text-xs">{Object.entries(r.values).map(([k, v]) => `${k}=${v}`).join(", ")}</TD></TR>
      ))}</TBody>
    </Table>
  );
}
