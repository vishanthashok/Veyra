"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { History, Lightbulb, Tags } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useNoteDialog } from "@/components/app/note-dialog";
import { EmptyState, ErrorBox, KeyValue, PageHeader } from "@/components/app/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TableSkeleton } from "@/components/ui/skeleton";
import { api, errorText, type Category, type GLAccount, type GLTransaction, type HistoryItem, type Page } from "@/lib/api";
import { useLoad, useUnsavedChanges } from "@/lib/hooks";
import { cn, compareDecimal, fmtDate, fmtDateTime, money } from "@/lib/utils";
import { crumbs, useProperty } from "../context";

const STATUS_OPTS = [
  { value: "recoverable", label: "Recoverable", help: "Included in the category's pool." },
  { value: "nonrecoverable", label: "Nonrecoverable", help: "Excluded from every pool." },
  { value: "needs_review", label: "Needs review", help: "Excluded until decided." },
];

/** Name-based hint shown to the reviewer. Never applied automatically. */
function suggest(acct: GLAccount, cats: Category[]): Category | null {
  const words = acct.account_name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  return cats.find((c) => words.some((w) => c.name.toLowerCase().includes(w) || c.code.toLowerCase().includes(w))) ?? null;
}

export default function Mapping() {
  const ctx = useProperty();
  const pid = ctx.property.id;
  const accts = useLoad(() => api.get<GLAccount[]>(`/properties/${pid}/gl-accounts`), [pid]);
  const cats = useLoad(() => api.get<Category[]>(`/properties/${pid}/categories`), [pid]);
  const [selected, setSelected] = useState<string | null>(null);
  const [bulk, setBulk] = useState<string[] | null>(null);
  const rows = useMemo(() => accts.data ?? [], [accts.data]);
  const current = rows.find((a) => a.gl_account === selected) ?? null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!selected && rows.length) setSelected((rows.find((a) => a.status === "needs_review") ?? rows[0]).gl_account);
  }, [rows, selected]);

  const counts = { needs_review: rows.filter((a) => a.status === "needs_review").length, total: rows.length };

  const columns = useMemo<ColumnDef<GLAccount, unknown>[]>(() => [
    { accessorKey: "gl_account", header: "Account", cell: ({ row }) => <div><div className="font-mono text-xs font-medium">{row.original.gl_account}{row.original.category_code && <span className="ml-1.5 font-sans font-normal text-muted">→ {row.original.category_code}</span>}</div><div className="max-w-44 truncate text-2xs text-muted">{row.original.account_name}</div></div> },
    { accessorKey: "total", header: "YTD total", meta: { align: "right", exportValue: (r) => r.total }, sortingFn: (a, b) => compareDecimal(a.original.total, b.original.total), cell: ({ getValue }) => money(getValue() as string) },
    { accessorKey: "status", header: "Decision", filterFn: "equals", cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
  ], []);

  return (
    <>
      <PageHeader title="Expense mapping" crumbs={crumbs(ctx, "Expense mapping")}
        description="Every GL account starts as needs review. A reviewer decides recoverability with an explanation. Account names never decide it."
        meta={counts.needs_review ? <Badge tone="warning">{counts.needs_review} of {counts.total} need review</Badge> : counts.total ? <Badge tone="success">All reviewed</Badge> : null} />
      <ErrorBox error={accts.error} />
      {rows.length === 0 && !accts.loading ? (
        <Panel><EmptyState icon={Tags} title="No GL accounts yet">Import a general ledger first. Each account appears here for review.</EmptyState></Panel>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(360px,440px)_1fr]">
          <Panel className="lg:sticky lg:top-[calc(var(--topbar-h)+16px)]">
            <DataTable caption="GL accounts" data={rows} columns={columns} getRowId={(r) => r.gl_account} loading={accts.loading}
              onRowClick={(r) => setSelected(r.gl_account)} activeRowId={selected} selectable compact maxHeight="calc(100vh - 260px)"
              searchPlaceholder="Search accounts"
              facets={[{ columnId: "status", label: "Decision", options: STATUS_OPTS.map((s) => ({ value: s.value, label: s.label })) }]}
              exportName="veyra-gl-accounts" pageSize={200} hideColumnsMenu
              bulkActions={(sel) => <Button size="xs" variant="primary" onClick={() => setBulk(sel.map((a) => a.gl_account))}>Set decision for {sel.length}</Button>} />
          </Panel>
          {current ? (
            <AccountDetail key={current.gl_account + current.version} pid={pid} acct={current} cats={cats.data ?? []}
              onSaved={(next) => { accts.reload(); if (next) setSelected(next); }} nextNeedsReview={rows.find((a) => a.status === "needs_review" && a.gl_account !== current.gl_account)?.gl_account} />
          ) : <Panel><TableSkeleton /></Panel>}
        </div>
      )}
      {bulk && <BulkDialog pid={pid} accounts={bulk} cats={cats.data ?? []} onClose={() => setBulk(null)} onDone={() => { setBulk(null); accts.reload(); }} />}
    </>
  );
}

function DecisionForm({ value, onChange, cats }: { value: { status: string; category_code: string; explanation: string; source_ref: string }; onChange: (v: typeof value) => void; cats: Category[] }) {
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-ink-2">Recoverability</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {STATUS_OPTS.map((o) => (
            <label key={o.value} className={cn("flex cursor-pointer flex-col rounded-md border px-3 py-2", value.status === o.value ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-line hover:border-line-strong")}>
              <span className="flex items-center gap-2 text-sm font-medium"><input type="radio" className="accent-[var(--accent)]" checked={value.status === o.value} onChange={() => onChange({ ...value, status: o.value })} />{o.label}</span>
              <span className="pl-5 text-2xs text-muted">{o.help}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category" required={value.status === "recoverable"} error={value.status === "recoverable" && !value.category_code ? "A recoverable account needs a category" : null}>
          <Select value={value.category_code} onChange={(e) => onChange({ ...value, category_code: e.target.value })}>
            <option value="">None</option>{cats.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name} ({c.pool})</option>)}
          </Select>
        </Field>
        <Field label="Supporting source" hint="Lease section, invoice or policy"><Input value={value.source_ref} onChange={(e) => onChange({ ...value, source_ref: e.target.value })} /></Field>
      </div>
      <Field label="Explanation" required={value.status !== "needs_review"} hint="Why this decision. Saved to the audit record.">
        <Textarea value={value.explanation} onChange={(e) => onChange({ ...value, explanation: e.target.value })} />
      </Field>
    </div>
  );
}

function AccountDetail({ pid, acct, cats, onSaved, nextNeedsReview }: { pid: string; acct: GLAccount; cats: Category[]; onSaved: (next?: string) => void; nextNeedsReview?: string }) {
  const initial = { status: acct.status, category_code: acct.category_code ?? "", explanation: acct.explanation, source_ref: acct.source_ref };
  const [f, setF] = useState(initial);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  useUnsavedChanges(dirty);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const txns = useLoad(() => api.get<Page<GLTransaction>>(`/properties/${pid}/gl-transactions?gl_account=${encodeURIComponent(acct.gl_account)}&page=${page}&page_size=50`), [pid, acct.gl_account, page]);
  const hist = useLoad(() => api.get<HistoryItem[]>(`/properties/${pid}/mappings/${encodeURIComponent(acct.gl_account)}/history`), [pid, acct.gl_account, acct.version]);
  const { ask, dialog } = useNoteDialog();
  const hint = suggest(acct, cats);
  const cat = cats.find((c) => c.code === acct.category_code);

  async function save(andNext: boolean) {
    setBusy(true); setErr(null);
    try {
      await api.put(`/properties/${pid}/mappings/${encodeURIComponent(acct.gl_account)}`, { ...f, category_code: f.category_code || null });
      toast.success(`GL ${acct.gl_account} saved as ${f.status.replace("_", " ")}`);
      onSaved(andNext ? nextNeedsReview : undefined);
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  }

  const txColumns: ColumnDef<GLTransaction, unknown>[] = [
    { accessorKey: "txn_date", header: "Date", cell: ({ getValue }) => <span className="whitespace-nowrap">{fmtDate(getValue() as string)}</span> },
    { accessorKey: "vendor", header: "Vendor", cell: ({ getValue }) => <span className="block max-w-40 truncate">{getValue() as string}</span> },
    { accessorKey: "description", header: "Description", cell: ({ getValue }) => <span className="block max-w-56 truncate text-ink-2">{getValue() as string}</span> },
    { accessorKey: "amount", header: "Amount", meta: { align: "right" }, sortingFn: (a, b) => compareDecimal(a.original.amount, b.original.amount), cell: ({ getValue }) => money(getValue() as string) },
    { accessorKey: "source_row", header: "Row", meta: { align: "right" }, cell: ({ getValue }) => <span className="text-muted">{getValue() as number}</span> },
    { id: "act", header: "", enableSorting: false, meta: { align: "right" }, cell: ({ row }) => {
      const t = row.original;
      return <Button size="xs" variant="ghost" onClick={() => ask({
        title: t.excluded_by_review ? "Include transaction again" : "Exclude transaction",
        description: `${fmtDate(t.txn_date)} · ${t.vendor || t.description} · ${money(t.amount)}. ${t.excluded_by_review ? "It will count in the next audit run." : "It will not count in the next audit run. The row is kept."}`,
        confirm: t.excluded_by_review ? "Include" : "Exclude", danger: !t.excluded_by_review,
        placeholder: t.excluded_by_review ? "Why it belongs in the pool" : "For example: confirmed duplicate of invoice 4411",
        onSubmit: async (note) => { await api.post(`/gl-transactions/${t.id}/${t.excluded_by_review ? "include" : "exclude"}`, { note }); toast.success("Saved"); txns.reload(); onSaved(); },
      })}>{t.excluded_by_review ? "Include" : "Exclude"}</Button>;
    } },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Panel>
        <PanelHeader title={<span className="flex items-center gap-2"><span className="font-mono">{acct.gl_account}</span><span className="font-normal text-ink-2">{acct.account_name}</span></span>}
          description={<>{acct.transaction_count} transactions · YTD {money(acct.total)}{acct.excluded_count ? ` · ${acct.excluded_count} excluded by reviewer` : ""}</>}
          actions={<StatusBadge status={acct.status} />} />
        <PanelBody className="space-y-4">
          {acct.reviewer && <KeyValue items={[["Current decision", <>{acct.status.replace("_", " ")}{cat ? ` · ${cat.code} (${cat.pool} pool)` : ""} · v{acct.version}</>], ["Reviewed", `${acct.reviewer}, ${fmtDateTime(acct.reviewed_at)}`]]} />}
          {hint && acct.status === "needs_review" && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-info-line bg-info-bg px-3 py-2 text-sm text-info">
              <Lightbulb className="size-4" aria-hidden />
              <span>Name suggests <b>{hint.code}</b> ({hint.name}). Suggestion only. Check the transactions and the leases.</span>
              <Button size="xs" className="ml-auto" onClick={() => setF({ ...f, category_code: hint.code })}>Use category</Button>
            </div>
          )}
          <DecisionForm value={f} onChange={setF} cats={cats} />
          {err && <p role="alert" className="text-sm text-error">{err}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" loading={busy} disabled={!dirty} onClick={() => save(false)}>Save decision</Button>
            {nextNeedsReview && <Button loading={busy} disabled={!dirty} onClick={() => save(true)}>Save and review next</Button>}
            {dirty && <Button variant="ghost" onClick={() => setF(initial)}>Discard</Button>}
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Supporting transactions" description="Exclusions are reviewer decisions with a note. The row stays on file." />
        <DataTable caption={`Transactions in ${acct.gl_account}`} data={txns.data?.items ?? []} columns={txColumns} getRowId={(r) => r.id} loading={txns.loading}
          compact pageSize={50} searchPlaceholder="Search transactions" exportName={`gl-${acct.gl_account}`}
          rowClassName={(r) => (r.excluded_by_review ? "opacity-50 line-through decoration-line-strong" : undefined)} />
        {txns.data && txns.data.total > txns.data.page_size && (
          <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-muted">
            <span>Page {txns.data.page} of {Math.ceil(txns.data.total / txns.data.page_size)} · {txns.data.total} transactions</span>
            <div className="flex gap-1"><Button size="xs" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="xs" disabled={page * txns.data.page_size >= txns.data.total} onClick={() => setPage(page + 1)}>Next</Button></div>
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader title={<span className="flex items-center gap-2"><History className="size-4 text-muted" />Reviewer history</span>} />
        {hist.data?.length ? (
          <ol className="divide-y divide-line">
            {hist.data.map((h, i) => (
              <li key={i} className="flex gap-3 px-4 py-2.5 text-sm">
                <StatusBadge status={h.decision} />
                <div className="min-w-0 flex-1"><div className="text-ink">{h.note}</div><div className="text-2xs text-muted">{h.reviewer} · {fmtDateTime(h.at)}</div></div>
              </li>
            ))}
          </ol>
        ) : <PanelBody className="text-sm text-muted">No decisions yet.</PanelBody>}
      </Panel>
      {dialog}
    </div>
  );
}

function BulkDialog({ pid, accounts, cats, onClose, onDone }: { pid: string; accounts: string[]; cats: Category[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ status: "recoverable", category_code: "", explanation: "", source_ref: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Set decision for ${accounts.length} accounts`} className="max-w-2xl"
        description={<>Applies the same reviewed decision to {accounts.join(", ")}. Each account gets its own audit record.</>}>
        <DecisionForm value={f} onChange={setF} cats={cats} />
        {err && <p role="alert" className="mt-3 text-sm text-error">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={async () => {
            setBusy(true); setErr(null);
            try { await api.post(`/properties/${pid}/mappings/bulk`, { ...f, category_code: f.category_code || null, gl_accounts: accounts }); toast.success(`${accounts.length} accounts updated`); onDone(); }
            catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
          }}>Apply to {accounts.length} accounts</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
