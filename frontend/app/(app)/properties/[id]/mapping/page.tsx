"use client";
import { Fragment, useState } from "react";
import { Empty, ErrorBox } from "@/components/common";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { api, type Category, type GLAccount, type GLTransaction } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { money } from "@/lib/utils";
import { useProperty } from "../context";

export default function Mapping() {
  const { property } = useProperty();
  const pid = property.id;
  const accts = useLoad(() => api.get<GLAccount[]>(`/properties/${pid}/gl-accounts`), [pid]);
  const cats = useLoad(() => api.get<Category[]>(`/properties/${pid}/categories`), [pid]);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const rows = (accts.data ?? []).filter((a) => filter === "all" || a.status === filter);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Expense mapping</CardTitle>
        <CardDescription>Every GL account starts as needs review. Recoverability is set only by a reviewer with an explanation, never inferred from the account name.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        <div className="flex gap-2 px-5 pt-1">
          {["all", "needs_review", "recoverable", "nonrecoverable"].map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>{f.replace("_", " ")}</Button>
          ))}
        </div>
        {rows.length ? (
          <Table>
            <THead><TR><TH>GL account</TH><TH>Name</TH><TH className="num">Txns</TH><TH className="num">YTD total</TH><TH>Category</TH><TH>Status</TH><TH>Reviewer</TH><TH>Explanation</TH><TH /></TR></THead>
            <TBody>
              {rows.map((a) => (
                <Fragment key={a.gl_account}>
                  <TR>
                    <TD className="font-mono text-xs">{a.gl_account}</TD><TD>{a.account_name}</TD><TD className="num">{a.transaction_count}</TD>
                    <TD className="num">{money(a.total)}</TD><TD>{a.category_code ?? "—"}</TD><TD><StatusBadge status={a.status} /></TD>
                    <TD className="text-xs">{a.reviewer ? <>{a.reviewer}<div className="text-muted-foreground">{a.reviewed_at && new Date(a.reviewed_at).toLocaleString()}</div></> : "—"}</TD>
                    <TD className="max-w-64 text-xs">{a.explanation}</TD>
                    <TD><Button size="sm" variant="outline" onClick={() => setOpen(open === a.gl_account ? null : a.gl_account)}>{open === a.gl_account ? "Close" : "Review"}</Button></TD>
                  </TR>
                  {open === a.gl_account && (
                    <tr><td colSpan={9} className="bg-muted/30 px-5 py-4">
                      <Editor pid={pid} acct={a} cats={cats.data ?? []} onSaved={() => { accts.reload(); }} />
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </TBody>
          </Table>
        ) : <div className="p-5"><Empty>No GL accounts. Import a general ledger first.</Empty></div>}
      </CardContent>
    </Card>
  );
}

function Editor({ pid, acct, cats, onSaved }: { pid: string; acct: GLAccount; cats: Category[]; onSaved: () => void }) {
  const [f, setF] = useState({ status: acct.status, category_code: acct.category_code ?? "", explanation: acct.explanation, source_ref: acct.source_ref });
  const [err, setErr] = useState<string | null>(null);
  const txns = useLoad(() => api.get<GLTransaction[]>(`/properties/${pid}/gl-transactions?gl_account=${encodeURIComponent(acct.gl_account)}`), [pid, acct.gl_account]);

  async function toggle(t: GLTransaction) {
    const note = window.prompt(t.excluded_by_review ? "Reason for including this transaction again" : "Reason for excluding this transaction (for example, confirmed duplicate)");
    if (!note) return;
    try { await api.post(`/gl-transactions/${t.id}/${t.excluded_by_review ? "include" : "exclude"}`, { note }); txns.reload(); }
    catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="space-y-4">
      <ErrorBox error={err} />
      <form className="grid gap-3 md:grid-cols-5" onSubmit={async (e) => {
        e.preventDefault();
        try { await api.put(`/properties/${pid}/mappings/${encodeURIComponent(acct.gl_account)}`, { ...f, category_code: f.category_code || null }); setErr(null); onSaved(); }
        catch (e) { setErr((e as Error).message); }
      }}>
        <Label>Recoverability<Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="needs_review">needs review</option><option value="recoverable">recoverable</option><option value="nonrecoverable">nonrecoverable</option></Select></Label>
        <Label>Category<Select value={f.category_code} onChange={(e) => setF({ ...f, category_code: e.target.value })}>
          <option value="">None</option>{cats.map((c) => <option key={c.code} value={c.code}>{c.code} ({c.pool})</option>)}</Select></Label>
        <Label className="md:col-span-2">Explanation (required)<Input value={f.explanation} onChange={(e) => setF({ ...f, explanation: e.target.value })} placeholder="Lease section or reason" /></Label>
        <Label>Supporting source<Input value={f.source_ref} onChange={(e) => setF({ ...f, source_ref: e.target.value })} placeholder="Invoice, lease page" /></Label>
        <div><Button type="submit">Save decision</Button></div>
      </form>
      <Table>
        <THead><TR><TH>Date</TH><TH>Vendor</TH><TH>Description</TH><TH className="num">Amount</TH><TH>Source</TH><TH>Included</TH><TH /></TR></THead>
        <TBody>{(txns.data ?? []).map((t) => (
          <TR key={t.id} className={t.excluded_by_review ? "opacity-50" : ""}>
            <TD>{t.txn_date}</TD><TD>{t.vendor}</TD><TD>{t.description}</TD><TD className="num">{money(t.amount)}</TD>
            <TD className="text-xs text-muted-foreground">row {t.source_row}</TD><TD>{t.excluded_by_review ? "Excluded by reviewer" : "Yes"}</TD>
            <TD><Button size="sm" variant="ghost" onClick={() => toggle(t)}>{t.excluded_by_review ? "Include" : "Exclude"}</Button></TD>
          </TR>
        ))}</TBody>
      </Table>
    </div>
  );
}
