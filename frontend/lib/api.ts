export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    credentials: "include",
    ...init,
    headers: init.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init.headers },
  });
  if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {}
    throw new ApiError(res.status, msg);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }),
  put: <T>(p: string, body: unknown) => request<T>(p, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(p: string, body: unknown) => request<T>(p, { method: "PATCH", body: JSON.stringify(body) }),
  del: (p: string) => request<void>(p, { method: "DELETE" }),
};

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
  gl_account: string; account_name: string; transaction_count: number; total: string;
  category_code: string | null; status: string; explanation: string; source_ref: string;
  reviewer: string | null; reviewed_at: string | null;
};
export type GLTransaction = {
  id: string; gl_account: string; account_name: string; txn_date: string; amount: string; vendor: string;
  description: string; source_row: number; import_batch_id: string; excluded_by_review: boolean;
};
export type ImportBatch = {
  id: string; kind: string; status: string; row_count: number; accepted_count: number;
  rejected_rows: { row: number; errors: string[]; values: Record<string, string> }[];
  column_map: Record<string, string>; created_at: string; filename: string;
};
export type ImportPreview = {
  batch: ImportBatch; columns: string[]; rows: Record<string, string>[]; required_fields: string[];
  optional_fields: string[]; suggested_map: Record<string, string>; warnings: string[];
};
export type AllocationRule = {
  id?: string; pool: string; method: string; denominator_sqft: string | null; fixed_pct: string | null;
  excluded_categories: string[]; base_year_amount: string | null; gross_up_enabled: boolean;
  gross_up_target: string | null; gross_up_actual: string | null; cap_kind: string | null;
  cap_pct: string | null; cap_prior_year: string | null;
};
export type LeaseRule = {
  id: string; ref: string; status: string; admin_fee_pct: string | null; admin_fee_pools: string[];
  admin_fee_order: string | null; unsupported_terms: string[]; source_ref: string; notes: string;
  approved_at: string | null; pools: AllocationRule[];
};
export type Line = { pool: string; tenant_pool_amount: string; share: string; amount_unrounded: string; amount: string; cap_reduction: string };
export type Result = {
  id: string; tenant_id: string; tenant_name: string; suite: string; status: string; lines: Line[];
  admin_fee: string; total: string | null; billed: string | null; variance: string | null; unresolved_reasons: string[];
};
export type PoolSummary = { recoverable_total: string; allocated_total: string; rounding_difference: string; by_category: Record<string, string> };
export type AuditRun = {
  id: string; period_id: string; provisional: boolean; input_hash: string; created_at: string;
  summary: {
    pools: Record<string, PoolSummary>; excluded: Record<string, string[]>; included_count: number;
    tenants_calculated: number; tenants_unresolved: number; exception_counts: Record<string, number>;
    period: { fiscal_year_start: string; fiscal_year_end: string; through_date: string };
  };
  results?: Result[];
};
export type AuditExc = {
  id: string; type: string; severity: string; message: string; tenant_name: string | null;
  gl_account: string | null; pool: string | null; amount: string | null; status: string;
  resolution_note: string; transaction_ids: string[];
};
export type TraceStep = { label: string; formula: string; result: string; inputs: Record<string, string> };
