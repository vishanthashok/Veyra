"use client";
import { ArrowRight, CheckCheck, Search, Sigma } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app/app-context";
import { useNoteDialog } from "@/components/app/note-dialog";
import { EmptyState, ErrorBox, KeyValue, PageHeader, ProvisionalTag } from "@/components/app/page";
import { SeverityIcon, StatusBadge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Segmented, Select } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";
import { type AuditExc, type HistoryItem, type Result, type User, api } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { cn, fmtDateTime, money, sign } from "@/lib/utils";
import { TraceInspector } from "../audit/trace-inspector";
import { crumbs, useProperty } from "../context";
import { RunPicker, useRuns } from "../runs";

const OPEN = ["open", "in_review", "reopened"];
const SEV_ORDER = { error: 0, warning: 1, info: 2 };

const ACTIONS: Record<string, { to: string; label: string }[]> = {
  open: [
    { to: "in_review", label: "Start review" },
    { to: "resolved", label: "Resolve" },
    { to: "accepted", label: "Accept exception" },
  ],
  in_review: [
    { to: "resolved", label: "Resolve" },
    { to: "accepted", label: "Accept exception" },
    { to: "open", label: "Back to open" },
  ],
  reopened: [
    { to: "in_review", label: "Start review" },
    { to: "resolved", label: "Resolve" },
    { to: "accepted", label: "Accept exception" },
  ],
  resolved: [{ to: "reopened", label: "Reopen" }],
  accepted: [{ to: "reopened", label: "Reopen" }],
};

export const TYPE_INFO: Record<string, { name: string; help: string; fix?: string; cta?: string }> = {
  MISSING_LEASE_RULE: {
    name: "Missing lease rule",
    help: "Add or approve a lease rule for this tenant, then re-run the audit.",
    fix: "rules",
    cta: "Open lease rules",
  },
  MISSING_TENANT_AREA: {
    name: "Missing rentable area",
    help: "Enter the tenant's rentable area, then re-run the audit.",
    fix: "tenants",
    cta: "Open tenants",
  },
  UNSUPPORTED_RULE: {
    name: "Unsupported lease term",
    help: "The engine cannot compute this term. Calculate it manually and document it, or accept with a reason.",
    fix: "rules",
    cta: "Open lease rule",
  },
  MISSING_RULE_TERM: {
    name: "Incomplete lease rule",
    help: "Complete the lease rule, then re-run the audit.",
    fix: "rules",
    cta: "Open lease rules",
  },
  MISSING_DENOMINATOR: {
    name: "Missing denominator",
    help: "Enter the lease-defined denominator on the rule, then re-run.",
    fix: "rules",
    cta: "Open lease rules",
  },
  MAPPING_NEEDS_REVIEW: {
    name: "GL account needs review",
    help: "Decide recoverability, then re-run.",
    fix: "mapping",
    cta: "Classify account",
  },
  UNMAPPED_GL_ACCOUNT: { name: "Unmapped GL account", help: "Map the account, then re-run.", fix: "mapping", cta: "Classify account" },
  UNKNOWN_CATEGORY: { name: "Unknown category", help: "Fix the mapping's category, then re-run.", fix: "mapping", cta: "Open mapping" },
  DUPLICATE_GL_CANDIDATE: {
    name: "Possible duplicate invoice",
    help: "Compare the invoices. If confirmed, exclude the duplicate in expense mapping and re-run.",
    fix: "mapping",
    cta: "Inspect transactions",
  },
  TRANSACTION_OUTSIDE_PERIOD: { name: "Outside audit window", help: "Excluded automatically. Confirm the posting date is right." },
  VARIANCE_OVER_THRESHOLD: {
    name: "Variance above threshold",
    help: "Compare billed estimates to the provisional share. Not a confirmed billing error.",
  },
  MISSING_BILLINGS: {
    name: "No billings in window",
    help: "Import billings for this tenant or confirm none were issued.",
    fix: "import",
    cta: "Import billings",
  },
  ROUNDING_DIFFERENCE: { name: "Rounding difference", help: "Rounded tenant lines differ from the pool by cents. No plug is applied." },
  SHARES_EXCEED_100: {
    name: "Shares above 100%",
    help: "Tenant shares in this pool sum above 100%. Check lease denominators.",
    fix: "rules",
    cta: "Open lease rules",
  },
};

export default function Exceptions() {
  const ctx = useProperty();
  const { reloadReadiness } = useApp();
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const runs = useRuns(ctx.property.id, selectedRun);
  const run = runs.data?.run ?? null;
  const exc = useLoad(() => (run ? api.get<AuditExc[]>(`/audit-runs/${run.id}/exceptions`) : Promise.resolve([] as AuditExc[])), [run?.id]);
  const users = useLoad(() => api.get<User[]>("/users"), []);
  const [view, setView] = useState<"open" | "done" | "all">("open");
  const [severity, setSeverity] = useState<string>("");
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const all = useMemo(() => exc.data ?? [], [exc.data]);
  const counts = {
    open: all.filter((e) => OPEN.includes(e.status)).length,
    done: all.filter((e) => !OPEN.includes(e.status)).length,
    all: all.length,
  };
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((e) => (view === "all" ? true : view === "open" ? OPEN.includes(e.status) : !OPEN.includes(e.status)))
      .filter((e) => !severity || e.severity === severity)
      .filter(
        (e) =>
          !needle ||
          [e.message, e.type, e.tenant_name, e.gl_account, e.pool, TYPE_INFO[e.type]?.name].some((v) => v?.toLowerCase().includes(needle)),
      )
      .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.type.localeCompare(b.type));
  }, [all, view, severity, q]);
  const active = rows.find((e) => e.id === activeId) ?? rows[0] ?? null;

  useEffect(() => {
    // Keep a valid selection when filters change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active && active.id !== activeId) setActiveId(active.id);
  }, [active, activeId]);

  function move(delta: number) {
    if (!rows.length) return;
    const i = Math.max(
      0,
      rows.findIndex((e) => e.id === active?.id),
    );
    const next = rows[Math.min(rows.length - 1, Math.max(0, i + delta))];
    setActiveId(next.id);
    listRef.current?.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus();
  }

  return (
    <>
      <PageHeader
        title="Exceptions"
        crumbs={crumbs(ctx, "Exceptions")}
        meta={<ProvisionalTag />}
        description="Blocking errors clear when the data is fixed and the audit re-runs, or when accepted with a reason. Accepted items stay on the record."
        actions={<RunPicker runs={runs.data?.runs ?? []} value={run?.id} onChange={setSelectedRun} />}
      />
      <ErrorBox error={runs.error || exc.error} />

      {!run && !runs.loading ? (
        <Panel>
          <EmptyState icon={Sigma} title="No audit run yet">
            Run an audit to populate the review queue.
          </EmptyState>
        </Panel>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
          <Panel className="flex flex-col lg:sticky lg:top-[calc(var(--topbar-h)+20px)] lg:max-h-[calc(100vh-var(--topbar-h)-40px)]">
            <div className="flex flex-col gap-2 border-b border-line p-3">
              <Segmented
                label="Queue"
                value={view}
                onChange={setView}
                className="self-start"
                options={[
                  { value: "open", label: "Needs action", count: counts.open },
                  { value: "done", label: "Closed", count: counts.done },
                  { value: "all", label: "All", count: counts.all },
                ]}
              />
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search exceptions"
                    aria-label="Search exceptions"
                    className="h-7 w-full rounded-[var(--radius-md)] bg-surface-2 pl-7 pr-2 text-xs outline-none placeholder:text-subtle focus-visible:bg-surface focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]"
                  />
                </div>
                <select
                  aria-label="Filter by severity"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  className="h-7 rounded-[var(--radius-md)] border border-dashed border-line-strong bg-surface px-2 text-xs text-ink-2"
                >
                  <option value="">All severities</option>
                  <option value="error">Errors</option>
                  <option value="warning">Warnings</option>
                  <option value="info">Info</option>
                </select>
              </div>
            </div>
            {exc.loading && !exc.data ? (
              <TableSkeleton rows={6} cols={2} />
            ) : rows.length === 0 ? (
              <EmptyState icon={CheckCheck} title={view === "open" ? "Nothing needs action" : "No exceptions here"} className="py-10">
                {view === "open" ? "Every exception in this run is resolved or accepted." : "Try another filter."}
              </EmptyState>
            ) : (
              <ul
                ref={listRef}
                className="scroll-quiet min-h-0 flex-1 divide-y divide-line overflow-y-auto"
                aria-label="Exceptions"
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" || e.key === "j") {
                    e.preventDefault();
                    move(1);
                  }
                  if (e.key === "ArrowUp" || e.key === "k") {
                    e.preventDefault();
                    move(-1);
                  }
                }}
              >
                {rows.map((e) => {
                  const on = e.id === active?.id;
                  return (
                    <li key={e.id}>
                      <button
                        data-id={e.id}
                        onClick={() => setActiveId(e.id)}
                        aria-current={on ? "true" : undefined}
                        className={cn(
                          "flex w-full gap-3 px-3.5 py-3 text-left outline-none transition-colors duration-[var(--dur-fast)]",
                          on ? "bg-accent-soft/70 shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-surface-2 focus-visible:bg-surface-2",
                        )}
                      >
                        <SeverityIcon severity={e.severity} className="mt-0.5" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium text-ink">{TYPE_INFO[e.type]?.name ?? e.type}</span>
                            {e.status !== "open" && <StatusBadge status={e.status} />}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted">
                            {[e.tenant_name, e.gl_account && `GL ${e.gl_account}`, e.pool && `${e.pool} pool`]
                              .filter(Boolean)
                              .join(" · ") || e.message}
                          </span>
                        </span>
                        {e.assigned_to_name && (
                          <span
                            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[9px] font-semibold text-ink-2"
                            title={`Assigned to ${e.assigned_to_name}`}
                          >
                            {e.assigned_to_name
                              .split(" ")
                              .map((s) => s[0])
                              .join("")
                              .slice(0, 2)}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="border-t border-line px-3.5 py-2 text-2xs text-muted">
              <kbd className="font-sans">↑</kbd> <kbd className="font-sans">↓</kbd> to move through the queue
            </div>
          </Panel>

          {active ? (
            <ExceptionDetail
              key={active.id}
              exc={active}
              users={users.data ?? []}
              results={run?.results ?? []}
              base={ctx.base}
              propertyName={ctx.property.name}
              periodLabel={run?.period_label ?? ""}
              onChanged={() => {
                exc.reload();
                reloadReadiness();
              }}
            />
          ) : (
            <Panel>{exc.loading ? <Skeleton className="m-6 h-40" /> : <EmptyState title="Select an exception" />}</Panel>
          )}
        </div>
      )}
    </>
  );
}

function ExceptionDetail({
  exc,
  users,
  results,
  base,
  propertyName,
  periodLabel,
  onChanged,
}: {
  exc: AuditExc;
  users: User[];
  results: Result[];
  base: string;
  propertyName: string;
  periodLabel: string;
  onChanged: () => void;
}) {
  const hist = useLoad(() => api.get<HistoryItem[]>(`/exceptions/${exc.id}/history`), [exc.id, exc.status]);
  const { ask, dialog } = useNoteDialog();
  const [trace, setTrace] = useState<Result | null>(null);
  const info = TYPE_INFO[exc.type];
  const tenantResult = exc.tenant_id ? results.find((r) => r.tenant_id === exc.tenant_id) : undefined;
  const actions = (ACTIONS[exc.status] ?? []).filter((a) => !(exc.severity === "error" && a.to === "resolved"));
  const blocking = exc.severity === "error" && OPEN.includes(exc.status);
  const fixHref = info?.fix ? `${base}/${info.fix}` : null;

  return (
    <Panel className="min-w-0">
      <div className="border-b border-line px-6 py-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <SeverityIcon severity={exc.severity} />
          <span className="text-xs font-medium text-muted">
            {exc.severity === "error" ? "Blocking error" : exc.severity === "warning" ? "Warning" : "Info"}
          </span>
          <span className="text-subtle">·</span>
          <span className="font-mono text-2xs text-muted">{exc.type}</span>
          <StatusBadge status={exc.status} className="ml-auto" />
        </div>
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">{info?.name ?? exc.type}</h2>
        <p className="mt-1 text-base text-ink-2">{exc.message}</p>
      </div>

      <div className="grid gap-px bg-line md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-7 bg-surface px-6 py-5">
          {info && (
            <section>
              <h3 className="mb-1.5 text-sm font-semibold">How to clear it</h3>
              <p className="text-sm text-ink-2">{info.help}</p>
              {fixHref && (
                <Link href={fixHref} className={cn(buttonVariants({ size: "xs" }), "mt-3")}>
                  {info.cta}
                  <ArrowRight />
                </Link>
              )}
            </section>
          )}

          <section>
            <h3 className="mb-2 text-sm font-semibold">Supporting data</h3>
            <KeyValue
              items={[
                ["Property", propertyName],
                ["Tenant", exc.tenant_name ?? "—"],
                ["GL account", exc.gl_account ?? "—"],
                ["Pool", exc.pool ?? "—"],
                [
                  "Amount",
                  <span key="a" className="tabular">
                    {money(exc.amount)}
                  </span>,
                ],
                ["Linked transactions", exc.transaction_ids.length ? String(exc.transaction_ids.length) : "—"],
                ["Raised", fmtDateTime(exc.created_at)],
              ]}
            />
          </section>

          {tenantResult && (
            <section>
              <h3 className="mb-2 text-sm font-semibold">Relevant calculation</h3>
              <div className="rounded-[var(--radius-md)] border border-line">
                {tenantResult.status === "calculated" ? (
                  <dl className="grid grid-cols-3 divide-x divide-line">
                    {[
                      ["Provisional share", tenantResult.total],
                      ["Billed in window", tenantResult.billed],
                      ["Variance", tenantResult.variance],
                    ].map(([k, v]) => (
                      <div key={k} className="px-3.5 py-2.5">
                        <dt className="text-xs text-muted">{k}</dt>
                        <dd
                          className={cn(
                            "mt-0.5 text-md font-semibold tabular",
                            k === "Variance" && sign(v) > 0 && "text-under",
                            k === "Variance" && sign(v) < 0 && "text-over",
                          )}
                        >
                          {money(v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="px-3.5 py-2.5 text-sm text-error">No amount calculated. {tenantResult.unresolved_reasons.join(" ")}</p>
                )}
                <div className="border-t border-line px-3.5 py-2">
                  <button
                    onClick={() => setTrace(tenantResult)}
                    className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                  >
                    Open calculation trace
                    <ArrowRight className="size-3" />
                  </button>
                </div>
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-3 text-sm font-semibold">History</h3>
            {hist.data?.length ? (
              <ol className="relative space-y-4 border-l border-line pl-4">
                {hist.data.map((h, i) => (
                  <li key={i} className="relative text-sm">
                    <span
                      className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-line-strong"
                      aria-hidden
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={h.decision} />
                      <span className="text-xs text-muted">
                        {h.reviewer} · {fmtDateTime(h.at)}
                      </span>
                    </div>
                    <p className="mt-1 text-ink-2">{h.note}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted">No reviewer actions yet.</p>
            )}
          </section>
        </div>

        <aside className="space-y-5 bg-surface-2/60 px-5 py-5" aria-label="Resolution">
          <div>
            <h3 className="mb-2 text-xs font-medium text-muted">Resolution</h3>
            {blocking && (
              <p className="mb-3 rounded-[var(--radius-md)] bg-error-bg px-3 py-2 text-xs text-error">
                Blocking errors cannot be marked resolved by hand. Fix the data and re-run, or accept with a documented reason.
              </p>
            )}
            <div className="flex flex-col gap-2">
              {actions.map((a, i) => (
                <Button
                  key={a.to}
                  className="w-full justify-center"
                  variant={i === 0 && a.to !== "open" ? "primary" : "secondary"}
                  onClick={() =>
                    ask({
                      title: a.label,
                      confirm: a.label,
                      description:
                        a.to === "accepted"
                          ? "Accepting keeps the exception on the audit record with your reason. It does not change any figure."
                          : undefined,
                      placeholder: a.to === "accepted" ? "Why this is acceptable, and who agreed" : "What you checked",
                      onSubmit: async (note) => {
                        await api.patch<AuditExc>(`/exceptions/${exc.id}`, { status: a.to, note });
                        toast.success(`Marked ${a.to.replace("_", " ")}`);
                        onChanged();
                      },
                    })
                  }
                >
                  {a.label}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="assignee" className="mb-1.5 block text-xs font-medium text-muted">
              Assignee
            </label>
            <Select
              id="assignee"
              aria-label="Assignee"
              value={exc.assigned_to ?? ""}
              onChange={async (e) => {
                await api.put<AuditExc>(`/exceptions/${exc.id}/assignee`, { user_id: e.target.value || null });
                toast.success("Assignee updated");
                onChanged();
              }}
            >
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium text-muted">Reviewer note</h3>
            <p className="text-sm text-ink-2">{exc.resolution_note || "—"}</p>
          </div>
        </aside>
      </div>
      {dialog}
      <TraceInspector result={trace} onClose={() => setTrace(null)} periodLabel={periodLabel} />
    </Panel>
  );
}
