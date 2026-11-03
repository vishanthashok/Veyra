"""Run audits from immutable snapshots, persist results, traces and exceptions."""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import asdict
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from veyra_engine import ENGINE_VERSION, ROUNDING_POLICY, run_audit
from veyra_engine import types as E
from veyra_engine.money import fmt

from .. import models as M
from ..auth import Actor
from .snapshot import build_snapshot, input_from_snapshot

ASSUMPTIONS = [
    "Provisional: covers fiscal year start through the through date. Not a final reconciliation.",
    "Only GL accounts with a reviewed recoverable mapping are included. Account names are never used.",
    "Only approved lease rules are used. Tenants without one are unresolved.",
    "Partial-year tenants are prorated by occupied days over days in the audit window.",
    "Base-year amounts and cap limits are full-year figures prorated by days elapsed in the fiscal year.",
    "Gross-up applies only to categories marked variable, only when actual occupancy is below target.",
    "Admin fees are applied once per tenant on the pools the lease rule lists.",
    "Variance = provisional share minus amounts billed in the window. It is a potential discrepancy, "
    "not a confirmed billing error.",
]


def snapshot_hash(snap: dict) -> str:
    return hashlib.sha256(json.dumps(snap, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def summarize(out: E.AuditOutput, snap: dict) -> dict:
    counts: dict[str, int] = {}
    for e in out.exceptions:
        counts[e.severity.value] = counts.get(e.severity.value, 0) + 1
    return {
        "provisional": True,
        "period": {k: snap["period"][k] for k in ("fiscal_year_start", "fiscal_year_end", "through_date")},
        "pools": {
            k: {
                "recoverable_total": fmt(v.recoverable_total),
                "allocated_total": fmt(v.allocated_total),
                "rounding_difference": fmt(v.rounding_difference),
                "by_category": {c: fmt(a) for c, a in sorted(v.by_category.items())},
            }
            for k, v in sorted(out.pools.items())
        },
        "excluded": out.excluded,
        "included_count": len(out.included_transaction_ids),
        "transaction_count": len(snap["transactions"]),
        "tenants_calculated": sum(1 for r in out.tenants if r.status == "calculated"),
        "tenants_unresolved": sum(1 for r in out.tenants if r.status == "unresolved"),
        "exception_counts": counts,
        "variance_threshold": snap["variance_threshold"],
        "rounding_policy": ROUNDING_POLICY,
        "assumptions": ASSUMPTIONS,
    }


def _lines(r: E.TenantResult) -> list[dict]:
    return [
        {
            "pool": ln.pool,
            "tenant_pool_amount": fmt(ln.tenant_pool_amount),
            "share": fmt(ln.share),
            "amount_unrounded": fmt(ln.amount_unrounded),
            "amount": fmt(ln.amount),
            "controllable_amount": fmt(ln.controllable_amount),
            "cap_reduction": fmt(ln.cap_reduction),
        }
        for ln in r.lines
    ]


def execute(
    db: Session,
    actor: Actor,
    prop: M.Property,
    period: M.ReportingPeriod,
    threshold: Decimal,
    idempotency_key: str | None = None,
) -> M.AuditRun:
    snap = build_snapshot(db, prop, period, threshold)
    out = run_audit(input_from_snapshot(snap))
    run = M.AuditRun(
        organization_id=actor.org_id,
        property_id=prop.id,
        period_id=period.id,
        input_hash=snapshot_hash(snap),
        engine_version=ENGINE_VERSION,
        snapshot=snap,
        summary=summarize(out, snap),
        created_by=actor.user_id,
        idempotency_key=idempotency_key,
    )
    db.add(run)
    db.flush()
    for r in out.tenants:
        res = M.AuditResult(
            organization_id=actor.org_id,
            audit_run_id=run.id,
            tenant_id=uuid.UUID(r.tenant_id),
            status=r.status,
            total=r.total,
            admin_fee=r.admin_fee,
            billed=r.billed,
            variance=r.variance,
            unresolved_reasons=r.unresolved_reasons,
            lines=_lines(r),
        )
        db.add(res)
        db.flush()
        db.add(
            M.CalculationTrace(organization_id=actor.org_id, audit_result_id=res.id, steps=[asdict(s) for s in r.trace])
        )
    for e in out.exceptions:
        db.add(
            M.AuditExceptionRow(
                organization_id=actor.org_id,
                audit_run_id=run.id,
                property_id=prop.id,
                type=e.type.value,
                severity=e.severity.value,
                message=e.message,
                tenant_id=uuid.UUID(e.tenant_id) if e.tenant_id else None,
                gl_account=e.gl_account,
                pool=e.pool,
                transaction_ids=list(e.transaction_ids),
                amount=e.amount,
            )
        )
    db.add(
        M.AuditLog(
            organization_id=actor.org_id,
            actor_id=actor.user_id,
            action="audit_run",
            entity_type="audit_runs",
            entity_id=str(run.id),
            after={"input_hash": run.input_hash, "engine_version": ENGINE_VERSION},
        )
    )
    prop.reconciliation_status = "in_review"
    db.commit()
    return run


def verify(db: Session, run: M.AuditRun) -> dict:
    """Re-run the engine on the stored snapshot and compare with stored results."""
    if not run.snapshot:
        return {"reproducible": False, "reason": "Run predates snapshots (engine 0.1). It cannot be re-run."}
    out = run_audit(input_from_snapshot(run.snapshot))
    stored = {
        str(r.tenant_id): r for r in db.scalars(select(M.AuditResult).where(M.AuditResult.audit_run_id == run.id))
    }
    diffs = []
    for r in out.tenants:
        s = stored.get(r.tenant_id)
        same = (
            s is not None
            and s.status == r.status
            and s.total == r.total
            and s.admin_fee == r.admin_fee
            and s.lines == _lines(r)
        )
        if not same:
            diffs.append(r.tenant_name)
    return {
        "reproducible": not diffs and snapshot_hash(run.snapshot) == run.input_hash,
        "engine_version_stored": run.engine_version,
        "engine_version_now": ENGINE_VERSION,
        "differences": diffs,
    }
