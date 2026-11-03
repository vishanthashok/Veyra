# Architecture v0.2

Veyra is a modular monolith: one FastAPI process, one Next.js process, one PostgreSQL database. There are no queues, workers or microservices. Nothing measured so far needs them (see Performance).

```
Browser
  │  same-origin requests, httpOnly session cookie
  ▼
Next.js 16 (frontend/)            app shell, pages, DataTable, dialogs
  │  /api/* rewrite
  ▼
FastAPI (backend/app)
  ├─ core/        errors (envelope), middleware (request ID, JSON logs, security headers), ratelimit
  ├─ auth.py      argon2 passwords, signed session token with session_version
  ├─ scoping.py   organization-scoped reads, audit log, idempotency key validation
  ├─ routers/     core (auth, properties, tenants, dashboard), imports, mappings, rules, audits
  ├─ services/
  │   ├─ imports.py   parsing (CSV/XLSX as text), row validation, TenantMatcher, staging inserts
  │   ├─ snapshot.py  freeze inputs to JSON, rebuild engine input from JSON
  │   ├─ audit.py     execute, summarize, persist, verify
  │   └─ reports.py   Excel workbooks from snapshot + stored results
  └─ models.py    SQLAlchemy 2 models (Alembic 0001, 0002)
  ▼
veyra_engine (backend/veyra_engine)   pure Python, no I/O, strict mypy
  eligibility → pools → allocation → billing → invariants
```

## Module boundaries

| Layer | Owns | Must not |
| --- | --- | --- |
| `veyra_engine` | Financial rules, rounding, traces, invariants | Import FastAPI, SQLAlchemy or read files |
| `services/snapshot` | The only translation between DB rows and engine input | Compute money |
| `services/audit` | Run lifecycle, persistence, reproducibility check | Read live tables after the snapshot is taken |
| `services/reports` | Workbook layout | Read live mappings, rules or transactions |
| `services/imports` | File parsing, validation, staging | Commit transactions |
| `routers/*` | HTTP shape, authorization via `get_owned`/`scoped`, transactions | Contain business rules |

## Request lifecycle

1. Middleware assigns `X-Request-ID` (or accepts a safe incoming one) and times the request.
2. `current_actor` verifies the session token signature, age and `session_version`.
3. The router loads every referenced row through `get_owned`, which returns 404 for rows of another organization.
4. Services stage changes in one SQLAlchemy session. The router commits once.
5. Errors leave through one handler as `{"error": {code, message, details, request_id}}`. Unhandled errors log a stack trace with the request ID and return a generic message.
6. Middleware adds security headers and writes one JSON access log line.

## Audit run lifecycle

```
POST /properties/{id}/audit-runs  (Idempotency-Key optional)
  build_snapshot(db)         -> JSON: period, transactions + provenance, mappings + versions,
                                categories, approved rules + versions, tenants, billings, source files
  input_from_snapshot(json)  -> AuditInput
  run_audit(input)           -> AuditOutput   (invariants checked; violation raises, nothing saved)
  persist                    -> audit_runs (snapshot, input_hash, engine_version, summary),
                                audit_results, calculation_traces, exceptions, audit_log
POST /audit-runs/{id}/verify -> re-run from stored snapshot, compare with stored results
```

Because the engine only ever sees `input_from_snapshot(snapshot)`, the live run and any later re-run use the same code path. `test_old_run_stays_reproducible_after_inputs_change` changes a rule and a mapping after a run and verifies the run still reproduces exactly.

## Import lifecycle

```
upload   -> source_files (bytes, sha256), import_batches(status=uploaded, parser_version)
validate -> dry run: stage rows, report accepted/rejected/warnings, roll back
commit   -> stage rows, one transaction; on any failure roll back and mark the batch failed
errors.csv -> rejected rows with reasons, downloadable
```

An identical file already committed for the same property and kind returns 409 unless `allow_duplicate_file` is set.

## Database

Migration `0002` is additive: new columns with server defaults, two unique constraints for idempotency, three indexes, and tenant foreign keys changed from `CASCADE` to `RESTRICT` on `cam_billings`, `audit_results` and `exceptions`. No existing rows are rewritten. v0.1 runs keep `snapshot = NULL` and are labeled legacy; their reports return 409 rather than a report built from today's data.

Indexes added after reading query plans for the hot paths: `gl_transactions(property_id, gl_account, txn_date)` for account drill-down and pagination, `audit_runs(property_id, created_at)` for latest-run lookups, `review_decisions(target_type, target_id)` for histories.

## API conventions

- All routes under `/api/v1`. Decimal values are JSON strings.
- Lists that can grow without bound are paginated: `GET .../gl-transactions?page=&page_size=&gl_account=&q=&excluded=` returns `{items, total, page, page_size}`.
- Filters are query parameters (`status`, `severity`, `type` on exceptions).
- `Idempotency-Key` header is honored on uploads and audit runs, scoped to the organization.
- Health: `GET /api/health` returns database readiness.

## Performance (measured, `backend/scripts/bench.py`)

| Operation | Size | Before | After |
| --- | --- | --- | --- |
| Engine, invariants on | 50,000 txns, 150 tenants | 466 ms | unchanged |
| Engine, invariants on | 10,000 txns, 50 tenants | 53 ms | unchanged |
| GL validate (dry run) | 20,000 rows | 8.0 s | 2.4 s |
| GL commit | 20,000 rows | 8.0 s | 2.3 s |
| Audit run end to end | 20,000 txns, 100 tenants | 1.8 s | 1.6 s |
| Full report package | 20,000 txns, 100 tenants | 20.8 s | 6.3 s |
| Dashboard | 1 property | 288 ms | 317 ms (noise) |

Causes found with cProfile: `DataFrame.iterrows` and per-row ORM objects in imports; per-cell openpyxl style objects in reports. Remaining report time is openpyxl serialization. If customers need larger exports, the next step is `write_only` workbooks for the classification sheet.

## Deployment

Same as v0.1 (`docker-compose.yml`). New settings: `VEYRA_ENV=production` makes startup fail without a strong `VEYRA_SECRET_KEY` and `VEYRA_COOKIE_SECURE=true`. `VEYRA_LOG_LEVEL` controls JSON logs. Error monitoring: every 5xx is logged with `request_id` and a stack trace by the `veyra.errors` logger; ship those logs to the monitoring tool of choice (no vendor SDK is bundled).
