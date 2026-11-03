# Veyra

Every expense accounted for. Every recovery explained.

Veyra v0.1 is a CAM pre-close audit and reconciliation readiness tool for small commercial portfolios (2 to 15 properties, 20 to 150 tenants). It loads one property's year-to-date general ledger, tenant CAM billings and structured lease rules, computes provisional tenant allocations, flags missing data and potential discrepancies, and exports reviewable Excel workbooks.

It is an accountant-review workflow. It does not interpret leases, does not produce a final year-end reconciliation, and does not claim that a variance is a billing error.

## What works today

| Area | Status |
| --- | --- |
| Properties, periods, tenants, expense categories | Working, audit logged |
| CSV/XLSX import with preview, column mapping, row-level validation, duplicate flags, import history | Working, tested |
| Reviewed GL mappings (recoverable, nonrecoverable, needs review) with reviewer, timestamp, explanation | Working, tested |
| Lease rules: draft, approve, lock, return to draft; spreadsheet import | Working, tested |
| Deterministic engine (Decimal money, traces, exceptions) | Working, 33 unit tests |
| Audit runs, exceptions, review decisions, calculation traces | Working, tested |
| Five Excel reports plus a combined package | Working, tested |
| Synthetic demo checked against an independent expected-results workbook | Working, tested |
| Web UI: dashboard, properties, tenants, import, mapping, lease rules, audit workspace, exceptions, reports | Working, browser-checked |

Not built on purpose: AI lease reading, ERP integrations, tenant invoicing, portals, payments, final approval. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Run it locally

Requirements: Python 3.13 with [uv](https://docs.astral.sh/uv/), Node 22 with pnpm, PostgreSQL 16 (or Docker).

With Docker:

```bash
cp .env.example .env
docker compose up --build
docker compose exec api python -m app.demo_seed --reports
```

Without Docker:

```bash
make setup
export VEYRA_DATABASE_URL=postgresql+psycopg://veyra:veyra@localhost:5432/veyra
make demo
make api
```

In a second terminal:

```bash
make web
```

Open http://localhost:3000 and sign in as `demo@veyra.local` with password `veyra-demo-2026`.

## Tests

```bash
export VEYRA_TEST_DATABASE_URL=postgresql+psycopg://veyra:veyra@localhost:5432/veyra_test
make test
```

Engine tests need no database. API tests rebuild the schema from the Alembic migration in the test database, so point `VEYRA_TEST_DATABASE_URL` at a database you can wipe.

## Demo dataset

`demo/` holds a fictional retail center, Mesquite Crossing, with 8 fictional tenants and 9 months of synthetic GL. It has planted problems: a duplicate invoice, an unreviewed GL account, a capital item, a transaction after the audit date, a tenant without rentable area, a tenant without a lease rule, and an unsupported CPI cap. `demo/expected.py` recomputes the expected results without importing the engine and writes `demo/data/expected_results.xlsx` with live Excel formulas.

## Documents

- [ARCHITECTURE.md](ARCHITECTURE.md): components, data model, calculation rules
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): milestones, status, what is next
- [SECURITY.md](SECURITY.md): current controls and what must be done before real customer data
- [docs/VALIDATION.md](docs/VALIDATION.md): target customer, workflow, competitors, 7-day sales plan, pilot offer
