"""Stage 7: compare provisional totals with billings recorded in the period."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from .allocation import occupied_days
from .money import fmt
from .types import AuditException, AuditInput, Severity, Tenant, TenantResult, TraceStep
from .types import ExceptionType as ET

ZERO = Decimal("0")


def billed_in_period(inp: AuditInput) -> tuple[dict[str, Decimal], set[str]]:
    p = inp.period
    billed: dict[str, Decimal] = defaultdict(lambda: ZERO)
    seen: set[str] = set()
    for b in inp.billings:
        if p.fiscal_year_start <= b.bill_date <= p.through_date:
            billed[b.tenant_id] += b.amount
            seen.add(b.tenant_id)
    return billed, seen


def compare(r: TenantResult, tenant: Tenant, inp: AuditInput, billed: dict[str, Decimal],
            seen: set[str]) -> list[AuditException]:
    if r.status != "calculated" or r.total is None:
        return []
    p = inp.period
    out: list[AuditException] = []
    occupied = occupied_days(tenant, p.fiscal_year_start, p.through_date) > 0
    if tenant.id not in seen and occupied:
        out.append(AuditException(
            ET.MISSING_BILLINGS, Severity.WARNING,
            f"No CAM billings found for {tenant.name} in the period. Variance not computed.",
            tenant_id=tenant.id))
        r.billed = None
        return out
    r.billed = billed[tenant.id]
    r.variance = r.total - r.billed
    r.trace.append(TraceStep("Provisional variance", "total - billed_ytd", fmt(r.variance),
                             {"total": fmt(r.total), "billed_ytd": fmt(r.billed)}))
    if abs(r.variance) > inp.variance_threshold:
        out.append(AuditException(
            ET.VARIANCE_OVER_THRESHOLD, Severity.INFO,
            f"Provisional variance for {tenant.name} is {r.variance}. "
            "Potential discrepancy only. Verify before acting.",
            tenant_id=tenant.id, amount=r.variance))
    return out
