import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models as M
from ..auth import COOKIE, Actor, current_actor, make_session_token, verify_password
from ..config import settings
from ..core import ratelimit as rl
from ..db import get_session
from ..schemas import (
    CategoryIn,
    CategoryOut,
    LoginIn,
    MeOut,
    PeriodIn,
    PeriodOut,
    PropertyIn,
    PropertyOut,
    TenantIn,
    TenantOut,
)
from ..scoping import OPEN_STATUSES, get_owned, log, scoped, snapshot

router = APIRouter()


@router.post("/auth/login", response_model=MeOut)
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_session)):
    email = body.email.lower().strip()
    ip = request.client.host if request.client else "unknown"
    wait = max(rl.failed_logins_by_email.blocked(email), rl.failed_logins_by_ip.blocked(ip))
    if wait:
        raise HTTPException(
            429, "Too many failed sign-in attempts. Try again later.", headers={"Retry-After": str(wait)}
        )
    user = db.scalar(select(M.User).where(M.User.email == email))
    if user is None or not verify_password(user.password_hash, body.password):
        rl.failed_logins_by_email.hit(email)
        rl.failed_logins_by_ip.hit(ip)
        raise HTTPException(401, "Invalid email or password")
    rl.failed_logins_by_email.reset(email)
    response.set_cookie(
        COOKIE,
        make_session_token(user),
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=settings.session_max_age_seconds,
    )
    return MeOut(user_id=user.id, org_id=user.organization_id, email=user.email, name=user.name)


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_session)):
    """Revokes every session for the user by bumping session_version (F-07)."""
    try:
        actor = current_actor(request, db)
    except HTTPException:
        actor = None
    if actor:
        user = db.get(M.User, actor.user_id)
        user.session_version += 1
        db.commit()
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
def create_property(body: PropertyIn, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    p = M.Property(organization_id=actor.org_id, **body.model_dump())
    db.add(p)
    db.flush()
    log(db, actor, "create", p, after=snapshot(p, PROP_FIELDS))
    db.commit()
    return p


@router.get("/properties/{pid}", response_model=PropertyOut)
def get_property(pid: uuid.UUID, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    return get_owned(db, M.Property, pid, actor)


@router.put("/properties/{pid}", response_model=PropertyOut)
def update_property(
    pid: uuid.UUID, body: PropertyIn, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)
):
    p = get_owned(db, M.Property, pid, actor)
    before = snapshot(p, PROP_FIELDS)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    log(db, actor, "update", p, before, snapshot(p, PROP_FIELDS))
    db.commit()
    return p


# Periods ---------------------------------------------------------------------


@router.get("/properties/{pid}/periods", response_model=list[PeriodOut])
def list_periods(pid: uuid.UUID, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    return db.scalars(
        scoped(M.ReportingPeriod, actor)
        .where(M.ReportingPeriod.property_id == pid)
        .order_by(M.ReportingPeriod.fiscal_year_start.desc())
    ).all()


@router.post("/properties/{pid}/periods", response_model=PeriodOut, status_code=201)
def create_period(
    pid: uuid.UUID, body: PeriodIn, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)
):
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
def list_tenants(pid: uuid.UUID, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    return db.scalars(
        scoped(M.Tenant, actor).where(M.Tenant.property_id == pid).order_by(M.Tenant.suite, M.Tenant.name)
    ).all()


@router.post("/properties/{pid}/tenants", response_model=TenantOut, status_code=201)
def create_tenant(
    pid: uuid.UUID, body: TenantIn, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)
):
    get_owned(db, M.Property, pid, actor)
    _check_rule(db, actor, pid, body.lease_rule_id)
    t = M.Tenant(organization_id=actor.org_id, property_id=pid, **body.model_dump())
    db.add(t)
    db.flush()
    log(db, actor, "create", t, after=snapshot(t, TENANT_FIELDS))
    db.commit()
    return t


@router.put("/tenants/{tid}", response_model=TenantOut)
def update_tenant(
    tid: uuid.UUID, body: TenantIn, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)
):
    t = get_owned(db, M.Tenant, tid, actor)
    _check_rule(db, actor, t.property_id, body.lease_rule_id)
    before = snapshot(t, TENANT_FIELDS)
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    log(db, actor, "update", t, before, snapshot(t, TENANT_FIELDS))
    db.commit()
    return t


@router.delete("/tenants/{tid}", status_code=204)
def delete_tenant(tid: uuid.UUID, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    """Only tenants with no billings and no audit history can be deleted (F-02)."""
    t = get_owned(db, M.Tenant, tid, actor)
    billings = db.scalar(select(func.count()).select_from(M.CamBilling).where(M.CamBilling.tenant_id == t.id))
    results = db.scalar(select(func.count()).select_from(M.AuditResult).where(M.AuditResult.tenant_id == t.id))
    if billings or results:
        raise HTTPException(
            409,
            f"{t.name} has {billings} billing records and {results} audit results. "
            "Tenants with financial history cannot be deleted.",
        )
    log(db, actor, "delete", t, before=snapshot(t, TENANT_FIELDS))
    db.delete(t)
    db.commit()


# Categories ------------------------------------------------------------------


@router.get("/properties/{pid}/categories", response_model=list[CategoryOut])
def list_categories(pid: uuid.UUID, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    return db.scalars(
        scoped(M.ExpenseCategory, actor)
        .where(M.ExpenseCategory.property_id == pid)
        .order_by(M.ExpenseCategory.pool, M.ExpenseCategory.code)
    ).all()


@router.post("/properties/{pid}/categories", response_model=CategoryOut, status_code=201)
def create_category(
    pid: uuid.UUID, body: CategoryIn, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)
):
    get_owned(db, M.Property, pid, actor)
    exists = db.scalar(
        scoped(M.ExpenseCategory, actor).where(
            M.ExpenseCategory.property_id == pid, M.ExpenseCategory.code == body.code
        )
    )
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
    """Readiness per property with a fixed number of grouped queries (F-14)."""
    org = actor.org_id
    props = db.scalars(scoped(M.Property, actor).order_by(M.Property.name)).all()

    def grouped(stmt):
        return dict(db.execute(stmt).tuples().all())

    tenants = grouped(
        select(M.Tenant.property_id, func.count()).where(M.Tenant.organization_id == org).group_by(M.Tenant.property_id)
    )
    no_area = grouped(
        select(M.Tenant.property_id, func.count())
        .where(M.Tenant.organization_id == org, M.Tenant.rentable_area.is_(None))
        .group_by(M.Tenant.property_id)
    )
    rule_status = {r.id: r.status for r in db.scalars(scoped(M.LeaseRule, actor))}
    no_rule: dict = {}
    draft_rule: dict = {}
    for pid, rid in db.execute(
        select(M.Tenant.property_id, M.Tenant.lease_rule_id).where(M.Tenant.organization_id == org)
    ):
        if rid is None:
            no_rule[pid] = no_rule.get(pid, 0) + 1
        elif rule_status.get(rid) != "approved":
            draft_rule[pid] = draft_rule.get(pid, 0) + 1
    unapproved_rules = grouped(
        select(M.LeaseRule.property_id, func.count())
        .where(M.LeaseRule.organization_id == org, M.LeaseRule.status != "approved")
        .group_by(M.LeaseRule.property_id)
    )
    accounts = grouped(
        select(M.GLTransaction.property_id, func.count(func.distinct(M.GLTransaction.gl_account)))
        .where(M.GLTransaction.organization_id == org)
        .group_by(M.GLTransaction.property_id)
    )
    reviewed = grouped(
        select(M.ExpenseMapping.property_id, func.count())
        .where(
            M.ExpenseMapping.organization_id == org,
            M.ExpenseMapping.status != "needs_review",
            M.ExpenseMapping.gl_account.in_(
                select(M.GLTransaction.gl_account).where(M.GLTransaction.property_id == M.ExpenseMapping.property_id)
            ),
        )
        .group_by(M.ExpenseMapping.property_id)
    )
    gl_rows = grouped(
        select(M.GLTransaction.property_id, func.count())
        .where(M.GLTransaction.organization_id == org)
        .group_by(M.GLTransaction.property_id)
    )
    bill_rows = grouped(
        select(M.CamBilling.property_id, func.count())
        .where(M.CamBilling.organization_id == org)
        .group_by(M.CamBilling.property_id)
    )
    latest_ids = (
        select(M.AuditRun.property_id, func.max(M.AuditRun.created_at).label("mx"))
        .where(M.AuditRun.organization_id == org)
        .group_by(M.AuditRun.property_id)
        .subquery()
    )
    latest = {
        r.property_id: r
        for r in db.scalars(
            select(M.AuditRun).join(
                latest_ids,
                (M.AuditRun.property_id == latest_ids.c.property_id) & (M.AuditRun.created_at == latest_ids.c.mx),
            )
        )
    }
    open_exc: dict = {}
    if latest:
        for pid, sev, n in db.execute(
            select(M.AuditExceptionRow.property_id, M.AuditExceptionRow.severity, func.count())
            .where(
                M.AuditExceptionRow.audit_run_id.in_([r.id for r in latest.values()]),
                M.AuditExceptionRow.status.in_(OPEN_STATUSES),
            )
            .group_by(M.AuditExceptionRow.property_id, M.AuditExceptionRow.severity)
        ):
            open_exc.setdefault(pid, {})[sev] = n

    out = []
    for p in props:
        n_acc = accounts.get(p.id, 0)
        needs_review = n_acc - reviewed.get(p.id, 0)
        checks = {
            "gl_imported": gl_rows.get(p.id, 0) > 0,
            "billings_imported": bill_rows.get(p.id, 0) > 0,
            "accounts_reviewed": n_acc > 0 and needs_review == 0,
            "tenants_have_area": tenants.get(p.id, 0) > 0 and no_area.get(p.id, 0) == 0,
            "tenants_have_approved_rules": tenants.get(p.id, 0) > 0
            and no_rule.get(p.id, 0) + draft_rule.get(p.id, 0) == 0,
            "audit_run": p.id in latest,
            "no_open_errors": p.id in latest and open_exc.get(p.id, {}).get("error", 0) == 0,
        }
        run = latest.get(p.id)
        out.append(
            {
                "id": str(p.id),
                "name": p.name,
                "property_type": p.property_type,
                "reconciliation_status": p.reconciliation_status,
                "tenants": tenants.get(p.id, 0),
                "gl_accounts": n_acc,
                "accounts_needing_review": needs_review,
                "tenants_missing_rules": no_rule.get(p.id, 0),
                "tenants_with_draft_rules": draft_rule.get(p.id, 0),
                "unapproved_rules": unapproved_rules.get(p.id, 0),
                "tenants_missing_area": no_area.get(p.id, 0),
                "open_exceptions": open_exc.get(p.id, {}),
                "checks": checks,
                "completeness": round(100 * sum(checks.values()) / len(checks)),
                "ready": all(checks.values()),
                "latest_audit": {
                    "id": str(run.id),
                    "created_at": run.created_at.isoformat(),
                    "engine_version": run.engine_version,
                    "through_date": (run.summary.get("period") or {}).get("through_date"),
                    "tenants_calculated": run.summary.get("tenants_calculated"),
                    "tenants_unresolved": run.summary.get("tenants_unresolved"),
                }
                if run
                else None,
            }
        )
    return {"properties": out}
