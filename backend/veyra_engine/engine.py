"""Deterministic CAM pre-close audit engine: orchestration.

Stages (each a pure function in its own module):
  1-2 eligibility.py   period check, transaction eligibility from reviewed mappings
  3-4 pools.py         duplicate candidates, expense pools by category
  5-6 allocation.py    tenant shares, exclusions, gross-up, base year, cap, admin fee
  7   billing.py       billed-to-date comparison
  8   invariants.py    reconciliation checks; violations raise, results are never returned

Rules:
- Never guess. Missing or ambiguous inputs produce an unresolved tenant and an exception.
- Recoverability comes only from reviewed mappings, never from GL account names.
- See version.ROUNDING_POLICY for rounding.
"""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from . import billing, invariants
from .allocation import calc_tenant
from .eligibility import classify_transactions, period_is_valid
from .money import cents
from .pools import build_pools, duplicate_candidates
from .types import AuditException, AuditInput, AuditOutput, Severity, TenantResult
from .types import ExceptionType as ET

ZERO = Decimal("0")
ONE = Decimal("1")


def run_audit(inp: AuditInput, *, check_invariants: bool = True) -> AuditOutput:
    p = inp.period
    if not period_is_valid(inp):
        return AuditOutput(
            True,
            p,
            {},
            [],
            [AuditException(ET.INVALID_PERIOD, Severity.ERROR, "Through date must fall inside the fiscal year.")],
            [],
            {},
        )

    elig = classify_transactions(inp)
    exceptions = list(elig.exceptions)
    exceptions += duplicate_candidates(elig.included)
    pools = build_pools(elig.included)

    categories = {c.code: c for c in inp.categories}
    year_fraction = Decimal(p.ytd_days) / Decimal(p.year_days)
    billed, seen = billing.billed_in_period(inp)

    results: list[TenantResult] = []
    pool_shares: dict[str, Decimal] = defaultdict(lambda: ZERO)
    pool_unrounded: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for tenant in inp.tenants:
        r = calc_tenant(tenant, inp, pools, categories, year_fraction, exceptions, pool_shares, pool_unrounded)
        exceptions += billing.compare(r, tenant, inp, billed, seen)
        results.append(r)

    for pool, total_share in pool_shares.items():
        if total_share > ONE:
            exceptions.append(
                AuditException(
                    ET.SHARES_EXCEED_100,
                    Severity.WARNING,
                    f"Tenant shares in pool {pool} sum to {total_share}. Confirm lease denominators.",
                    pool=pool,
                )
            )
    for r in results:
        for line in r.lines:
            if line.pool in pools:  # a rule pool with no eligible transactions has no summary
                pools[line.pool].allocated_total += line.amount
    for pool, ps in pools.items():
        diff = ps.allocated_total - cents(pool_unrounded[pool])
        ps.rounding_difference = diff
        if diff != ZERO:
            exceptions.append(
                AuditException(
                    ET.ROUNDING_DIFFERENCE,
                    Severity.INFO,
                    f"Rounded tenant lines in pool {pool} differ from unrounded total by {diff}. No plug applied.",
                    pool=pool,
                    amount=diff,
                )
            )

    out = AuditOutput(
        provisional=True,  # the engine never produces a final reconciliation
        period=p,
        pools=pools,
        tenants=results,
        exceptions=exceptions,
        included_transaction_ids=[t.id for t, _ in elig.included],
        excluded=dict(elig.excluded),
    )
    if check_invariants:
        invariants.check(inp, out)
    return out
