"""Builders for synthetic engine inputs. All data here is synthetic."""

from datetime import date
from decimal import Decimal

import pytest

from veyra_engine import run_audit
from veyra_engine.types import (
    AuditInput,
    Billing,
    Category,
    LeaseRule,
    Mapping,
    Method,
    Period,
    PoolRule,
    Recoverability,
    Tenant,
    Transaction,
)

# FY2026, audited through Sep 30: ytd_days = 273, year_days = 365.
PERIOD = Period(date(2026, 1, 1), date(2026, 12, 31), date(2026, 9, 30))

CATS = (
    Category("LANDSCAPE", "CAM", controllable=True, variable=False),
    Category("JANITORIAL", "CAM", controllable=True, variable=True),
    Category("INSURANCE", "CAM", controllable=False, variable=False),
    Category("RE_TAX", "TAX", controllable=False, variable=False),
)

MAPS = (
    Mapping("6100", "LANDSCAPE", Recoverability.RECOVERABLE),
    Mapping("6200", "JANITORIAL", Recoverability.RECOVERABLE),
    Mapping("6300", "INSURANCE", Recoverability.RECOVERABLE),
    Mapping("6500", "RE_TAX", Recoverability.RECOVERABLE),
    Mapping("6900", "LANDSCAPE", Recoverability.NONRECOVERABLE),
    Mapping("6950", "LANDSCAPE", Recoverability.NEEDS_REVIEW),
)


def txn(i, acct, amount, d=date(2026, 3, 15), desc="svc"):
    return Transaction(str(i), acct, d, Decimal(amount), desc, f"gl.csv row {i}")


def prorata(pool="CAM", denom="10000", **kw):
    return PoolRule(pool, Method.PRO_RATA, denominator_sqft=Decimal(denom), **kw)


def tenant(tid="T1", area="2000", rule=None, start=date(2020, 1, 1), end=None, name=None):
    return Tenant(tid, name or f"Tenant {tid}", Decimal(area) if area is not None else None, start, end, rule)


def rule(*pools, **kw):
    return LeaseRule("LR-" + "-".join(p.pool for p in pools), tuple(pools), **kw)


def monthly_billings(tid, amount, months=9):
    return tuple(Billing(tid, date(2026, m, 1), Decimal(amount)) for m in range(1, months + 1))


@pytest.fixture
def make():
    def _make(transactions, tenants, billings=(), **kw):
        return run_audit(AuditInput(PERIOD, tuple(transactions), CATS, MAPS, tuple(tenants), tuple(billings), **kw))

    return _make
