"""Engine tests. Expected values are hand-computed in the comments.

Period: FY2026 through 2026-09-30, ytd_days 273, year_days 365.
"""

from datetime import date
from decimal import Decimal

import pytest

from veyra_engine import D, run_audit
from veyra_engine.types import (
    AdminFee, AdminFeeOrder, Cap, CapKind, ExceptionType as ET, GrossUp, Method, PoolRule,
)

from .conftest import monthly_billings, prorata, rule, tenant, txn


def types(out):
    return [e.type for e in out.exceptions]


def only(out, tid="T1"):
    return next(r for r in out.tenants if r.tenant_id == tid)


def test_standard_pro_rata(make):
    # 10,000 CAM * 2,000 / 10,000 = 2,000.00. Billed 9 * 200 = 1,800. Variance +200.
    out = make([txn(1, "6100", "6000.00"), txn(2, "6300", "4000.00")],
               [tenant(rule=rule(prorata()))], monthly_billings("T1", "200.00"))
    r = only(out)
    assert r.status == "calculated"
    assert r.total == Decimal("2000.00")
    assert r.billed == Decimal("1800.00")
    assert r.variance == Decimal("200.00")
    assert out.provisional is True
    labels = [s.label for s in r.trace]
    assert "[CAM] Share" in labels and "Provisional variance" in labels


def test_nonrecoverable_excluded(make):
    out = make([txn(1, "6100", "10000.00"), txn(2, "6900", "5000.00", desc="roof replacement")],
               [tenant(rule=rule(prorata()))], monthly_billings("T1", "200.00"))
    assert only(out).total == Decimal("2000.00")
    assert out.excluded["nonrecoverable"] == ["2"]
    assert out.pools["CAM"].recoverable_total == Decimal("10000.00")


def test_fixed_percentage(make):
    # 10,000 * 12.5% = 1,250.00
    r = only(make([txn(1, "6100", "10000.00")],
                  [tenant(rule=rule(PoolRule("CAM", Method.FIXED_PCT, fixed_pct=D("0.125"))))],
                  monthly_billings("T1", "100.00")))
    assert r.total == Decimal("1250.00")


def test_different_expense_pools(make):
    # T1 in CAM only: 10,000 * 0.2 = 2,000. T2 in CAM and TAX at 0.3: 3,000 + 1,800 = 4,800.
    out = make([txn(1, "6100", "10000.00"), txn(2, "6500", "6000.00")],
               [tenant("T1", "2000", rule(prorata())),
                tenant("T2", "3000", rule(prorata(), prorata("TAX")))],
               monthly_billings("T1", "200") + monthly_billings("T2", "500"))
    assert only(out, "T1").total == Decimal("2000.00")
    assert only(out, "T2").total == Decimal("4800.00")


def test_duplicate_gl_flagged_then_excluded(make):
    txns = [txn(1, "6100", "5000.00", desc="Acme Landscaping Mar"),
            txn(2, "6100", "5000.00", desc="ACME landscaping  mar")]
    out = make(txns, [tenant(rule=rule(prorata()))], monthly_billings("T1", "200"))
    assert ET.DUPLICATE_GL_CANDIDATE in types(out)
    assert only(out).total == Decimal("2000.00")  # still included until reviewed
    out2 = make(txns, [tenant(rule=rule(prorata()))], monthly_billings("T1", "200"),
                excluded_transaction_ids=frozenset({"2"}))
    assert ET.DUPLICATE_GL_CANDIDATE not in types(out2)
    assert only(out2).total == Decimal("1000.00")
    assert out2.excluded["reviewer_excluded"] == ["2"]


def test_missing_tenant_area(make):
    r = only(out := make([txn(1, "6100", "100")],
                         [tenant(area=None, rule=rule(prorata(), prorata("TAX")))]))
    assert r.status == "unresolved" and r.total is None
    assert types(out).count(ET.MISSING_TENANT_AREA) == 1  # reported once, not per pool


def test_missing_lease_rule(make):
    out = make([txn(1, "6100", "100")], [tenant(rule=None)])
    assert only(out).status == "unresolved"
    assert ET.MISSING_LEASE_RULE in types(out)


def test_missing_denominator(make):
    out = make([txn(1, "6100", "100")],
               [tenant(rule=rule(PoolRule("CAM", Method.PRO_RATA)))])
    assert only(out).status == "unresolved"
    assert ET.MISSING_DENOMINATOR in types(out)


def test_partial_year_tenant(make):
    # Lease starts 2026-07-01. Occupied 92 of 273 days.
    # 10,000 * 0.2 * 92/273 = 673.9926... -> 673.99
    r = only(make([txn(1, "6100", "10000.00")],
                  [tenant(rule=rule(prorata()), start=date(2026, 7, 1))],
                  monthly_billings("T1", "200")))
    assert r.total == Decimal("673.99")


def test_tenant_not_yet_occupied_has_zero_and_no_billing_flag(make):
    out = make([txn(1, "6100", "10000.00")],
               [tenant(rule=rule(prorata()), start=date(2026, 11, 1))])
    r = only(out)
    assert r.total == Decimal("0.00") and r.variance == Decimal("0.00")
    assert ET.MISSING_BILLINGS not in types(out)


def test_noncumulative_cap(make):
    # CAM = 10,000 controllable + 2,000 insurance. Share 0.2 -> 2,400, controllable 2,000.
    # Limit = 2,400 * 1.05 * 273/365 = 1,884.8219...; reduction 115.1780...
    # Amount = 2,284.8219... -> 2,284.82
    cap = Cap(CapKind.NONCUMULATIVE, D("0.05"), D("2400"))
    r = only(make([txn(1, "6100", "10000.00"), txn(2, "6300", "2000.00")],
                  [tenant(rule=rule(prorata(cap=cap)))], monthly_billings("T1", "250")))
    assert r.total == Decimal("2284.82")
    assert r.lines[0].cap_reduction.quantize(Decimal("0.01")) == Decimal("115.18")


def test_cap_missing_prior_year_unresolved(make):
    cap = Cap(CapKind.NONCUMULATIVE, D("0.05"), None)
    out = make([txn(1, "6100", "100")], [tenant(rule=rule(prorata(cap=cap)))])
    assert only(out).status == "unresolved"
    assert ET.MISSING_RULE_TERM in types(out)


def test_base_year(make):
    # Base-year 8,000 prorated: 8,000 * 273/365 = 5,983.5616...
    # Net 10,000 - 5,983.5616 = 4,016.4383... * 0.2 = 803.2876... -> 803.29
    r = only(make([txn(1, "6100", "10000.00")],
                  [tenant(rule=rule(prorata(base_year_amount=D("8000"))))],
                  monthly_billings("T1", "90")))
    assert r.total == Decimal("803.29")


def test_base_year_floor_at_zero(make):
    r = only(make([txn(1, "6100", "1000.00")],
                  [tenant(rule=rule(prorata(base_year_amount=D("8000"))))],
                  monthly_billings("T1", "0")))
    assert r.total == Decimal("0.00")


def test_gross_up_variable_only(make):
    # Janitorial (variable) 4,000 * 0.95 / 0.80 = 4,750. Landscape 6,000 unchanged.
    # (6,000 + 4,750) * 0.2 = 2,150.00
    g = GrossUp(D("0.95"), D("0.80"))
    r = only(make([txn(1, "6100", "6000.00"), txn(2, "6200", "4000.00")],
                  [tenant(rule=rule(prorata(gross_up=g)))], monthly_billings("T1", "200")))
    assert r.total == Decimal("2150.00")


def test_gross_up_not_applied_above_target(make):
    g = GrossUp(D("0.95"), D("0.97"))
    r = only(make([txn(1, "6200", "4000.00")], [tenant(rule=rule(prorata(gross_up=g)))],
                  monthly_billings("T1", "100")))
    assert r.total == Decimal("800.00")


def test_gross_up_missing_occupancy_unresolved(make):
    g = GrossUp(D("0.95"), None)
    out = make([txn(1, "6200", "4000.00")], [tenant(rule=rule(prorata(gross_up=g)))])
    assert only(out).status == "unresolved"


def test_admin_fee_applied_once(make):
    # CAM 2,000 + TAX 1,200; fee 10% on CAM only = 200. Total 3,400.
    fee = AdminFee(D("0.10"), frozenset({"CAM"}))
    r = only(make([txn(1, "6100", "10000.00"), txn(2, "6500", "6000.00")],
                  [tenant(rule=rule(prorata(), prorata("TAX"), admin_fee=fee))],
                  monthly_billings("T1", "350")))
    assert r.admin_fee == Decimal("200.00")
    assert r.total == Decimal("3400.00")


@pytest.mark.parametrize("order,fee_amt", [(AdminFeeOrder.BEFORE_CAP, "240.00"),
                                           (AdminFeeOrder.AFTER_CAP, "228.48")])
def test_admin_fee_with_cap_order(make, order, fee_amt):
    # Capped line 2,284.8219...; uncapped 2,400. Fee 10%.
    cap = Cap(CapKind.NONCUMULATIVE, D("0.05"), D("2400"))
    fee = AdminFee(D("0.10"), frozenset({"CAM"}), order)
    r = only(make([txn(1, "6100", "10000.00"), txn(2, "6300", "2000.00")],
                  [tenant(rule=rule(prorata(cap=cap), admin_fee=fee))],
                  monthly_billings("T1", "250")))
    assert r.admin_fee == Decimal(fee_amt)
    assert r.total == Decimal("2284.82") + Decimal(fee_amt)


def test_admin_fee_with_cap_missing_order_unresolved(make):
    cap = Cap(CapKind.NONCUMULATIVE, D("0.05"), D("2400"))
    fee = AdminFee(D("0.10"), frozenset({"CAM"}))
    out = make([txn(1, "6100", "100")], [tenant(rule=rule(prorata(cap=cap), admin_fee=fee))])
    assert only(out).status == "unresolved"
    assert ET.MISSING_RULE_TERM in types(out)


def test_rounding_difference_reported_not_plugged(make):
    # Three tenants at 1/3 of 100.00 -> 33.33 each, 99.99 allocated, -0.01 difference.
    tenants = [tenant(f"T{i}", "1", rule(prorata(denom="3"))) for i in (1, 2, 3)]
    bills = sum((monthly_billings(f"T{i}", "3.70") for i in (1, 2, 3)), ())
    out = make([txn(1, "6100", "100.00")], tenants, bills)
    assert [r.total for r in out.tenants] == [Decimal("33.33")] * 3
    assert out.pools["CAM"].allocated_total == Decimal("99.99")
    assert out.pools["CAM"].rounding_difference == Decimal("-0.01")
    assert ET.ROUNDING_DIFFERENCE in types(out)


@pytest.mark.parametrize("kind", [CapKind.CPI, CapKind.CUMULATIVE])
def test_unsupported_cap_kinds_flagged(make, kind):
    cap = Cap(kind, D("0.05"), D("2400"))
    out = make([txn(1, "6100", "100")], [tenant(rule=rule(prorata(cap=cap)))])
    assert only(out).status == "unresolved"
    assert ET.UNSUPPORTED_RULE in types(out)


def test_unsupported_free_text_terms_flagged(make):
    r_ = rule(prorata(), unsupported_terms=("Anchor contribution reduces pool",))
    out = make([txn(1, "6100", "100")], [tenant(rule=r_)])
    assert only(out).status == "unresolved"
    assert ET.UNSUPPORTED_RULE in types(out)


def test_base_year_with_cap_unsupported(make):
    cap = Cap(CapKind.NONCUMULATIVE, D("0.05"), D("2400"))
    out = make([txn(1, "6100", "100")],
               [tenant(rule=rule(prorata(cap=cap, base_year_amount=D("50"))))])
    assert ET.UNSUPPORTED_RULE in types(out)


def test_share_above_100_unresolved(make):
    out = make([txn(1, "6100", "100")], [tenant(area="12000", rule=rule(prorata()))])
    assert only(out).status == "unresolved"
    assert ET.SHARES_EXCEED_100 in types(out)


def test_pool_shares_sum_above_100_warns(make):
    out = make([txn(1, "6100", "100")],
               [tenant("T1", "6000", rule(prorata())), tenant("T2", "6000", rule(prorata()))],
               monthly_billings("T1", "1") + monthly_billings("T2", "1"))
    assert ET.SHARES_EXCEED_100 in types(out)
    assert all(r.status == "calculated" for r in out.tenants)


def test_missing_billings_no_variance(make):
    out = make([txn(1, "6100", "10000")], [tenant(rule=rule(prorata()))])
    r = only(out)
    assert r.total == Decimal("2000.00") and r.variance is None and r.billed is None
    assert ET.MISSING_BILLINGS in types(out)


def test_unmapped_needs_review_and_outside_period(make):
    out = make([txn(1, "6100", "10000"), txn(2, "7777", "900"), txn(3, "6950", "300"),
                txn(4, "6100", "500", d=date(2026, 10, 15))],
               [tenant(rule=rule(prorata()))], monthly_billings("T1", "200"))
    t = types(out)
    assert ET.UNMAPPED_GL_ACCOUNT in t
    assert ET.MAPPING_NEEDS_REVIEW in t
    assert ET.TRANSACTION_OUTSIDE_PERIOD in t
    assert only(out).total == Decimal("2000.00")
    assert out.excluded["unmapped"] == ["2"]
    assert out.excluded["needs_review"] == ["3"]
    assert out.excluded["outside_period"] == ["4"]


def test_variance_threshold_flag(make):
    out = make([txn(1, "6100", "10000")], [tenant(rule=rule(prorata()))],
               monthly_billings("T1", "100"), variance_threshold=D("500"))
    assert only(out).variance == Decimal("1100.00")
    assert ET.VARIANCE_OVER_THRESHOLD in types(out)


def test_invalid_period():
    from veyra_engine.types import AuditInput, Period
    from .conftest import CATS, MAPS
    bad = Period(date(2026, 1, 1), date(2026, 12, 31), date(2027, 1, 5))
    out = run_audit(AuditInput(bad, (), CATS, MAPS, (), ()))
    assert ET.INVALID_PERIOD in types(out) and out.tenants == []


def test_floats_rejected():
    with pytest.raises(TypeError):
        D(0.1)
    assert D("(1,234.50)") == Decimal("-1234.50")
    assert D("$1,000") == Decimal("1000")
