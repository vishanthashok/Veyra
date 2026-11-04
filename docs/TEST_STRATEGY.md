# Test strategy

The rule: tests check behavior against independent expectations, not mocked responses. Financial tests use hand-computed values written in comments, or `demo/expected.py`, which recomputes with `Fraction` and never imports the engine.

## Layers

| Layer | Tool | Where | Count | What it proves |
| --- | --- | --- | --- | --- |
| Engine unit | pytest | `backend/tests/engine/test_engine.py` | 33 | v0.1 characterization: every supported rule, unsupported rules, missing data, rounding |
| Engine domain v0.2 | pytest | `backend/tests/engine/test_engine_v02.py` | 14 | Credits, negative pools, category-specific exclusions, partial years, fee validation, determinism, version changes, invariant detection |
| Engine property | Hypothesis | same file | 150 examples | Invariants hold for random portfolios with credits, unmapped and out-of-period rows |
| API integration | pytest + TestClient + real Postgres | `backend/tests/api/test_api.py` | 8 | Demo end to end vs independent expected values, uploads, mappings, rule locking, isolation |
| Regressions | same | `backend/tests/api/test_regressions_v02.py` | 11 | Each audit finding F-01 to F-10, written to fail on v0.1 first |
| v0.2 features | same | `backend/tests/api/test_v02_features.py` | 17 | Activity feed built from real records, dashboard period and exception types, reproducibility after data changes, atomic import with injected failure, dry run, error CSV, idempotency, bulk mapping, exception lifecycle, isolation across 13 endpoints, readiness, config guard, demo figures unchanged |
| Workflows API | pytest + TestClient + real Postgres | `backend/tests/api/test_workflows.py` | 13 | All five templates end to end, versioning, validation and cycles, Decimal precision, approve/reject, cancel while waiting and mid-run, retry policy, run retry, idempotency, safe errors, export injection, organization isolation; tenant allocation equals the audit run |
| Workflow units | pytest | `backend/tests/workflows/test_units.py` | 23 | Parsing (sheets, header row, limits, duplicate headers), formula whitelist, graph order and cycles, cleaner, dedupe, filter, mapper, classification, billing comparison, lease rule check |
| Migrations | Alembic | CI | n/a | `upgrade head`, `downgrade base`, `upgrade head`, `alembic check` (models match migrations) |
| Frontend unit | Vitest | `frontend/tests/format.test.ts` | 9 | Money, percent, sign, decimal compare and subtraction without floats |
| Frontend component | Vitest + Testing Library | `frontend/tests/data-table.test.tsx`, `note-dialog.test.tsx` | 8 | Numeric sort, filters, selection and bulk actions, keyboard rows, note validation, error display, text labels |
| Overview logic | Vitest + Testing Library | `frontend/tests/overview.test.tsx` | 7 | Action ranking and dedupe, next-step choice, ActionList links, activity grouping, metric strip |
| Workflow UI | Vitest + Testing Library | `frontend/tests/workflows.test.tsx` | 5 | Step ids, defaults, durations, data preview, config form editing |
| End to end | Playwright | `frontend/e2e/workflow.spec.ts`, `overview.spec.ts`, `workflows.spec.ts` | 8 | Workflows: create from template, drag steps onto the canvas, connect and configure them, save a version, upload and run, review errors, download outputs, rerun with a new file, approval gate;  Action center links to the fix; sidebar groups, active state and collapse; mobile drawer without overflow; New property from import to verified audit with hand-computed figures; blocking errors cannot be resolved by hand; skip link and command palette |
| Visual | Playwright | `frontend/e2e/screenshots.spec.ts` | 1 | Captures `docs/screenshots`; desktop screens plus overview, audit and exceptions at 1280, 768 and 390 px; asserts no horizontal page overflow |
| Static | ruff, mypy --strict (engine), ESLint, tsc strict, Prettier | CI | n/a | Lint, types, formatting |
| Dependencies | pip-audit, pnpm audit | CI (report-only) | n/a | Known vulnerabilities |
| Performance | `backend/scripts/bench.py` | manual | n/a | Engine, import, run and report timings at 20,000 to 50,000 rows |

Totals at the time of writing: 120 backend, 29 frontend unit/component, 8 end-to-end.

## Running

```bash
cd backend && VEYRA_TEST_DATABASE_URL=postgresql+psycopg://veyra:veyra@localhost:5432/veyra_test uv run pytest -q
```

```bash
cd frontend && pnpm test
```

End to end needs the API on :8000 with `python -m app.demo_seed` and `pnpm start` on :3000:

```bash
cd frontend && pnpm e2e
```

Screenshots:

```bash
cd frontend && SCREENSHOTS=1 pnpm e2e e2e/screenshots.spec.ts
```

## Rules for new tests

1. A change to a calculated number needs a test with the arithmetic in a comment.
2. A bug fix starts with a failing test.
3. Do not weaken or delete a test to make a change pass. If expected behavior changes, say why in the commit.
4. API tests use a real database. Do not mock the ORM.
5. The e2e workflow must stay independent of earlier runs (it creates its own property or a fresh audit run).

## Gaps

- No load test beyond `bench.py`.
- No automated accessibility scanner (axe). Keyboard paths and labels are covered by component and e2e tests; contrast is checked by token values.
- No cross-browser e2e (Chromium only).
