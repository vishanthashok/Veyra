"""Audit runs, results, traces, exceptions, report downloads."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as M
from ..auth import Actor, current_actor
from ..db import get_session
from ..schemas import AuditRunIn, ExceptionPatch
from ..scoping import get_owned, log, scoped
from ..services import audit as A
from ..services import reports as R

router = APIRouter()


def _run_out(run: M.AuditRun) -> dict:
    return {"id": str(run.id), "property_id": str(run.property_id), "period_id": str(run.period_id),
            "status": run.status, "provisional": run.provisional, "input_hash": run.input_hash,
            "summary": run.summary, "created_at": run.created_at.isoformat()}


@router.post("/properties/{pid}/audit-runs", status_code=201)
def create_run(pid: uuid.UUID, body: AuditRunIn, actor: Actor = Depends(current_actor),
               db: Session = Depends(get_session)):
    prop = get_owned(db, M.Property, pid, actor)
    period = get_owned(db, M.ReportingPeriod, body.period_id, actor)
    if period.property_id != pid:
        raise HTTPException(422, "Period belongs to another property.")
    run = A.execute(db, actor, prop, period, body.variance_threshold)
    return _run_out(run)


@router.get("/properties/{pid}/audit-runs")
def list_runs(pid: uuid.UUID, actor: Actor = Depends(current_actor),
              db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    runs = db.scalars(scoped(M.AuditRun, actor).where(M.AuditRun.property_id == pid)
                      .order_by(M.AuditRun.created_at.desc())).all()
    return [_run_out(r) for r in runs]


@router.get("/audit-runs/{rid}")
def get_run(rid: uuid.UUID, actor: Actor = Depends(current_actor),
            db: Session = Depends(get_session)):
    run = get_owned(db, M.AuditRun, rid, actor)
    tenants = {t.id: t for t in db.scalars(scoped(M.Tenant, actor).where(
        M.Tenant.property_id == run.property_id))}
    results = db.scalars(select(M.AuditResult).where(M.AuditResult.audit_run_id == run.id)).all()
    out = _run_out(run)
    out["results"] = [{
        "id": str(r.id), "tenant_id": str(r.tenant_id),
        "tenant_name": tenants[r.tenant_id].name if r.tenant_id in tenants else "",
        "suite": tenants[r.tenant_id].suite if r.tenant_id in tenants else "",
        "status": r.status, "lines": r.lines, "admin_fee": str(r.admin_fee),
        "total": None if r.total is None else str(r.total),
        "billed": None if r.billed is None else str(r.billed),
        "variance": None if r.variance is None else str(r.variance),
        "unresolved_reasons": r.unresolved_reasons,
    } for r in sorted(results, key=lambda r: (tenants[r.tenant_id].suite, tenants[r.tenant_id].name))]
    return out


@router.get("/audit-results/{rid}/trace")
def get_trace(rid: uuid.UUID, actor: Actor = Depends(current_actor),
              db: Session = Depends(get_session)):
    res = get_owned(db, M.AuditResult, rid, actor)
    tr = db.scalar(select(M.CalculationTrace).where(M.CalculationTrace.audit_result_id == res.id))
    return {"audit_result_id": str(res.id), "steps": tr.steps if tr else []}


def _exc_out(e: M.AuditExceptionRow, tenants) -> dict:
    return {"id": str(e.id), "audit_run_id": str(e.audit_run_id), "type": e.type,
            "severity": e.severity, "message": e.message,
            "tenant_id": str(e.tenant_id) if e.tenant_id else None,
            "tenant_name": tenants[e.tenant_id].name if e.tenant_id in tenants else None,
            "gl_account": e.gl_account, "pool": e.pool, "transaction_ids": e.transaction_ids,
            "amount": None if e.amount is None else str(e.amount), "status": e.status,
            "resolution_note": e.resolution_note}


@router.get("/audit-runs/{rid}/exceptions")
def list_exceptions(rid: uuid.UUID, actor: Actor = Depends(current_actor),
                    db: Session = Depends(get_session)):
    run = get_owned(db, M.AuditRun, rid, actor)
    tenants = {t.id: t for t in db.scalars(scoped(M.Tenant, actor).where(
        M.Tenant.property_id == run.property_id))}
    order = {"error": 0, "warning": 1, "info": 2}
    rows = db.scalars(select(M.AuditExceptionRow).where(M.AuditExceptionRow.audit_run_id == run.id)).all()
    return [_exc_out(e, tenants) for e in sorted(rows, key=lambda e: (order[e.severity], e.type))]


@router.patch("/exceptions/{eid}")
def patch_exception(eid: uuid.UUID, body: ExceptionPatch, actor: Actor = Depends(current_actor),
                    db: Session = Depends(get_session)):
    e = get_owned(db, M.AuditExceptionRow, eid, actor)
    before = {"status": e.status, "note": e.resolution_note}
    e.status = body.status
    e.resolution_note = body.note
    db.add(M.ReviewDecision(organization_id=actor.org_id, property_id=e.property_id,
                            target_type="exception", target_id=str(e.id), decision=body.status,
                            note=body.note, reviewer_id=actor.user_id))
    log(db, actor, "review", e, before, {"status": e.status, "note": e.resolution_note})
    db.commit()
    return _exc_out(e, {})


@router.get("/audit-runs/{rid}/reports/{kind}.xlsx")
def download_report(rid: uuid.UUID, kind: str, actor: Actor = Depends(current_actor),
                    db: Session = Depends(get_session)):
    run = get_owned(db, M.AuditRun, rid, actor)
    if kind not in R.KINDS and kind != "package":
        raise HTTPException(404, "Unknown report")
    data = R.build(kind, R.load_context(db, run))
    prop = db.get(M.Property, run.property_id)
    safe = "".join(ch if ch.isalnum() else "_" for ch in prop.name)[:60]
    return Response(content=data,
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition":
                             f'attachment; filename="{safe}_{kind}_PROVISIONAL.xlsx"'})


@router.get("/reports")
def report_kinds():
    return {"kinds": {**R.KINDS, "package": "Full audit package (all sheets)"}}
