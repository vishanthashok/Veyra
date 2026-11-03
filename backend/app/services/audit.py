"""Load property data from the DB, run the engine, persist results, traces, exceptions."""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import asdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from veyra_engine import run_audit
from veyra_engine import types as E
from veyra_engine.money import fmt

from .. import models as M
from ..auth import Actor


def _engine_rule(lr: M.LeaseRule, pools: list[M.AllocationRule]) -> E.LeaseRule:
    prules = []
    for a in pools:
        gross = E.GrossUp(a.gross_up_target, a.gross_up_actual) if a.gross_up_enabled else None
        cap = E.Cap(E.CapKind(a.cap_kind), a.cap_pct, a.cap_prior_year) if a.cap_kind else None
        prules.append(E.PoolRule(
            pool=a.pool, method=E.Method(a.method), denominator_sqft=a.denominator_sqft,
            fixed_pct=a.fixed_pct, excluded_categories=frozenset(a.excluded_categories or []),
            base_year_amount=a.base_year_amount, gross_up=gross, cap=cap))
    fee = None
    if lr.admin_fee_pct is not None:
        fee = E.AdminFee(lr.admin_fee_pct, frozenset(lr.admin_fee_pools or []),
                         E.AdminFeeOrder(lr.admin_fee_order) if lr.admin_fee_order else None)
    return E.LeaseRule(lr.ref, tuple(prules), fee, tuple(lr.unsupported_terms or []))


def build_input(db: Session, prop: M.Property, period: M.ReportingPeriod,
                threshold) -> E.AuditInput:
    org = prop.organization_id
    q = lambda model: select(model).where(model.organization_id == org,  # noqa: E731
                                          model.property_id == prop.id)
    txns = db.scalars(q(M.GLTransaction).order_by(M.GLTransaction.txn_date,
                                                  M.GLTransaction.source_row)).all()
    cats = db.scalars(q(M.ExpenseCategory)).all()
    maps = db.scalars(q(M.ExpenseMapping)).all()
    tenants = db.scalars(q(M.Tenant).order_by(M.Tenant.suite, M.Tenant.name)).all()
    bills = db.scalars(q(M.CamBilling)).all()
    rules = {r.id: r for r in db.scalars(q(M.LeaseRule).where(M.LeaseRule.status == "approved"))}
    pools: dict[uuid.UUID, list] = {}
    if rules:
        for a in db.scalars(select(M.AllocationRule).where(
                M.AllocationRule.organization_id == org,
                M.AllocationRule.lease_rule_id.in_(rules.keys())).order_by(M.AllocationRule.pool)):
            pools.setdefault(a.lease_rule_id, []).append(a)

    e_maps = []
    for m in maps:
        if m.status == "recoverable" and not m.category_code:
            e_maps.append(E.Mapping(m.gl_account, "", E.Recoverability.NEEDS_REVIEW))
        else:
            e_maps.append(E.Mapping(m.gl_account, m.category_code or "", E.Recoverability(m.status)))

    e_tenants = []
    for t in tenants:
        lr = rules.get(t.lease_rule_id) if t.lease_rule_id else None
        e_tenants.append(E.Tenant(str(t.id), t.name, t.rentable_area, t.lease_start, t.lease_end,
                                  _engine_rule(lr, pools.get(lr.id, [])) if lr else None))

    return E.AuditInput(
        period=E.Period(period.fiscal_year_start, period.fiscal_year_end, period.through_date),
        transactions=tuple(E.Transaction(str(t.id), t.gl_account, t.txn_date, t.amount,
                                         " ".join(x for x in (t.vendor, t.description) if x),
                                         f"batch {t.import_batch_id} row {t.source_row}")
                           for t in txns),
        categories=tuple(E.Category(c.code, c.pool, c.controllable, c.variable) for c in cats),
        mappings=tuple(e_maps),
        tenants=tuple(e_tenants),
        billings=tuple(E.Billing(str(b.tenant_id), b.bill_date, b.amount) for b in bills),
        excluded_transaction_ids=frozenset(str(t.id) for t in txns if t.excluded_by_review),
        variance_threshold=threshold,
    )


def _jsonable(obj):
    if isinstance(obj, dict):
        return {str(k): _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set, frozenset)):
        items = [_jsonable(v) for v in obj]
        return sorted(items, key=str) if isinstance(obj, (set, frozenset)) else items
    if obj is None or isinstance(obj, (bool, int, str)):
        return obj
    return str(obj)


def input_hash(inp: E.AuditInput) -> str:
    blob = json.dumps(_jsonable(asdict(inp)), sort_keys=True).encode()
    return hashlib.sha256(blob).hexdigest()


def execute(db: Session, actor: Actor, prop: M.Property, period: M.ReportingPeriod,
            threshold) -> M.AuditRun:
    inp = build_input(db, prop, period, threshold)
    out = run_audit(inp)
    counts: dict[str, int] = {}
    for e in out.exceptions:
        counts[e.severity.value] = counts.get(e.severity.value, 0) + 1
    summary = {
        "provisional": True,
        "period": {"fiscal_year_start": str(period.fiscal_year_start),
                   "fiscal_year_end": str(period.fiscal_year_end),
                   "through_date": str(period.through_date)},
        "pools": {k: {"recoverable_total": fmt(v.recoverable_total),
                      "allocated_total": fmt(v.allocated_total),
                      "rounding_difference": fmt(v.rounding_difference),
                      "by_category": {c: fmt(a) for c, a in sorted(v.by_category.items())}}
                  for k, v in sorted(out.pools.items())},
        "excluded": out.excluded,
        "included_count": len(out.included_transaction_ids),
        "tenants_calculated": sum(1 for r in out.tenants if r.status == "calculated"),
        "tenants_unresolved": sum(1 for r in out.tenants if r.status == "unresolved"),
        "exception_counts": counts,
        "variance_threshold": fmt(threshold),
    }
    run = M.AuditRun(organization_id=actor.org_id, property_id=prop.id, period_id=period.id,
                     input_hash=input_hash(inp), summary=summary, created_by=actor.user_id)
    db.add(run)
    db.flush()
    for r in out.tenants:
        res = M.AuditResult(
            organization_id=actor.org_id, audit_run_id=run.id, tenant_id=uuid.UUID(r.tenant_id),
            status=r.status, total=r.total, admin_fee=r.admin_fee, billed=r.billed,
            variance=r.variance, unresolved_reasons=r.unresolved_reasons,
            lines=[{"pool": ln.pool, "tenant_pool_amount": fmt(ln.tenant_pool_amount),
                    "share": fmt(ln.share), "amount_unrounded": fmt(ln.amount_unrounded),
                    "amount": fmt(ln.amount), "cap_reduction": fmt(ln.cap_reduction)}
                   for ln in r.lines])
        db.add(res)
        db.flush()
        db.add(M.CalculationTrace(organization_id=actor.org_id, audit_result_id=res.id,
                                  steps=[asdict(s) for s in r.trace]))
    for e in out.exceptions:
        db.add(M.AuditExceptionRow(
            organization_id=actor.org_id, audit_run_id=run.id, property_id=prop.id,
            type=e.type.value, severity=e.severity.value, message=e.message,
            tenant_id=uuid.UUID(e.tenant_id) if e.tenant_id else None,
            gl_account=e.gl_account, pool=e.pool, transaction_ids=list(e.transaction_ids),
            amount=e.amount))
    db.add(M.AuditLog(organization_id=actor.org_id, actor_id=actor.user_id, action="audit_run",
                      entity_type="audit_runs", entity_id=str(run.id),
                      after={"input_hash": run.input_hash}))
    prop.reconciliation_status = "in_review"
    db.commit()
    return run
