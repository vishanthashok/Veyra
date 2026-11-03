import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models as M
from ..auth import COOKIE, Actor, current_actor, make_session_token, verify_password
from ..config import settings
from ..db import get_session
from ..schemas import (
    CategoryIn, CategoryOut, LoginIn, MeOut, PeriodIn, PeriodOut, PropertyIn, PropertyOut,
    TenantIn, TenantOut,
)
from ..scoping import get_owned, log, scoped, snapshot

router = APIRouter()


@router.post("/auth/login", response_model=MeOut)
def login(body: LoginIn, response: Response, db: Session = Depends(get_session)):
    user = db.scalar(select(M.User).where(M.User.email == body.email.lower().strip()))
    if user is None or not verify_password(user.password_hash, body.password):
        raise HTTPException(401, "Invalid email or password")
    response.set_cookie(COOKIE, make_session_token(user.id), httponly=True, samesite="lax",
                        secure=settings.cookie_secure, max_age=settings.session_max_age_seconds)
    return MeOut(user_id=user.id, org_id=user.organization_id, email=user.email, name=user.name)


@router.post("/auth/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(COOKIE)


@router.get("/auth/me", response_model=MeOut)
def me(actor: Actor = Depends(current_actor)):
    return MeOut(user_id=actor.user_id, org_id=actor.org_id, email=actor.email, name=actor.name)


# Properties ------------------------------------------------------------------

PROP_FIELDS = list(PropertyIn.model_fields)


@router.get("/properties", response_model=list[PropertyOut])
def list_properties(actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    return db.scalars(scoped(M.Property, actor).order_by(M.Property.name)).all()


@router.post("/properties", response_model=PropertyOut, status_code=201)
def create_property(body: PropertyIn, actor: Actor = Depends(current_actor),
                    db: Session = Depends(get_session)):
    p = M.Property(organization_id=actor.org_id, **body.model_dump())
    db.add(p)
    db.flush()
    log(db, actor, "create", p, after=snapshot(p, PROP_FIELDS))
    db.commit()
    return p


@router.get("/properties/{pid}", response_model=PropertyOut)
def get_property(pid: uuid.UUID, actor: Actor = Depends(current_actor),
                 db: Session = Depends(get_session)):
    return get_owned(db, M.Property, pid, actor)


@router.put("/properties/{pid}", response_model=PropertyOut)
def update_property(pid: uuid.UUID, body: PropertyIn, actor: Actor = Depends(current_actor),
                    db: Session = Depends(get_session)):
    p = get_owned(db, M.Property, pid, actor)
    before = snapshot(p, PROP_FIELDS)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    log(db, actor, "update", p, before, snapshot(p, PROP_FIELDS))
    db.commit()
    return p


# Periods ---------------------------------------------------------------------

@router.get("/properties/{pid}/periods", response_model=list[PeriodOut])
def list_periods(pid: uuid.UUID, actor: Actor = Depends(current_actor),
                 db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    return db.scalars(scoped(M.ReportingPeriod, actor).where(
        M.ReportingPeriod.property_id == pid).order_by(M.ReportingPeriod.fiscal_year_start.desc())).all()


@router.post("/properties/{pid}/periods", response_model=PeriodOut, status_code=201)
def create_period(pid: uuid.UUID, body: PeriodIn, actor: Actor = Depends(current_actor),
                  db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    if not (body.fiscal_year_start <= body.through_date <= body.fiscal_year_end):
        raise HTTPException(422, "Through date must fall inside the fiscal year.")
    per = M.ReportingPeriod(organization_id=actor.org_id, property_id=pid, **body.model_dump())
    db.add(per)
    db.flush()
    log(db, actor, "create", per, after=snapshot(per, list(PeriodIn.model_fields)))
    db.commit()
    return per


# Tenants ---------------------------------------------------------------------

TENANT_FIELDS = list(TenantIn.model_fields)


def _check_rule(db, actor, pid, rule_id):
    if rule_id is not None:
        r = get_owned(db, M.LeaseRule, rule_id, actor)
        if r.property_id != pid:
            raise HTTPException(422, "Lease rule belongs to another property.")


@router.get("/properties/{pid}/tenants", response_model=list[TenantOut])
def list_tenants(pid: uuid.UUID, actor: Actor = Depends(current_actor),
                 db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    return db.scalars(scoped(M.Tenant, actor).where(M.Tenant.property_id == pid)
                      .order_by(M.Tenant.suite, M.Tenant.name)).all()


@router.post("/properties/{pid}/tenants", response_model=TenantOut, status_code=201)
def create_tenant(pid: uuid.UUID, body: TenantIn, actor: Actor = Depends(current_actor),
                  db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    _check_rule(db, actor, pid, body.lease_rule_id)
    t = M.Tenant(organization_id=actor.org_id, property_id=pid, **body.model_dump())
    db.add(t)
    db.flush()
    log(db, actor, "create", t, after=snapshot(t, TENANT_FIELDS))
    db.commit()
    return t


@router.put("/tenants/{tid}", response_model=TenantOut)
def update_tenant(tid: uuid.UUID, body: TenantIn, actor: Actor = Depends(current_actor),
                  db: Session = Depends(get_session)):
    t = get_owned(db, M.Tenant, tid, actor)
    _check_rule(db, actor, t.property_id, body.lease_rule_id)
    before = snapshot(t, TENANT_FIELDS)
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    log(db, actor, "update", t, before, snapshot(t, TENANT_FIELDS))
    db.commit()
    return t


@router.delete("/tenants/{tid}", status_code=204)
def delete_tenant(tid: uuid.UUID, actor: Actor = Depends(current_actor),
                  db: Session = Depends(get_session)):
    t = get_owned(db, M.Tenant, tid, actor)
    log(db, actor, "delete", t, before=snapshot(t, TENANT_FIELDS))
    db.delete(t)
    db.commit()


# Categories ------------------------------------------------------------------

@router.get("/properties/{pid}/categories", response_model=list[CategoryOut])
def list_categories(pid: uuid.UUID, actor: Actor = Depends(current_actor),
                    db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    return db.scalars(scoped(M.ExpenseCategory, actor).where(
        M.ExpenseCategory.property_id == pid).order_by(M.ExpenseCategory.pool,
                                                       M.ExpenseCategory.code)).all()


@router.post("/properties/{pid}/categories", response_model=CategoryOut, status_code=201)
def create_category(pid: uuid.UUID, body: CategoryIn, actor: Actor = Depends(current_actor),
                    db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    exists = db.scalar(scoped(M.ExpenseCategory, actor).where(
        M.ExpenseCategory.property_id == pid, M.ExpenseCategory.code == body.code))
    if exists:
        raise HTTPException(409, f"Category {body.code} already exists.")
    c = M.ExpenseCategory(organization_id=actor.org_id, property_id=pid, **body.model_dump())
    db.add(c)
    db.flush()
    log(db, actor, "create", c, after=body.model_dump())
    db.commit()
    return c


# Dashboard -------------------------------------------------------------------

@router.get("/dashboard")
def dashboard(actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    props = db.scalars(scoped(M.Property, actor).order_by(M.Property.name)).all()
    out = []
    for p in props:
        tenants = db.scalar(select(func.count()).select_from(M.Tenant).where(
            M.Tenant.organization_id == actor.org_id, M.Tenant.property_id == p.id))
        accounts = set(db.scalars(select(M.GLTransaction.gl_account).distinct().where(
            M.GLTransaction.organization_id == actor.org_id, M.GLTransaction.property_id == p.id)))
        reviewed = set(db.scalars(select(M.ExpenseMapping.gl_account).where(
            M.ExpenseMapping.organization_id == actor.org_id, M.ExpenseMapping.property_id == p.id,
            M.ExpenseMapping.status != "needs_review")))
        missing_rules = db.scalar(select(func.count()).select_from(M.Tenant).where(
            M.Tenant.organization_id == actor.org_id, M.Tenant.property_id == p.id,
            M.Tenant.lease_rule_id.is_(None)))
        latest = db.scalar(scoped(M.AuditRun, actor).where(M.AuditRun.property_id == p.id)
                           .order_by(M.AuditRun.created_at.desc()).limit(1))
        open_exc = {}
        if latest:
            for sev, n in db.execute(select(M.AuditExceptionRow.severity, func.count()).where(
                    M.AuditExceptionRow.audit_run_id == latest.id,
                    M.AuditExceptionRow.status == "open").group_by(M.AuditExceptionRow.severity)):
                open_exc[sev] = n
        out.append({
            "id": str(p.id), "name": p.name, "property_type": p.property_type,
            "reconciliation_status": p.reconciliation_status, "tenants": tenants,
            "gl_accounts": len(accounts), "accounts_needing_review": len(accounts - reviewed),
            "tenants_missing_rules": missing_rules, "open_exceptions": open_exc,
            "latest_audit": {"id": str(latest.id), "created_at": latest.created_at.isoformat(),
                             "tenants_calculated": latest.summary.get("tenants_calculated"),
                             "tenants_unresolved": latest.summary.get("tenants_unresolved")}
            if latest else None,
        })
    return {"properties": out}
