"""Audit runs, results, traces, exception review queue and report downloads."""

import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as M
from ..auth import Actor, current_actor
from ..db import get_session
from ..schemas import AuditRunIn, ExceptionAssign, ExceptionPatch
from ..scoping import get_owned, idempotency_key, log, scoped
from ..services import audit as A
from ..services import reports as R

router = APIRouter()

# Allowed exception transitions (F-05). Errors cannot be resolved by hand: fix data and re-run,
# or accept with a documented reason. Accepted items stay in the record and can be reopened.
TRANSITIONS = {
    "open": {"in_review", "resolved", "accepted"},
    "in_review": {"open", "resolved", "accepted"},
    "reopened": {"in_review", "resolved", "accepted"},
    "resolved": {"reopened"},
    "accepted": {"reopened"},
}


def _tenant_names(run: M.AuditRun, db, actor) -> dict[str, dict]:
    if run.snapshot:
        return {t["id"]: t for t in run.snapshot["tenants"]}
    return {
        str(t.id): {"name": t.name, "suite": t.suite}
        for t in db.scalars(scoped(M.Tenant, actor).where(M.Tenant.property_id == run.property_id))
    }


def _run_out(run: M.AuditRun) -> dict:
    snap = run.snapshot or {}
    return {
        "id": str(run.id),
        "property_id": str(run.property_id),
        "period_id": str(run.period_id),
        "status": run.status,
        "provisional": run.provisional,
        "input_hash": run.input_hash,
        "engine_version": run.engine_version,
        "reproducible": bool(run.snapshot),
        "period_label": (snap.get("period") or {}).get("label"),
        "snapshot_counts": {
            k: len(snap.get(k, []))
            for k in ("transactions", "mappings", "lease_rules", "tenants", "billings", "source_files")
        },
        "summary": run.summary,
        "created_at": run.created_at.isoformat(),
    }


@router.post("/properties/{pid}/audit-runs", status_code=201)
def create_run(
    pid: uuid.UUID,
    body: AuditRunIn,
    idem: str | None = Header(None, alias="Idempotency-Key"),
    actor: Actor = Depends(current_actor),
    db: Session = Depends(get_session),
):
    prop = get_owned(db, M.Property, pid, actor)
    key = idempotency_key(idem)
    if key:
        prior = db.scalar(scoped(M.AuditRun, actor).where(M.AuditRun.idempotency_key == key))
        if prior:
            if prior.property_id != pid:
                raise HTTPException(409, "Idempotency-Key was already used for another property.")
            return _run_out(prior)
    period = get_owned(db, M.ReportingPeriod, body.period_id, actor)
    if period.property_id != pid:
        raise HTTPException(422, "Period belongs to another property.")
    return _run_out(A.execute(db, actor, prop, period, body.variance_threshold, key))


@router.get("/properties/{pid}/audit-runs")
def list_runs(pid: uuid.UUID, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    runs = db.scalars(
        scoped(M.AuditRun, actor).where(M.AuditRun.property_id == pid).order_by(M.AuditRun.created_at.desc())
    ).all()
    return [_run_out(r) for r in runs]


@router.get("/audit-runs/{rid}")
def get_run(rid: uuid.UUID, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    run = get_owned(db, M.AuditRun, rid, actor)
    names = _tenant_names(run, db, actor)
    results = db.scalars(select(M.AuditResult).where(M.AuditResult.audit_run_id == run.id)).all()
    out = _run_out(run)
    rows = []
    for r in results:
        t = names.get(str(r.tenant_id), {})
        rows.append(
            {
                "id": str(r.id),
                "tenant_id": str(r.tenant_id),
                "tenant_name": t.get("name", ""),
                "suite": t.get("suite", ""),
                "rentable_area": t.get("rentable_area"),
                "status": r.status,
                "lines": r.lines,
                "admin_fee": str(r.admin_fee),
                "total": None if r.total is None else str(r.total),
                "billed": None if r.billed is None else str(r.billed),
                "variance": None if r.variance is None else str(r.variance),
                "unresolved_reasons": r.unresolved_reasons,
            }
        )
    out["results"] = sorted(rows, key=lambda x: (x["suite"], x["tenant_name"]))
    return out


@router.post("/audit-runs/{rid}/verify")
def verify_run(rid: uuid.UUID, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    """Re-run the engine on the stored snapshot. Proves the run is reproducible."""
    return A.verify(db, get_owned(db, M.AuditRun, rid, actor))


@router.get("/audit-results/{rid}/trace")
def get_trace(rid: uuid.UUID, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    res = get_owned(db, M.AuditResult, rid, actor)
    run = db.get(M.AuditRun, res.audit_run_id)
    tr = db.scalar(select(M.CalculationTrace).where(M.CalculationTrace.audit_result_id == res.id))
    snap = run.snapshot or {}
    tenant = next((t for t in snap.get("tenants", []) if t["id"] == str(res.tenant_id)), None)
    rule = next((r for r in snap.get("lease_rules", []) if tenant and r["id"] == tenant["lease_rule_id"]), None)
    excluded = {reason: len(ids) for reason, ids in (run.summary.get("excluded") or {}).items()}
    return {
        "audit_result_id": str(res.id),
        "audit_run_id": str(run.id),
        "engine_version": run.engine_version,
        "input_hash": run.input_hash,
        "tenant": tenant,
        "lease_rule": rule,
        "pools": run.summary.get("pools", {}),
        "excluded_counts": excluded,
        "billed": None if res.billed is None else str(res.billed),
        "steps": tr.steps if tr else [],
    }


# Exceptions ------------------------------------------------------------------


def _exc_out(e: M.AuditExceptionRow, names: dict, users: dict) -> dict:
    return {
        "id": str(e.id),
        "audit_run_id": str(e.audit_run_id),
        "type": e.type,
        "severity": e.severity,
        "message": e.message,
        "tenant_id": str(e.tenant_id) if e.tenant_id else None,
        "tenant_name": names.get(str(e.tenant_id), {}).get("name") if e.tenant_id else None,
        "gl_account": e.gl_account,
        "pool": e.pool,
        "transaction_ids": e.transaction_ids,
        "amount": None if e.amount is None else str(e.amount),
        "status": e.status,
        "resolution_note": e.resolution_note,
        "assigned_to": str(e.assigned_to) if e.assigned_to else None,
        "assigned_to_name": users.get(e.assigned_to),
        "updated_at": e.updated_at.isoformat(),
        "created_at": e.created_at.isoformat(),
    }


ORDER = {"error": 0, "warning": 1, "info": 2}


@router.get("/audit-runs/{rid}/exceptions")
def list_exceptions(
    rid: uuid.UUID,
    status: str | None = None,
    severity: str | None = None,
    type: str | None = None,
    actor: Actor = Depends(current_actor),
    db: Session = Depends(get_session),
):
    run = get_owned(db, M.AuditRun, rid, actor)
    q = select(M.AuditExceptionRow).where(M.AuditExceptionRow.audit_run_id == run.id)
    if status:
        q = q.where(M.AuditExceptionRow.status.in_(status.split(",")))
    if severity:
        q = q.where(M.AuditExceptionRow.severity.in_(severity.split(",")))
    if type:
        q = q.where(M.AuditExceptionRow.type == type)
    names = _tenant_names(run, db, actor)
    users = {u.id: u.name for u in db.scalars(scoped(M.User, actor))}
    rows = db.scalars(q).all()
    return [_exc_out(e, names, users) for e in sorted(rows, key=lambda e: (ORDER[e.severity], e.type, e.message))]


@router.patch("/exceptions/{eid}")
def patch_exception(
    eid: uuid.UUID, body: ExceptionPatch, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)
):
    e = get_owned(db, M.AuditExceptionRow, eid, actor)
    if body.status == e.status:
        raise HTTPException(409, f"Exception is already {e.status}.")
    if body.status not in TRANSITIONS.get(e.status, set()):
        raise HTTPException(422, f"Cannot move an exception from {e.status} to {body.status}.")
    if e.severity == "error" and body.status == "resolved":
        raise HTTPException(
            422,
            "Blocking errors are not resolved by hand. Fix the data and re-run the "
            "audit, or accept the exception with a documented reason.",
        )
    before = {"status": e.status, "note": e.resolution_note}
    e.status = body.status
    e.resolution_note = body.note
    db.add(
        M.ReviewDecision(
            organization_id=actor.org_id,
            property_id=e.property_id,
            target_type="exception",
            target_id=str(e.id),
            decision=body.status,
            note=body.note,
            reviewer_id=actor.user_id,
        )
    )
    log(db, actor, "review", e, before, {"status": e.status, "note": e.resolution_note})
    db.commit()
    run = db.get(M.AuditRun, e.audit_run_id)
    return _exc_out(e, _tenant_names(run, db, actor), {u.id: u.name for u in db.scalars(scoped(M.User, actor))})


@router.put("/exceptions/{eid}/assignee")
def assign_exception(
    eid: uuid.UUID, body: ExceptionAssign, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)
):
    e = get_owned(db, M.AuditExceptionRow, eid, actor)
    if body.user_id is not None:
        get_owned(db, M.User, body.user_id, actor)
    e.assigned_to = body.user_id
    db.add(
        M.ReviewDecision(
            organization_id=actor.org_id,
            property_id=e.property_id,
            target_type="exception",
            target_id=str(e.id),
            decision="assigned",
            note=str(body.user_id or "unassigned"),
            reviewer_id=actor.user_id,
        )
    )
    db.commit()
    run = db.get(M.AuditRun, e.audit_run_id)
    return _exc_out(e, _tenant_names(run, db, actor), {u.id: u.name for u in db.scalars(scoped(M.User, actor))})


@router.get("/exceptions/{eid}/history")
def exception_history(eid: uuid.UUID, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    e = get_owned(db, M.AuditExceptionRow, eid, actor)
    users = {u.id: u.name for u in db.scalars(scoped(M.User, actor))}
    rows = db.scalars(
        scoped(M.ReviewDecision, actor)
        .where(
            M.ReviewDecision.target_type == "exception",
            M.ReviewDecision.target_id == str(e.id),
            M.ReviewDecision.decision != "assigned",
        )
        .order_by(M.ReviewDecision.created_at)
    ).all()
    return [
        {"decision": r.decision, "note": r.note, "reviewer": users.get(r.reviewer_id), "at": r.created_at.isoformat()}
        for r in rows
    ]


@router.get("/users")
def list_users(actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    return [
        {"id": str(u.id), "name": u.name, "email": u.email}
        for u in db.scalars(scoped(M.User, actor).order_by(M.User.name))
    ]


# Reports ---------------------------------------------------------------------


@router.get("/audit-runs/{rid}/reports/{kind}.xlsx")
def download_report(
    rid: uuid.UUID, kind: str, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)
):
    run = get_owned(db, M.AuditRun, rid, actor)
    if kind not in R.KINDS:
        raise HTTPException(404, "Unknown report")
    if not run.snapshot:
        raise HTTPException(
            409, "This run predates audit snapshots and cannot produce a faithful report. Re-run the audit."
        )
    data = R.build(kind, R.load_context(db, run))
    safe = "".join(ch if ch.isalnum() else "_" for ch in run.snapshot["property"]["name"])[:60]
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{safe}_{kind}_{run.created_at:%Y%m%d}_PROVISIONAL.xlsx"'
        },
    )


@router.get("/reports")
def report_kinds():
    return {"kinds": R.KINDS}


@router.get("/properties/{pid}/exceptions")
def property_exceptions(
    pid: uuid.UUID,
    run: str = Query("latest"),
    status: str | None = None,
    severity: str | None = None,
    actor: Actor = Depends(current_actor),
    db: Session = Depends(get_session),
):
    """Review queue for one property, from the latest run by default."""
    get_owned(db, M.Property, pid, actor)
    if run == "latest":
        r = db.scalar(
            scoped(M.AuditRun, actor)
            .where(M.AuditRun.property_id == pid)
            .order_by(M.AuditRun.created_at.desc())
            .limit(1)
        )
        if r is None:
            return []
        rid = r.id
    else:
        rid = uuid.UUID(run)
    return list_exceptions(rid, status, severity, None, actor, db)
