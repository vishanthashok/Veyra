"use client";
import { useState } from "react";
import { Empty, ErrorBox, ProvisionalBanner } from "@/components/common";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { api, type AuditExc } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { money } from "@/lib/utils";
import { useProperty } from "../context";
import { RunPicker, useRuns } from "../runs";

export default function Exceptions() {
  const { property } = useProperty();
  const [selected, setSelected] = useState<string | null>(null);
  const runs = useRuns(property.id, selected);
  const runId = runs.data?.run?.id;
  const exc = useLoad(() => (runId ? api.get<AuditExc[]>(`/audit-runs/${runId}/exceptions`) : Promise.resolve([])), [runId]);
  const [show, setShow] = useState("open");
  const [err, setErr] = useState<string | null>(null);
  const rows = (exc.data ?? []).filter((e) => show === "all" || e.status === show);

  async function setStatus(e: AuditExc, status: string) {
    const note = window.prompt(`Note for marking this ${status}`);
    if (!note) return;
    try { await api.patch(`/exceptions/${e.id}`, { status, note }); exc.reload(); setErr(null); } catch (x) { setErr((x as Error).message); }
  }

  return (
    <div className="space-y-4">
      <ProvisionalBanner />
      <ErrorBox error={runs.error || exc.error || err} />
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div><CardTitle>Exception center</CardTitle><CardDescription>Errors block a tenant result. Warnings need review. Info items are for awareness. A re-run creates fresh exceptions from current data.</CardDescription></div>
          <RunPicker runs={runs.data?.runs ?? []} value={runId} onChange={setSelected} />
        </CardHeader>
        <CardContent className="space-y-3 p-0">
          <div className="flex gap-2 px-5">{["open", "resolved", "accepted", "all"].map((s) => <Button key={s} size="sm" variant={show === s ? "default" : "outline"} onClick={() => setShow(s)}>{s}</Button>)}</div>
          {rows.length ? (
            <Table>
              <THead><TR><TH>Severity</TH><TH>Type</TH><TH>Tenant / account / pool</TH><TH>Message</TH><TH className="num">Amount</TH><TH>Status</TH><TH /></TR></THead>
              <TBody>{rows.map((e) => (
                <TR key={e.id}>
                  <TD><StatusBadge status={e.severity} /></TD><TD className="font-mono text-xs">{e.type}</TD>
                  <TD className="text-xs">{[e.tenant_name, e.gl_account && `GL ${e.gl_account}`, e.pool && `Pool ${e.pool}`].filter(Boolean).join(" · ") || "—"}</TD>
                  <TD className="max-w-xl">{e.message}{e.resolution_note && <div className="mt-1 text-xs text-muted-foreground">Note: {e.resolution_note}</div>}</TD>
                  <TD className="num">{money(e.amount)}</TD><TD><StatusBadge status={e.status} /></TD>
                  <TD className="whitespace-nowrap">{e.status === "open" ? <>
                    <Button size="sm" variant="ghost" onClick={() => setStatus(e, "resolved")}>Resolve</Button>
                    <Button size="sm" variant="ghost" onClick={() => setStatus(e, "accepted")}>Accept</Button></> :
                    <Button size="sm" variant="ghost" onClick={() => setStatus(e, "open")}>Reopen</Button>}</TD>
                </TR>
              ))}</TBody>
            </Table>
          ) : <div className="p-5"><Empty>{runId ? "No exceptions in this view." : "Run an audit first."}</Empty></div>}
        </CardContent>
      </Card>
    </div>
  );
}
