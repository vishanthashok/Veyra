"use client";
import { Download } from "lucide-react";
import { useState } from "react";
import { Empty, ProvisionalBanner } from "@/components/common";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useProperty } from "../context";
import { RunPicker, useRuns } from "../runs";

const REPORTS: [string, string, string][] = [
  ["package", "Full audit package", "Readiness, allocation with traces, classification and exceptions in one workbook."],
  ["classification", "CAM expense classification", "Every GL transaction with category, recoverability, reviewer and source row."],
  ["allocation", "Tenant allocation", "Pool lines, shares, caps, admin fees, YTD billed, variance and the calculation trace."],
  ["missing-information", "Missing information", "Data or lease terms needed before a final reconciliation."],
  ["exceptions", "Exception report", "All exceptions with severity, status and reviewer notes."],
  ["readiness", "Reconciliation readiness summary", "Counts of open items and whether year-end inputs are ready."],
];

export default function Reports() {
  const { property } = useProperty();
  const [selected, setSelected] = useState<string | null>(null);
  const { data } = useRuns(property.id, selected);
  const run = data?.run;
  return (
    <div className="space-y-4">
      <ProvisionalBanner />
      <div className="flex justify-end"><RunPicker runs={data?.runs ?? []} value={run?.id} onChange={setSelected} /></div>
      {!run ? <Empty>Run an audit to generate reports.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {REPORTS.map(([kind, title, desc]) => (
            <a key={kind} href={`/api/v1/audit-runs/${run.id}/reports/${kind}.xlsx`} className="group">
              <Card className="h-full transition-colors group-hover:border-primary/50">
                <CardHeader><CardTitle className="flex items-center gap-2"><Download className="size-4" />{title}</CardTitle><CardDescription>{desc}</CardDescription></CardHeader>
                <CardContent className="text-xs text-muted-foreground">Excel workbook · labeled provisional · run {run.input_hash.slice(0, 8)}</CardContent>
              </Card>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
