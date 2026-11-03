"use client";
import Link from "next/link";
import { Empty, ErrorBox, PageHeader, Stat } from "@/components/common";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/hooks";

type Row = {
  id: string; name: string; property_type: string; reconciliation_status: string; tenants: number;
  gl_accounts: number; accounts_needing_review: number; tenants_missing_rules: number;
  open_exceptions: Record<string, number>;
  latest_audit: { id: string; created_at: string; tenants_calculated: number; tenants_unresolved: number } | null;
};

export default function Dashboard() {
  const { data, error } = useLoad(() => api.get<{ properties: Row[] }>("/dashboard"), []);
  const rows = data?.properties ?? [];
  const sum = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0);
  const latest = rows.map((r) => r.latest_audit).filter(Boolean).sort((a, b) => b!.created_at.localeCompare(a!.created_at))[0];

  return (
    <>
      <PageHeader title="Dashboard" description="Pre-close readiness across your properties. No savings or recovery figures are shown." />
      <ErrorBox error={error} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Properties" value={rows.length} />
        <Stat label="Tenants" value={sum((r) => r.tenants)} />
        <Stat label="GL accounts needing review" value={sum((r) => r.accounts_needing_review)} tone={sum((r) => r.accounts_needing_review) ? "warning" : undefined} />
        <Stat label="Tenants missing lease rules" value={sum((r) => r.tenants_missing_rules)} tone={sum((r) => r.tenants_missing_rules) ? "warning" : undefined} />
        <Stat label="Open exceptions" value={sum((r) => Object.values(r.open_exceptions).reduce((a, b) => a + b, 0))} />
        <Stat label="Latest audit" value={latest ? new Date(latest.created_at).toLocaleDateString() : "None"} />
      </div>
      <Card>
        <CardHeader><CardTitle>Properties</CardTitle></CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? <div className="p-5"><Empty>No properties yet. <Link className="underline" href="/properties">Create one</Link>.</Empty></div> : (
            <Table>
              <THead><TR><TH>Property</TH><TH>Status</TH><TH className="num">Tenants</TH><TH className="num">Accounts to review</TH><TH className="num">Missing rules</TH><TH>Open exceptions</TH><TH>Latest audit</TH></TR></THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD><Link className="font-medium hover:underline" href={`/properties/${r.id}`}>{r.name}</Link><div className="text-xs text-muted-foreground">{r.property_type}</div></TD>
                    <TD><StatusBadge status={r.reconciliation_status} /></TD>
                    <TD className="num">{r.tenants}</TD>
                    <TD className="num">{r.accounts_needing_review}</TD>
                    <TD className="num">{r.tenants_missing_rules}</TD>
                    <TD className="space-x-1">{Object.entries(r.open_exceptions).map(([k, v]) => <span key={k}><StatusBadge status={k} /> {v}</span>)}{!Object.keys(r.open_exceptions).length && "—"}</TD>
                    <TD>{r.latest_audit ? <Link className="hover:underline" href={`/properties/${r.id}/audit`}>{new Date(r.latest_audit.created_at).toLocaleString()} · {r.latest_audit.tenants_calculated} calculated, {r.latest_audit.tenants_unresolved} unresolved</Link> : "Not run"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
