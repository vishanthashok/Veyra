# Veyra

Every expense accounted for. Every recovery explained.

Veyra is a CAM pre-close audit and reconciliation-readiness tool for small commercial portfolios (2 to 15 properties, 20 to 150 tenants). It loads a property's year-to-date general ledger, tenant billings and structured lease rules, runs a deterministic calculation engine, flags missing data and potential discrepancies, and exports reviewable Excel workbooks.

It is an accountant-review workflow. It does not interpret leases, does not produce a final year-end reconciliation, and never presents a variance as a confirmed billing error.

![Overview](docs/screenshots/02-overview.png)

![Audit workspace](docs/screenshots/08-audit-workspace.png)

## What it does

- **Workflows** turn spreadsheets and property data into reviewed workbooks: a visual builder, five templates (GL cleaner, expense classification, billing comparison, lease rule audit, pre-close readiness), versioned definitions, run history, approval gates and downloadable outputs. See [docs/WORKFLOWS.md](docs/WORKFLOWS.md).

- **Overview** shows what stands between each property and a clean year-end reconciliation: four metrics, a ranked Action center, recent activity from real records and per-property readiness. The v0.3 interface is documented in [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md).

- **Imports** GL, billings and lease-rule spreadsheets through a wizard: upload, map columns, dry-run validation, confirm, results. Commits are atomic. Rejected rows are kept and downloadable. Re-importing an identical file needs confirmation.
- **Expense mapping** in a master-detail review: every account starts as needs review; decisions need an explanation, are versioned and keep history; bulk decisions write one record per account.
- **Lease rules** as structured, versioned terms with a deliberate approval checklist. Unsupported terms are flagged, never guessed.
- **Audit runs** execute from an immutable snapshot of their inputs, record the engine version, and can be re-verified later. Every tenant figure opens an 11-step calculation inspector.
- **Exceptions** form a review queue with assignee, lifecycle (open, in review, resolved, accepted, reopened) and history. Blocking errors cannot be resolved by hand.
- **Reports**: six Excel workbooks with a cover sheet (run ID, engine version, input fingerprint, source files, assumptions, reviewer status), built only from the run's snapshot.

## Deploy

One Heroku app with an Eco dyno and Postgres, about $10/month. Step by step: [docs/DEPLOY_HEROKU.md](docs/DEPLOY_HEROKU.md).

[![Deploy to Heroku](https://www.herokucdn.com/deploy/button.svg)](https://www.heroku.com/deploy?template=https://github.com/vishanthashok/Veyra)

## Run it locally

Requirements: Python 3.13 with [uv](https://docs.astral.sh/uv/), Node 22 with pnpm, PostgreSQL 16 (or Docker).

With Docker:

```bash
cp .env.example .env
docker compose up --build
```

```bash
docker compose exec api python -m app.demo_seed --reports
```

Without Docker:

```bash
make setup
```

```bash
export VEYRA_DATABASE_URL=postgresql+psycopg://veyra:veyra@localhost:5432/veyra
```

```bash
make demo
```

```bash
make api
```

In a second terminal:

```bash
make web
```

Open http://localhost:3000 and sign in as `demo@veyra.local` with password `veyra-demo-2026`. Press Ctrl+K (Cmd+K) to jump anywhere.

## Checks

```bash
export VEYRA_TEST_DATABASE_URL=postgresql+psycopg://veyra:veyra@localhost:5432/veyra_test
```

```bash
make test
```

That runs Ruff, pytest (83 tests, real Postgres), ESLint, TypeScript, Vitest (24 tests) and the production build. End-to-end tests and screenshots are described in [docs/TEST_STRATEGY.md](docs/TEST_STRATEGY.md). CI runs everything, including Playwright, on every pull request.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/ENGINEERING_AUDIT.md](docs/ENGINEERING_AUDIT.md) | v0.1 audit: 27 findings with evidence and fixes |
| [docs/ARCHITECTURE_V2.md](docs/ARCHITECTURE_V2.md) | Modules, lifecycles, database, API conventions, measured performance |
| [docs/CALCULATION_ENGINE.md](docs/CALCULATION_ENGINE.md) | Stages, order of operations, rounding, invariants, unsupported terms |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | Tokens, components, patterns, accessibility |
| [docs/WORKFLOWS.md](docs/WORKFLOWS.md) | Workflow engine, execution semantics, node catalog, templates, API, security |
| [docs/DEPLOY_HEROKU.md](docs/DEPLOY_HEROKU.md) | Deploy to Heroku from zero |
| [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) | Verified controls and open items before real customer data |
| [docs/TEST_STRATEGY.md](docs/TEST_STRATEGY.md) | Test layers and how to run them |
| [docs/VALIDATION.md](docs/VALIDATION.md) | Target customer, workflow, competitors, sales plan |
| [docs/UI_CRITIQUE.md](docs/UI_CRITIQUE.md) | Critique of the v0.2 interface and redesign principles |
| [docs/screenshots](docs/screenshots) | Every major screen, plus overview, audit and exceptions at 1280, 768 and 390 px |

## Security status

Synthetic data only. Veyra is not production-secure yet. [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) lists what must be done before loading real leases or ledgers.
