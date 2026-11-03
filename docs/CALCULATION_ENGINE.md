# Calculation engine

`backend/veyra_engine`, version `ENGINE_VERSION = "0.2.0"`. Pure Python, no I/O, checked with `mypy --strict`.

## Principles

1. Never guess. A missing or ambiguous input makes the tenant `unresolved` with an `error` exception and no amount.
2. Recoverability comes only from a reviewed mapping. Account names are never read for this.
3. Money is `Decimal`. Floats raise `TypeError` in `money.D`.
4. Every number carries a trace step: label, formula, inputs, result.
5. Every output passes invariant checks or the engine raises. A broken result is never returned, stored or exported.
6. The engine always produces a provisional result. It has no concept of a final reconciliation.

## Stages

| # | Module | Function | Output |
| --- | --- | --- | --- |
| 1 | `eligibility` | `period_is_valid` | `INVALID_PERIOD` stops the run |
| 2 | `eligibility` | `classify_transactions` | included `(txn, category)` pairs, `excluded[reason] -> ids`, exceptions |
| 3 | `pools` | `duplicate_candidates` | `DUPLICATE_GL_CANDIDATE` warnings (still included) |
| 4 | `pools` | `build_pools` | pool totals by category |
| 5 | `allocation` | `calc_tenant` / `_calc_pool_line` | pool lines, admin fee, total, trace |
| 6 | `billing` | `billed_in_period`, `compare` | billed, variance, `MISSING_BILLINGS`, `VARIANCE_OVER_THRESHOLD` |
| 7 | `engine` | pool checks | `SHARES_EXCEED_100`, `ROUNDING_DIFFERENCE` |
| 8 | `invariants` | `check` | raises `InvariantViolation` |

Exclusion reasons, in order of precedence: `reviewer_excluded`, `outside_period`, `unmapped`, `nonrecoverable`, `needs_review`, `unknown_category`.

## Per-tenant order of operations

For each pool in the tenant's approved rule:

1. Share: `rentable_area / denominator_sqft` (pro-rata; denominator from the lease rule, never building area) or `fixed_pct`. Share above 1 is an error.
2. Remove lease-excluded categories.
3. Gross-up variable categories: `amount * target / actual` when `actual < target`.
4. Base year: `max(0, pool - base_year_amount * ytd_days / year_days)`.
5. Tenant amount: `net_pool * share * occupied_days / ytd_days`.
6. Non-cumulative cap on controllables: reduce by `max(0, controllable_share - prior_year * (1 + cap_pct) * ytd_days / year_days)`.
7. Round the pool line to cents.

Then once per tenant: admin fee `round(fee_base * pct)` on the listed pools, before or after the cap as the rule states. Total = sum of rounded lines + fee. Variance = total − billed in the window.

## Rounding policy

`ROUNDING_POLICY` in `version.py`: Decimal arithmetic with unrounded intermediates; each tenant pool line and each admin fee rounded to 0.01 with `ROUND_HALF_UP`; totals are sums of rounded components; pool rounding differences are reported as `ROUNDING_DIFFERENCE` and never plugged.

## Unsupported on purpose

Each produces `UNSUPPORTED_RULE` and an unresolved tenant:

- Cumulative or CPI-indexed caps
- A base year and a cap on the same pool (interaction is lease-specific)
- Any free-text term listed in `unsupported_terms` (anchor contributions, tiered admin fees, expense stops with exceptions, ...)

Missing terms produce `MISSING_RULE_TERM`: gross-up without both occupancies, cap without percentage or prior year, admin fee with a cap and no stated order, admin fee on pools the tenant does not pay into (fixed in v0.2, F-04), admin fee with no pools.

## Invariants (checked on every run)

1. Included and excluded transactions are disjoint, each excluded once, and together cover the input exactly.
2. Each pool total equals the sum of its included transactions, and its categories sum to the total.
3. Unresolved tenants carry no total and no lines.
4. Calculated total = sum of rounded lines + one admin fee.
5. No pool is allocated twice to a tenant; every line's pool is in the tenant's rule.
6. Every line is `round_half_up(unrounded, 0.01)`.
7. Every share equals the approved basis (`area / denominator` or `fixed_pct`).
8. Lease-excluded categories are not in a tenant's pool amount (when no gross-up applies).
9. Variance = total − billed.

Re-running identical inputs produces identical results (`test_repeated_execution_is_identical`, `test_repeat_audit_is_deterministic`). Unresolved blocking exceptions prevent a property from being marked ready (`checks.no_open_errors`).

## Reproducibility

Each run stores the snapshot it ran on, its SHA-256 (`input_hash`) and `engine_version`. `POST /audit-runs/{id}/verify` re-executes the snapshot and compares every stored result. Rule and mapping versions are inside the snapshot, so a report can say which version of `LR-130` produced a figure.

**Changing the engine:** any change that can alter a number must bump `ENGINE_VERSION`, add a test with hand-computed values, and keep `test_engine_values_unchanged_for_demo` passing or update it with a written reason in the commit.

## Tests

- `tests/engine/test_engine.py`: 33 v0.1 characterization tests, unchanged in v0.2.
- `tests/engine/test_engine_v02.py`: credits, negative pools, category-specific exclusions, partial years (start and end), admin fee pool validation, determinism, rule changes, invariant violation detection, and a Hypothesis property test over random portfolios (150 examples).
- `tests/api/test_api.py::test_demo_end_to_end_matches_independent_expected`: the demo through the API against `demo/expected.py`, which recomputes every figure with `Fraction` and does not import the engine.

## Known limitations

- Base-year and cap prorations by elapsed days are a provisional convention. A final reconciliation uses full-year figures.
- The cap uses the tenant's prior-year controllable charge as entered. It is not derived from last year's data.
- Billings compare in total, not per pool.
- Partial-year proration is by days. Some leases prorate by month; those need the term listed as unsupported until supported.
