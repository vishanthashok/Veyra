# Engineering audit, v0.1 to v0.2

Date: 2026-11-03. Baseline: `main` at `e728c7c` (v0.1 merged).

## Method

1. Read every backend module (`app/`, `veyra_engine/`, `alembic/`), every frontend page and the demo pipeline.
2. Ran the suite on the baseline: 41 passed (33 engine, 8 API). `pnpm lint` and `pnpm build` passed.
3. Ran the app (FastAPI on :8000, Next.js on :3000) and walked every screen in Chromium.
4. For each suspected defect, wrote a failing test first in `backend/tests/api/test_regressions_v02.py`. The "Evidence" column quotes the baseline failure. Each test now passes and stays as a regression guard.

## Severity scale

- P0: financial correctness, data exposure or destructive data risk
- P1: broken workflow, missing authorization, serious reliability problem
- P2: maintainability, UX, performance, accessibility
- P3: cosmetic or optional

## P0

| ID | Finding | Code | Evidence on baseline | Fix |
| --- | --- | --- | --- | --- |
| F-01 | Billing and lease-rule imports match tenants by a name dict and a suite dict. Two tenants with the same name collapse to one key, so billings land on whichever tenant was loaded last. Variances are then wrong for both tenants with no warning. | `app/routers/data.py` `by_name = {t.name.lower(): t ...}` | `test_ambiguous_tenant_name_is_rejected_not_misassigned`: `assert 2 == 1` (both rows accepted, one assigned to the wrong tenant) | Match must be unique across name and suite. Ambiguous rows are rejected with a reason. |
| F-02 | Deleting a tenant cascades to `cam_billings`, `audit_results` and `exceptions` (`ondelete="CASCADE"`). One click destroys billing records and audit history. | `app/models.py` `CamBilling.tenant_id`, `AuditResult.tenant_id`; `app/routers/core.py` `delete_tenant` | `test_tenant_with_financial_records_cannot_be_deleted`: `assert 204 == 409` | API refuses deletion when billings or audit results exist (409). Migration 0002 changes those FKs to `RESTRICT` so the database enforces it too. |
| F-03 | Audit runs are not reproducible. Runs stored only a hash of inputs. Reports for an old run re-read current GL mappings and transactions, so after a reviewer changes a mapping, the old run's report shows classifications the run never used. | `app/services/reports.py` `load_context` reads live `ExpenseMapping`, `GLTransaction` | `test_old_audit_run_report_uses_its_own_snapshot`: `{'nonrecoverable'} == {'recoverable'}` | Each run stores a normalized input snapshot (transactions, mappings, categories, tenants, approved rules, billings), engine version and rounding policy. Reports and the run view read only the snapshot. |
| F-04 | An admin fee configured on a pool the tenant does not pay into is silently dropped. The tenant is reported as calculated with no fee. | `veyra_engine/engine.py` admin fee block filters `fee_lines` by `pr.pool in af.pools` | `test_admin_fee_on_pool_tenant_does_not_pay_is_unresolved`: `'calculated' == 'unresolved'` | Fee pools must be a subset of the tenant's pools, otherwise the tenant is unresolved with `MISSING_RULE_TERM`. Same check for empty fee pool lists. |

## P1

| ID | Finding | Code | Evidence | Fix |
| --- | --- | --- | --- | --- |
| F-05 | A blocking error (missing rule, missing area) can be marked `resolved` by hand without changing data. Missing-data errors can be silently dismissed. No per-exception history endpoint. | `app/routers/audits.py` `patch_exception` | `test_blocking_error_cannot_be_marked_resolved_by_hand`: `200 == 422` | Lifecycle open, in_review, resolved, accepted, reopened. Errors cannot be `resolved` manually. They clear by fixing data and re-running, or are `accepted` with a note and stay visible. History endpoint added. Assignee field added. |
| F-06 | Committing the same file twice double-counts every GL row. Only a warning is shown at preview. | `app/routers/data.py` `commit` | `test_committing_identical_file_twice_requires_confirmation`: `200 == 409` | Commit returns 409 for an already committed identical file unless `allow_duplicate_file` is set. |
| F-07 | Logout only deletes the browser cookie. The signed token stays valid for 8 hours if copied. | `app/auth.py` | `test_logout_revokes_session`: `200 == 401` | `users.session_version` is embedded in the token and incremented on logout. |
| F-08 | No login throttling. Unlimited password guesses. | `app/routers/core.py` `login` | `test_login_is_rate_limited`: `401 == 429` | In-process sliding window per email and per IP (5 failures per 15 minutes). Documented as single-instance only. |
| F-09 | Double-clicking "Run audit" or retrying a timed-out request creates duplicate runs. Same for uploads. | `app/routers/audits.py` `create_run` | `test_audit_run_idempotency_key`: different run IDs | `Idempotency-Key` header on audit runs and uploads, stored per organization. |
| F-10 | Errors have three shapes (`detail` string, `detail` list, plain 500). No request ID, no security headers, no structured logs. | `app/main.py` | `test_errors_use_consistent_envelope_and_request_id`: `KeyError: 'error'` | Error envelope `{error: {code, message, details, request_id}}`, `X-Request-ID`, security headers, JSON logs. |
| F-11 | The app starts with the default secret key `dev-only-change-me` even with secure cookies on. | `app/config.py` | Code inspection | Startup refuses a default or short key when `VEYRA_ENV=production`. |
| F-12 | Lease-rule import accepted a row for an approved rule's tenant link even if the tenant's current rule was approved, relinking it silently. | `app/routers/data.py` `_commit_rules` | Code inspection: `t.lease_rule_id = lr.id` with a warning only | Relinking a tenant away from an approved rule now rejects the row. |

## P2

| ID | Finding | Fix in v0.2 |
| --- | --- | --- |
| F-13 | GL transaction list is unpaginated. The demo is small, but a 12-month GL for 15 properties can be 50,000 rows. | Paginated `{items, total, page, page_size}` with filters. |
| F-14 | Dashboard runs about 6 queries per property (N+1). | Aggregated queries. |
| F-15 | `set_mapping` recomputes all accounts to return one. | Single-account query. |
| F-16 | Reviewer notes use `window.prompt`: not accessible, no validation, no cancel feedback. | Accessible dialog component with focus trap. |
| F-17 | Clickable table rows are not keyboard reachable. Variance meaning relies on color. | Buttons in rows, text direction labels. |
| F-18 | No CI, no Python lint or type check, no formatter, no frontend tests, no committed browser test. | Ruff, mypy, Prettier, Vitest, Playwright, GitHub Actions. |
| F-19 | Engine is one 340-line module mixing filtering, pooling, allocation and fees. | Split into staged modules with an invariants pass. Characterization tests run unchanged before and after. |
| F-20 | No engine version recorded. A future rule change would alter old results invisibly. | `ENGINE_VERSION` stored per run and printed in reports. |
| F-21 | Reports lack generation timestamp, source summary, assumptions and reviewer status. | Cover sheet added to every workbook. |

## P3

| ID | Finding | Fix |
| --- | --- | --- |
| F-22 | Trace shows 28-digit Decimals. | Display rounded to 6 places in the UI and reports; full precision kept in stored traces. |
| F-23 | Sidebar not collapsible, no breadcrumbs, no command palette. | New shell. |
| F-24 | Generic styling. | Token-based design system (docs/DESIGN_SYSTEM.md). |

## Verified as not a problem

- Organization isolation: every route reads through `get_owned` or `scoped`. Covered by `test_org_isolation`; extended in v0.2 to exceptions, runs, reports and transactions.
- SQL injection: all queries use SQLAlchemy expressions. No raw SQL with user input.
- XSS: React escapes output. No `dangerouslySetInnerHTML`.
- Import atomicity: a commit adds all rows in one transaction and commits once. A parse failure raises before any insert. Covered by a new test that forces a failure mid-commit.
- Money types: no float conversion in the engine or API. The demo generator writes floats into XLSX on purpose to mimic Excel; the parser converts with `repr` and rejects more than 2 decimals.
