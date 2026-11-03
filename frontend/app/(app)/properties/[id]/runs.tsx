"use client";
import { api, type AuditRun } from "@/lib/api";
import { useLoad } from "@/lib/hooks";

/** Loads run history and the selected (default latest) run with results. */
export function useRuns(pid: string, selected: string | null) {
  return useLoad(async () => {
    const runs = await api.get<AuditRun[]>(`/properties/${pid}/audit-runs`);
    const id = selected ?? runs[0]?.id;
    const run = id ? await api.get<AuditRun>(`/audit-runs/${id}`) : null;
    return { runs, run };
  }, [pid, selected]);
}

export function RunPicker({ runs, value, onChange }: { runs: AuditRun[]; value: string | undefined; onChange: (id: string) => void }) {
  if (!runs.length) return null;
  return (
    <select className="h-9 rounded-md border bg-card px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
      {runs.map((r) => <option key={r.id} value={r.id}>Run {new Date(r.created_at).toLocaleString()} · through {r.summary.period.through_date}</option>)}
    </select>
  );
}
