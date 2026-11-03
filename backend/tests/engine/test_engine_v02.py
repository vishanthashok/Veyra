"""v0.2 domain tests: credits, category-specific pools, fee pool validation, invariants,
determinism and property-based checks. Hand-computed values are in comments.

Period: FY2026 through 2026-09-30, ytd_days 273, year_days 365.
"""

from dataclasses import replace
from datetime import date
from decimal import Decimal

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from veyra_engine import ENGINE_VERSION, InvariantViolation, run_audit
from veyra_engine import invariants as inv
from veyra_engine.types import AdminFee, AuditInput, Method, PoolRule
from veyra_engine.types import ExceptionType as ET

from .conftest import CATS, MAPS, PERIOD, monthly_billings, prorata, rule, tenant, txn


def types(out):
    return [e.type for e in out.exceptions]


def only(out, tid="T1"):
    return next(r for r in out.tenants if r.tenant_id == tid)


def test_engine_version_is_semver():
    assert ENGINE_VERSION.count(".") == 2


def test_credit_transactions_reduce_the_pool(make):
    # 10,000 invoice, 1,250.50 vendor credit. Pool 8,749.50 * 0.2 = 1,749.90
    out = make(
        [txn(1, "6100", "10000.00"), txn(2, "6100", "-1250.50", desc="credit memo")],
        [tenant(rule=rule(prorata()))],
        monthly_billings("T1", "200"),
    )
    assert out.pools["CAM"].recoverable_total == Decimal("8749.50")
    assert only(out).total == Decimal("1749.90")


def test_negative_pool_after_base_year_floors_at_zero(make):
    out = make(
        [txn(1, "6100", "-500.00")],
        [tenant(rule=rule(prorata(base_year_amount=Decimal("100"))))],
        monthly_billings("T1", "0"),
    )
    assert only(out).total == Decimal("0.00")


def test_negative_adjustment_without_base_year_produces_a_credit(make):
    # Net credit pool -500 * 0.2 = -100.00. Reported as computed, not hidden.
    out = make([txn(1, "6100", "-500.00")], [tenant(rule=rule(prorata()))], monthly_billings("T1", "0"))
    assert only(out).total == Decimal("-100.00")


def test_category_specific_exclusion_only_affects_that_tenant(make):
    # LANDSCAPE 6,000 + INSURANCE 4,000. T1 excludes INSURANCE: 6,000 * 0.2 = 1,200. T2 pays all: 2,000.
    out = make(
        [txn(1, "6100", "6000"), txn(2, "6300", "4000")],
        [
            tenant("T1", "2000", rule(prorata(excluded_categories=frozenset({"INSURANCE"})))),
            tenant("T2", "2000", rule(prorata())),
        ],
        monthly_billings("T1", "1") + monthly_billings("T2", "1"),
    )
    assert only(out, "T1").total == Decimal("1200.00")
    assert only(out, "T2").total == Decimal("2000.00")


def test_fixed_pct_partial_year(make):
    # 10,000 * 10% * 92/273 = 336.9963... -> 337.00
    r = only(
        make(
            [txn(1, "6100", "10000")],
            [tenant(rule=rule(PoolRule("CAM", Method.FIXED_PCT, fixed_pct=Decimal("0.10"))), start=date(2026, 7, 1))],
            monthly_billings("T1", "1"),
        )
    )
    assert r.total == Decimal("337.00")


def test_lease_ended_midyear(make):
    # Lease ends 2026-03-31: 90 of 273 days. 10,000 * 0.2 * 90/273 = 659.3406... -> 659.34
    r = only(
        make(
            [txn(1, "6100", "10000")],
            [tenant(rule=rule(prorata()), end=date(2026, 3, 31))],
            monthly_billings("T1", "1", 3),
        )
    )
    assert r.total == Decimal("659.34")


def test_admin_fee_on_pool_not_in_rule_is_unresolved(make):
    fee = AdminFee(Decimal("0.10"), frozenset({"TAX"}))
    out = make([txn(1, "6100", "100")], [tenant(rule=rule(prorata(), admin_fee=fee))])
    assert only(out).status == "unresolved"
    assert ET.MISSING_RULE_TERM in types(out)


def test_admin_fee_with_no_pools_is_unresolved(make):
    fee = AdminFee(Decimal("0.10"), frozenset())
    out = make([txn(1, "6100", "100")], [tenant(rule=rule(prorata(), admin_fee=fee))])
    assert only(out).status == "unresolved"


def test_repeated_execution_is_identical(make):
    args = (
        [txn(1, "6100", "1000.01"), txn(2, "6200", "333.33"), txn(3, "6300", "-10.10")],
        [tenant(f"T{i}", "3333", rule(prorata())) for i in range(3)],
    )
    a, b = make(*args), make(*args)
    assert [(r.total, [(ln.pool, ln.amount) for ln in r.lines]) for r in a.tenants] == [
        (r.total, [(ln.pool, ln.amount) for ln in r.lines]) for r in b.tenants
    ]
    assert [e.message for e in a.exceptions] == [e.message for e in b.exceptions]


def test_rule_version_change_changes_result(make):
    base = make([txn(1, "6100", "10000")], [tenant(rule=rule(prorata(denom="10000")))])
    changed = make([txn(1, "6100", "10000")], [tenant(rule=rule(prorata(denom="8000")))])
    assert only(base).total == Decimal("2000.00")
    assert only(changed).total == Decimal("2500.00")


def test_invariant_violation_is_raised_for_corrupted_output(make):
    inp = AuditInput(PERIOD, (txn(1, "6100", "100"),), CATS, MAPS, (tenant(rule=rule(prorata())),), ())
    out = run_audit(inp)
    r = out.tenants[0]
    r.total = r.total + Decimal("0.01")
    with pytest.raises(InvariantViolation, match="lines plus one admin fee"):
        inv.check(inp, out)
    out = run_audit(inp)
    out.pools["CAM"].recoverable_total += Decimal("1")
    with pytest.raises(InvariantViolation, match="pool CAM total"):
        inv.check(inp, out)
    out = run_audit(inp)
    out.tenants[0].lines[0] = replace(out.tenants[0].lines[0], share=Decimal("0.5"))
    with pytest.raises(InvariantViolation, match="approved basis"):
        inv.check(inp, out)


# Property-based: random synthetic portfolios must always satisfy invariants ------------------

amount = st.decimals(
    min_value=Decimal("-5000"), max_value=Decimal("50000"), places=2, allow_nan=False, allow_infinity=False
)
accounts = st.sampled_from(["6100", "6200", "6300", "6500", "6900", "6950", "7777"])
days = st.integers(min_value=1, max_value=300)


@settings(max_examples=150, deadline=None)
@given(
    txns=st.lists(st.tuples(accounts, amount, days), min_size=0, max_size=40),
    areas=st.lists(st.integers(min_value=1, max_value=5000), min_size=1, max_size=8),
    fee=st.booleans(),
)
def test_invariants_hold_for_random_portfolios(txns, areas, fee):
    transactions = tuple(
        txn(i, a, str(amt), d=date(2026, 1, 1).fromordinal(date(2026, 1, 1).toordinal() + day - 1))
        for i, (a, amt, day) in enumerate(txns)
    )
    admin = AdminFee(Decimal("0.10"), frozenset({"CAM"})) if fee else None
    tenants = tuple(
        tenant(f"T{i}", str(a), rule(prorata(denom="20000"), prorata("TAX", denom="20000"), admin_fee=admin))
        for i, a in enumerate(areas)
    )
    inp = AuditInput(PERIOD, transactions, CATS, MAPS, tenants, ())
    out = run_audit(inp)  # raises InvariantViolation on any breach
    for r in out.tenants:
        assert r.status == "calculated"
    for pool, ps in out.pools.items():
        assert abs(ps.rounding_difference) <= Decimal("0.01") * len(areas)


def test_rule_pool_with_no_transactions_allocates_zero(make):
    # Regression for a crash found by the property test during the v0.2 refactor.
    out = make([txn(1, "6100", "100")], [tenant(rule=rule(prorata(), prorata("TAX")))], monthly_billings("T1", "1"))
    r = only(out)
    assert {ln.pool: ln.amount for ln in r.lines} == {"CAM": Decimal("20.00"), "TAX": Decimal("0.00")}
    assert "TAX" not in out.pools
