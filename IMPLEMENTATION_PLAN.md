> v0.1 document, kept for history. The current version is [docs/ENGINEERING_AUDIT.md](docs/ENGINEERING_AUDIT.md).

# Implementation plan and status

Date: 2026-11-03. Product: CAM pre-close audit for calendar-year 2026 books, sold before those books close.

## Milestones

| # | Milestone | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Foundation: repo, FastAPI, Next.js, Postgres, Alembic, Docker Compose | Done | `alembic upgrade head` creates 21 tables. Compose file and Dockerfiles written. |
| 2 | Data import: properties, tenants, CSV/XLSX upload, column mapping, validation, history | Done | `tests/api/test_api.py::test_invalid_rows_are_kept_with_errors`, `test_upload_safety` |
| 3 | Calculation engine, mappings, lease rules, billing comparison | Done | 33 engine tests in `tests/engine/test_engine.py` |
| 4 | Exceptions, review decisions, traces, Excel exports | Done | `test_demo_end_to_end_matches_independent_expected` opens every workbook |
| 5 | Synthetic demo, expected-results check, polish, deployment docs | Done | `make demo`, browser walkthrough of every screen |

## Acceptance criteria

1. Create property and tenants: done.
2. Upload and validate a GL spreadsheet: done.
3. Import tenant billings: done.
4. Enter and review lease rules: done (UI editor and spreadsheet import, approval required).
5. Map expenses to categories: done.
6. Supported allocations calculate correctly: done, checked against hand math and an independent Fraction-based calculation.
7. Missing information generates exceptions: done.
8. Provisional variances clearly labeled: done in UI banner, report banner and column names.
9. Export an Excel audit workbook: done.
10. Synthetic test cases pass: 41 tests pass (33 engine, 8 API).
11. Every number traces to source data and approved rules: done through calculation traces, mapping reviewer records and source row numbers.
12. Runs locally from documented steps: done for the non-Docker path. The Docker path is written but was not run here because no Docker daemon was available.

## Known gaps

- Docker Compose path not executed in the build environment.
- No browser automation test is committed. A Playwright walkthrough was run by hand.
- Billings are compared in total, not per pool, because typical estimate schedules bill one combined amount.
- The cap uses the tenant's prior-year controllable charge as entered. It does not compute it from last year's data.
- Re-running an audit creates new exceptions. Reviewer notes on old runs stay attached to the old run.
- Single organization per user. No roles or invitations.
- Tenant import from spreadsheet is not built. Tenants are entered in the UI or through the API.

## Next, only if a paying pilot needs it

1. Prior-year reconciliation import, so caps and base years come from the same tool.
2. Tenant roster import.
3. Carry exception decisions forward between runs when the underlying item is unchanged.
4. Per-pool billing schedules.
5. Year-end mode: final period, tenant statement drafts, sign-off workflow.
6. Items in SECURITY.md before any real customer file is loaded.
