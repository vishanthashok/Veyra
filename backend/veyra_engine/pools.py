"""Stage 3 to 4: flag duplicate candidates and build expense pools from eligible transactions."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from .types import AuditException, Category, PoolSummary, Severity, Transaction
from .types import ExceptionType as ET

ZERO = Decimal("0")


def _norm(text: str) -> str:
    return " ".join(text.lower().split())


def duplicate_candidates(included: list[tuple[Transaction, Category]]) -> list[AuditException]:
    """Same account, date, amount and normalized description. Flagged, never removed."""
    groups: dict[tuple[str, object, Decimal, str], list[Transaction]] = defaultdict(list)
    for t, _ in included:
        groups[(t.gl_account, t.txn_date, t.amount, _norm(t.description))].append(t)
    out = []
    for (acct, d, amt, _), txns in groups.items():
        if len(txns) > 1:
            out.append(
                AuditException(
                    ET.DUPLICATE_GL_CANDIDATE,
                    Severity.WARNING,
                    f"{len(txns)} transactions in {acct} on {d} for {amt} with the same description. "
                    "Still included. Exclude the duplicate if confirmed.",
                    gl_account=acct,
                    transaction_ids=tuple(x.id for x in txns),
                    amount=amt,
                )
            )
    return out


def build_pools(included: list[tuple[Transaction, Category]]) -> dict[str, PoolSummary]:
    pools: dict[str, PoolSummary] = {}
    for t, cat in included:
        ps = pools.setdefault(cat.pool, PoolSummary(cat.pool, ZERO, {}))
        ps.recoverable_total += t.amount
        ps.by_category[cat.code] = ps.by_category.get(cat.code, ZERO) + t.amount
    return pools
