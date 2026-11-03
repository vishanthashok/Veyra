"""Stage 1 to 2: validate the period and decide which transactions are eligible.

A transaction is eligible only if it is inside the period, not excluded by a reviewer, and its
GL account has a reviewed recoverable mapping to a known category.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal

from .types import AuditException, AuditInput, Category, Recoverability, Severity, Transaction
from .types import ExceptionType as ET

ZERO = Decimal("0")


@dataclass
class Eligibility:
    included: list[tuple[Transaction, Category]] = field(default_factory=list)
    excluded: dict[str, list[str]] = field(default_factory=lambda: defaultdict(list))
    exceptions: list[AuditException] = field(default_factory=list)


def period_is_valid(inp: AuditInput) -> bool:
    p = inp.period
    return p.fiscal_year_start <= p.through_date <= p.fiscal_year_end


def classify_transactions(inp: AuditInput) -> Eligibility:
    p = inp.period
    out = Eligibility()
    categories = {c.code: c for c in inp.categories}
    mappings = {m.gl_account: m for m in inp.mappings}
    unmapped: dict[str, list[Transaction]] = defaultdict(list)
    review: dict[str, list[Transaction]] = defaultdict(list)

    for t in inp.transactions:
        if t.id in inp.excluded_transaction_ids:
            out.excluded["reviewer_excluded"].append(t.id)
            continue
        if not (p.fiscal_year_start <= t.txn_date <= p.through_date):
            out.excluded["outside_period"].append(t.id)
            out.exceptions.append(AuditException(
                ET.TRANSACTION_OUTSIDE_PERIOD, Severity.WARNING,
                f"Transaction dated {t.txn_date} is outside {p.fiscal_year_start} to {p.through_date}.",
                gl_account=t.gl_account, transaction_ids=(t.id,), amount=t.amount))
            continue
        m = mappings.get(t.gl_account)
        if m is None:
            unmapped[t.gl_account].append(t)
            out.excluded["unmapped"].append(t.id)
            continue
        if m.status == Recoverability.NONRECOVERABLE:
            out.excluded["nonrecoverable"].append(t.id)
            continue
        if m.status == Recoverability.NEEDS_REVIEW:
            review[t.gl_account].append(t)
            out.excluded["needs_review"].append(t.id)
            continue
        if m.category not in categories:
            out.exceptions.append(AuditException(
                ET.UNKNOWN_CATEGORY, Severity.ERROR,
                f"GL account {t.gl_account} maps to unknown category {m.category!r}.",
                gl_account=t.gl_account, transaction_ids=(t.id,), amount=t.amount))
            out.excluded["unknown_category"].append(t.id)
            continue
        out.included.append((t, categories[m.category]))

    for acct, txns in unmapped.items():
        out.exceptions.append(AuditException(
            ET.UNMAPPED_GL_ACCOUNT, Severity.WARNING,
            f"GL account {acct} has no reviewed mapping. Excluded from all pools until mapped.",
            gl_account=acct, transaction_ids=tuple(x.id for x in txns),
            amount=sum((x.amount for x in txns), ZERO)))
    for acct, txns in review.items():
        out.exceptions.append(AuditException(
            ET.MAPPING_NEEDS_REVIEW, Severity.WARNING,
            f"GL account {acct} mapping is marked needs review. Excluded until a reviewer decides.",
            gl_account=acct, transaction_ids=tuple(x.id for x in txns),
            amount=sum((x.amount for x in txns), ZERO)))
    return out
