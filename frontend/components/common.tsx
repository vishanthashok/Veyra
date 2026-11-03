import { AlertTriangle } from "lucide-react";
import * as React from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>;
}

export function ProvisionalBanner() {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>
        <b>Provisional pre-close audit.</b> Figures cover year-to-date data only and are not a final year-end
        reconciliation. Variances are potential discrepancies for accountant review, not confirmed billing errors.
      </span>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "error" | "warning" }) {
  const color = tone === "error" ? "text-destructive" : tone === "warning" ? "text-[oklch(0.5_0.12_70)]" : "";
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{children}</div>;
}
