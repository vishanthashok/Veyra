"use client";
import { api, type AuditRun } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { fmtDate, fmtDateTime } from "@/lib/utils";

/** Run history plus the selected run (default latest) with results. */
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
    <label className="flex min-w-0 items-center gap-2 text-xs text-muted">
      <span>Run</span>
      <select className="h-8 w-full min-w-0 max-w-[22rem] rounded-md border border-line-strong bg-surface px-2 text-sm text-ink" value={value} onChange={(e) => onChange(e.target.value)}>
        {runs.map((r, i) => (
          <option key={r.id} value={r.id}>
            {i === 0 ? "Latest · " : ""}{fmtDateTime(r.created_at)} · through {fmtDate(r.summary.period.through_date)}{r.reproducible ? "" : " · legacy"}
          </option>
        ))}
      </select>
    </label>
  );
}
