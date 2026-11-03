"""Stage 8: invariants. Each must hold for every audit output. A violation is an engine defect.

The engine raises InvariantViolation rather than returning a result that breaks one, so a broken
calculation can never be stored or exported.
"""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from .money import cents
from .types import AuditInput, AuditOutput, Method

ZERO = Decimal("0")


class InvariantViolation(AssertionError):
    pass


def check(inp: AuditInput, out: AuditOutput) -> None:
    errors: list[str] = []
    txns = {t.id: t for t in inp.transactions}
    included = set(out.included_transaction_ids)

    # 1. Excluded transactions are never included, and every transaction is accounted for once.
    excluded_ids = [i for ids in out.excluded.values() for i in ids]
    if included & set(excluded_ids):
        errors.append("a transaction is both included and excluded")
    if len(excluded_ids) != len(set(excluded_ids)):
        errors.append("a transaction is excluded for more than one reason")
    if included | set(excluded_ids) != set(txns):
        errors.append("included plus excluded transactions do not cover the input exactly")

    # 2. Pools reconcile to included transactions.
    cats = {c.code: c for c in inp.categories}
    maps = {m.gl_account: m for m in inp.mappings}
    expected: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for tid in included:
        t = txns[tid]
        expected[cats[maps[t.gl_account].category].pool] += t.amount
    for pool, ps in out.pools.items():
        if ps.recoverable_total != expected[pool]:
            errors.append(f"pool {pool} total {ps.recoverable_total} != included {expected[pool]}")
        if sum(ps.by_category.values(), ZERO) != ps.recoverable_total:
            errors.append(f"pool {pool} categories do not sum to the pool total")

    # 3. Tenant results reconcile to their components and follow the approved basis.
    tenants = {t.id: t for t in inp.tenants}
    for r in out.tenants:
        if r.status == "unresolved":
            if r.total is not None or r.lines:
                errors.append(f"unresolved tenant {r.tenant_id} carries a total")
            continue
        if r.total != sum((ln.amount for ln in r.lines), ZERO) + r.admin_fee:
            errors.append(f"tenant {r.tenant_id} total does not equal lines plus one admin fee")
        rule = tenants[r.tenant_id].rule
        assert rule is not None
        rules = {pr.pool: pr for pr in rule.pools}
        if len({ln.pool for ln in r.lines}) != len(r.lines):
            errors.append(f"tenant {r.tenant_id} has a pool allocated twice")
        for ln in r.lines:
            pr = rules.get(ln.pool)
            if pr is None:
                errors.append(f"tenant {r.tenant_id} allocated from pool {ln.pool} not in its rule")
                continue
            if ln.amount != cents(ln.amount_unrounded):
                errors.append(f"tenant {r.tenant_id} pool {ln.pool} rounding is not half-up cents")
            if pr.method == Method.PRO_RATA:
                basis = tenants[r.tenant_id].rentable_area / pr.denominator_sqft  # type: ignore[operator]
            else:
                basis = pr.fixed_pct
            if ln.share != basis:
                errors.append(f"tenant {r.tenant_id} pool {ln.pool} share differs from approved basis")
            excluded_cats = set(pr.excluded_categories)
            pool_cats = set(out.pools[ln.pool].by_category) if ln.pool in out.pools else set()
            if excluded_cats & pool_cats and pr.gross_up is None:
                allowed = sum((a for c, a in out.pools[ln.pool].by_category.items() if c not in excluded_cats), ZERO)
                if ln.tenant_pool_amount != allowed:
                    errors.append(f"tenant {r.tenant_id} pool {ln.pool} includes excluded categories")
        if r.variance is not None and r.billed is not None and r.total is not None and r.variance != r.total - r.billed:
            errors.append(f"tenant {r.tenant_id} variance does not equal total minus billed")

    if errors:
        raise InvariantViolation("; ".join(errors))
