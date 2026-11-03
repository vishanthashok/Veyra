export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = "error",
    public requestId: string | null = null,
    public details: unknown = null,
  ) {
    super(message);
  }
}

type Opts = RequestInit & { idempotencyKey?: string };

async function request<T>(path: string, init: Opts = {}): Promise<T> {
  const { idempotencyKey, ...rest } = init;
  const headers: Record<string, string> = {};
  if (!(rest.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`/api/v1${path}`, { credentials: "include", ...rest, headers: { ...headers, ...rest.headers } });
  if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  if (!res.ok) {
    let msg = res.statusText || "Request failed";
    let code = "error";
    let details: unknown = null;
    try {
      const body = await res.json();
      msg = body.error?.message ?? msg;
      code = body.error?.code ?? code;
      details = body.error?.details ?? null;
    } catch {}
    throw new ApiError(res.status, msg, code, res.headers.get("X-Request-ID"), details);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown, opts: Opts = {}) =>
    request<T>(p, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body ?? {}), ...opts }),
  put: <T>(p: string, body: unknown) => request<T>(p, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(p: string, body: unknown) => request<T>(p, { method: "PATCH", body: JSON.stringify(body) }),
  del: (p: string) => request<void>(p, { method: "DELETE" }),
};

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.requestId && e.status >= 500 ? `${e.message} (request ${e.requestId})` : e.message;
  return e instanceof Error ? e.message : String(e);
}

export type Page<T> = { items: T[]; total: number; page: number; page_size: number };
export type Me = { user_id: string; org_id: string; email: string; name: string };
export type User = { id: string; name: string; email: string };

export type Property = {
  id: string; name: string; property_type: string; address: string; total_rsf: string | null;
  fiscal_year_end_month: number; reconciliation_status: string;
};
export type Period = { id: string; label: string; fiscal_year_start: string; fiscal_year_end: string; through_date: string; status: string };
export type Tenant = {
  id: string; name: string; suite: string; rentable_area: string | null; lease_start: string | null;
  lease_end: string | null; allocation_method: string; lease_rule_id: string | null;
};
export type Category = { id: string; code: string; name: string; pool: string; controllable: boolean; variable: boolean };
export type GLAccount = {
  gl_account: string; account_name: string; transaction_count: number; excluded_count: number; version: number;
  total: string; category_code: string | null; status: string; explanation: string; source_ref: string;
  reviewer: string | null; reviewed_at: string | null;
};
export type GLTransaction = {
  id: string; gl_account: string; account_name: string; txn_date: string; amount: string; vendor: string;
  description: string; source_row: number; import_batch_id: string; excluded_by_review: boolean;
};
export type RejectedRow = { row: number; errors: string[]; values: Record<string, string> };
export type ImportBatch = {
  id: string; kind: string; status: string; row_count: number; accepted_count: number; parser_version: string;
  rejected_rows: RejectedRow[]; column_map: Record<string, string>; created_at: string; filename: string; sha256: string;
};
export type ImportPreview = {
  batch: ImportBatch; columns: string[]; rows: Record<string, string>[]; required_fields: string[];
  optional_fields: string[]; suggested_map: Record<string, string>; warnings: string[];
};
export type CommitResult = { batch: ImportBatch; warnings: string[]; dry_run: boolean };
export type AllocationRule = {
  id?: string; pool: string; method: string; denominator_sqft: string | null; fixed_pct: string | null;
  excluded_categories: string[]; base_year_amount: string | null; gross_up_enabled: boolean;
  gross_up_target: string | null; gross_up_actual: string | null; cap_kind: string | null;
  cap_pct: string | null; cap_prior_year: string | null;
};
export type LeaseRule = {
  id: string; ref: string; status: string; version: number; admin_fee_pct: string | null; admin_fee_pools: string[];
  admin_fee_order: string | null; unsupported_terms: string[]; source_ref: string; notes: string;
  approved_at: string | null; approved_by_name: string | null; tenants: string[]; pools: AllocationRule[];
};
export type Line = {
  pool: string; tenant_pool_amount: string; share: string; amount_unrounded: string; amount: string;
  cap_reduction: string; controllable_amount?: string;
};
export type Result = {
  id: string; tenant_id: string; tenant_name: string; suite: string; rentable_area: string | null; status: string;
  lines: Line[]; admin_fee: string; total: string | null; billed: string | null; variance: string | null;
  unresolved_reasons: string[];
};
export type PoolSummary = { recoverable_total: string; allocated_total: string; rounding_difference: string; by_category: Record<string, string> };
export type AuditRun = {
  id: string; period_id: string; period_label: string | null; provisional: boolean; input_hash: string;
  engine_version: string; reproducible: boolean; created_at: string;
  snapshot_counts: Record<string, number>;
  summary: {
    pools: Record<string, PoolSummary>; excluded: Record<string, string[]>; included_count: number;
    transaction_count?: number; tenants_calculated: number; tenants_unresolved: number;
    exception_counts: Record<string, number>; assumptions?: string[]; rounding_policy?: string;
    period: { fiscal_year_start: string; fiscal_year_end: string; through_date: string };
  };
  results?: Result[];
};
export type AuditExc = {
  id: string; audit_run_id: string; type: string; severity: "error" | "warning" | "info"; message: string;
  tenant_id: string | null; tenant_name: string | null; gl_account: string | null; pool: string | null;
  amount: string | null; status: string; resolution_note: string; transaction_ids: string[];
  assigned_to: string | null; assigned_to_name: string | null; created_at: string; updated_at: string;
};
export type HistoryItem = { decision: string; note: string; reviewer: string | null; at: string };
export type TraceStep = { label: string; formula: string; result: string | null; inputs: Record<string, string | null> };
export type SnapshotRule = {
  id: string; ref: string; version: number; approved_at: string | null; approved_by: string | null; source_ref: string;
  admin_fee_pct: string | null; admin_fee_pools: string[]; admin_fee_order: string | null; unsupported_terms: string[];
  pools: AllocationRule[];
};
export type Trace = {
  audit_result_id: string; audit_run_id: string; engine_version: string; input_hash: string;
  tenant: { id: string; name: string; suite: string; rentable_area: string | null; lease_start: string | null; lease_end: string | null } | null;
  lease_rule: SnapshotRule | null; pools: Record<string, PoolSummary>; excluded_counts: Record<string, number>;
  billed: string | null; steps: TraceStep[];
};
export type DashboardRow = {
  id: string; name: string; property_type: string; reconciliation_status: string; tenants: number;
  gl_accounts: number; accounts_needing_review: number; tenants_missing_rules: number; tenants_with_draft_rules: number;
  unapproved_rules: number; tenants_missing_area: number; open_exceptions: Record<string, number>;
  checks: Record<string, boolean>; completeness: number; ready: boolean;
  latest_audit: { id: string; created_at: string; engine_version: string; through_date: string | null; tenants_calculated: number; tenants_unresolved: number } | null;
};
