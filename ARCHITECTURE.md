> v0.1 document, kept for history. The current version is [docs/ARCHITECTURE_V2.md](docs/ARCHITECTURE_V2.md).

# Architecture

## Components

```
Browser ──> Next.js (frontend/, port 3000)
              │  /api/* rewrite (same origin, httpOnly session cookie)
              ▼
            FastAPI (backend/app, port 8000)
              │  routers: core, data, rules, audits
              │  services: imports, audit, reports
              ▼
            veyra_engine (backend/veyra_engine)   pure Python, no I/O
              ▲
            PostgreSQL 16 (SQLAlchemy 2, Alembic)
```

Decisions:

1. The calculation engine is a pure function, `run_audit(AuditInput) -> AuditOutput`, over frozen dataclasses. It has no database or web imports. This keeps every rule testable in isolation and makes results reproducible from a stored input.
2. The service layer (`app/services/audit.py`) loads org-scoped rows, builds the engine input, hashes it (`input_hash`), runs the engine, and stores results, traces and exceptions.
3. The browser only talks to Next.js. Next.js proxies `/api/*` to FastAPI, so the session cookie is first-party and CORS is not needed.
4. Uploaded files are stored as bytes in `source_files` with a SHA-256. They are never rewritten. Every GL and billing row keeps its import batch and source row number.
5. Money is `Decimal` in Python, `NUMERIC(14,2)` in Postgres, and strings in JSON. The UI formats strings with BigInt and never does float math on money.

## Data model

All tables have UUID primary keys and `created_at`/`updated_at`. Every table except `organizations` has `organization_id`, and every API read goes through `app/scoping.py`, which filters by the caller's organization and returns 404 for rows owned by another organization.

| Table | Purpose |
| --- | --- |
| organizations, users | Tenancy and sign-in |
| properties, reporting_periods | Property and audit window (fiscal year start, fiscal year end, through date) |
| tenants, leases | Tenant area, lease dates, linked lease rule, lease document reference |
| lease_rules, allocation_rules | One rule per lease, one allocation row per pool it pays into |
| expense_categories | Category code, pool, controllable flag, variable flag |
| source_files, import_batches | Original bytes, column map, accepted count, rejected rows with errors |
| gl_transactions, cam_billings | Imported rows with source row tracking |
| expense_mappings | GL account to category and recoverability, with reviewer and explanation |
| audit_runs, audit_results, calculation_traces | Each run, per-tenant result, per-tenant step trace |
| exceptions, review_decisions | Issues found by a run and the reviewer decisions on them |
| audit_log | Append-only before/after log of every change |

The schema is created by `backend/alembic/versions/0001_initial_schema.py`.

## Calculation engine

Order of operations for each tenant and each pool in its approved rule:

1. Validate the period. Transactions outside fiscal year start through the through date are excluded and flagged.
2. Keep only transactions whose GL account has a reviewed `recoverable` mapping. Unmapped and needs-review accounts are excluded and flagged. Recoverability is never inferred from account names.
3. Flag duplicate candidates (same account, date, amount, normalized description). They stay included until a reviewer excludes one.
4. Build pool totals by category.
5. Share: `rentable_area / denominator_sqft` for pro-rata (denominator comes from the lease rule, never from total building area), or the stated fixed percentage.
6. Remove lease-excluded categories.
7. Gross-up: variable categories times `target / actual` occupancy when actual is below target.
8. Base year: `max(0, pool - base_year_amount * ytd_days / year_days)`.
9. Tenant share: `net_pool * share * occupied_days / ytd_days`.
10. Non-cumulative cap: reduce by `max(0, controllable_share - prior_year * (1 + cap_pct) * ytd_days / year_days)`.
11. Round each pool line to cents, half up.
12. Admin fee: once per tenant, on the listed pools, before or after the cap as the rule states.
13. Variance: `total - YTD billed`. Positive means billed less than the provisional share.

Provisional prorations (base year and cap prorated by elapsed days) are stated in the trace for every tenant they touch.

The engine returns an unresolved tenant with an error, and no number, when:

- the tenant has no approved lease rule, no lease start, or no rentable area for a pro-rata pool
- a pro-rata pool has no denominator, or a fixed-percentage pool has no percentage
- a tenant share exceeds 100%
- a gross-up lacks target or actual occupancy
- a cap lacks its percentage or prior-year amount
- an admin fee and a cap exist and the rule does not state their order
- a cap is cumulative or CPI-based, a pool combines base year and cap, or the rule lists free-text unsupported terms

Rounding differences between the sum of rounded lines and the rounded unrounded total are reported per pool. No plug is applied.

## API

All routes are under `/api/v1` and require a session except login.

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET|POST /properties`, `GET|PUT /properties/{id}`, `GET /dashboard`
- `GET|POST /properties/{id}/periods`, `/tenants`, `/categories`; `PUT|DELETE /tenants/{id}`
- `POST /properties/{id}/imports` (upload and preview), `POST /imports/{id}/commit`, `GET /properties/{id}/imports`
- `GET /properties/{id}/gl-accounts`, `GET /properties/{id}/gl-transactions`, `PUT /properties/{id}/mappings/{gl_account}`
- `POST /gl-transactions/{id}/exclude|include`
- `GET|POST /properties/{id}/lease-rules`, `PUT /lease-rules/{id}`, `POST /lease-rules/{id}/approve|unapprove`
- `POST|GET /properties/{id}/audit-runs`, `GET /audit-runs/{id}`, `GET /audit-results/{id}/trace`
- `GET /audit-runs/{id}/exceptions`, `PATCH /exceptions/{id}`
- `GET /audit-runs/{id}/reports/{kind}.xlsx` with kind in classification, allocation, missing-information, exceptions, readiness, package

## Frontend

Next.js App Router with Tailwind. Components in `frontend/components/ui` follow the shadcn/ui pattern (class-variance-authority, tailwind-merge). They were written by hand because the shadcn registry was not reachable from the build environment. They can be swapped for `npx shadcn add` output without changing pages.

## Operating costs (estimate, unverified)

A single small VM or managed container (about $10 to $25 per month), managed Postgres (about $15 to $30 per month), domain and email (about $2 per month). Check current provider pricing before committing.
