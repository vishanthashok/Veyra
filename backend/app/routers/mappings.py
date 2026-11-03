"""GL accounts, transactions and reviewed expense mappings.

A mapping is a reviewer decision. It is never inferred from an account name. Each decision bumps
the mapping version and writes a review_decisions row, so audit snapshots can cite the version.
"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import models as M
from ..auth import Actor, current_actor
from ..db import get_session
from ..schemas import BulkMappingIn, GLAccountOut, GLTransactionOut, MappingIn, Page, ReviewIn
from ..scoping import get_owned, log, scoped, snapshot

router = APIRouter()
MAP_FIELDS = ["category_code", "status", "explanation", "source_ref", "version"]


def _accounts(db, actor, pid, only: list[str] | None = None) -> list[GLAccountOut]:
    q = (
        select(
            M.GLTransaction.gl_account,
            func.max(M.GLTransaction.account_name),
            func.count(),
            func.sum(M.GLTransaction.amount),
            func.count().filter(M.GLTransaction.excluded_by_review.is_(True)),
        )
        .where(M.GLTransaction.organization_id == actor.org_id, M.GLTransaction.property_id == pid)
        .group_by(M.GLTransaction.gl_account)
        .order_by(M.GLTransaction.gl_account)
    )
    if only is not None:
        q = q.where(M.GLTransaction.gl_account.in_(only))
    agg = {a: rest for a, *rest in db.execute(q)}
    mq = scoped(M.ExpenseMapping, actor).where(M.ExpenseMapping.property_id == pid)
    if only is not None:
        mq = mq.where(M.ExpenseMapping.gl_account.in_(only))
    maps = {m.gl_account: m for m in db.scalars(mq)}
    users = {u.id: u.name for u in db.scalars(scoped(M.User, actor))}
    out = []
    for acct in sorted(set(agg) | set(maps)):
        name, n, total, n_excl = agg.get(acct, ("", 0, 0, 0))
        m = maps.get(acct)
        out.append(
            GLAccountOut(
                gl_account=acct,
                account_name=name or "",
                transaction_count=n,
                total=total or 0,
                excluded_count=n_excl,
                mapping_id=m.id if m else None,
                category_code=m.category_code if m else None,
                status=m.status if m else "needs_review",
                explanation=m.explanation if m else "",
                source_ref=m.source_ref if m else "",
                version=m.version if m else 0,
                reviewer=users.get(m.reviewer_id) if m and m.reviewer_id else None,
                reviewed_at=m.reviewed_at if m else None,
            )
        )
    return out


@router.get("/properties/{pid}/gl-accounts", response_model=list[GLAccountOut])
def gl_accounts(pid: uuid.UUID, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    return [a for a in _accounts(db, actor, pid) if a.transaction_count > 0]


@router.get("/properties/{pid}/gl-transactions", response_model=Page[GLTransactionOut])
def gl_transactions(
    pid: uuid.UUID,
    gl_account: str | None = None,
    q: str | None = None,
    excluded: bool | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    actor: Actor = Depends(current_actor),
    db: Session = Depends(get_session),
):
    """Paginated, filterable transaction list (F-13)."""
    get_owned(db, M.Property, pid, actor)
    base = scoped(M.GLTransaction, actor).where(M.GLTransaction.property_id == pid)
    if gl_account:
        base = base.where(M.GLTransaction.gl_account == gl_account)
    if excluded is not None:
        base = base.where(M.GLTransaction.excluded_by_review.is_(excluded))
    if q:
        like = f"%{q.strip()}%"
        base = base.where(
            or_(
                M.GLTransaction.description.ilike(like),
                M.GLTransaction.vendor.ilike(like),
                M.GLTransaction.gl_account.ilike(like),
            )
        )
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    items = db.scalars(
        base.order_by(M.GLTransaction.gl_account, M.GLTransaction.txn_date, M.GLTransaction.source_row)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return Page(items=[GLTransactionOut.model_validate(t) for t in items], total=total, page=page, page_size=page_size)


@router.post("/gl-transactions/{tid}/exclude", response_model=GLTransactionOut)
def exclude_transaction(
    tid: uuid.UUID, body: ReviewIn, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)
):
    return _set_excluded(tid, True, body, actor, db)


@router.post("/gl-transactions/{tid}/include", response_model=GLTransactionOut)
def include_transaction(
    tid: uuid.UUID, body: ReviewIn, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)
):
    return _set_excluded(tid, False, body, actor, db)


def _set_excluded(tid, value, body, actor, db):
    t = get_owned(db, M.GLTransaction, tid, actor)
    t.excluded_by_review = value
    db.add(
        M.ReviewDecision(
            organization_id=actor.org_id,
            property_id=t.property_id,
            target_type="gl_transaction",
            target_id=str(t.id),
            decision="exclude" if value else "include",
            note=body.note,
            reviewer_id=actor.user_id,
        )
    )
    log(db, actor, "exclude" if value else "include", t, after={"note": body.note})
    db.commit()
    return t


def _apply(db, actor, pid, gl_account: str, body: MappingIn) -> M.ExpenseMapping:
    m = db.scalar(
        scoped(M.ExpenseMapping, actor).where(
            M.ExpenseMapping.property_id == pid, M.ExpenseMapping.gl_account == gl_account
        )
    )
    if m is None:
        m = M.ExpenseMapping(organization_id=actor.org_id, property_id=pid, gl_account=gl_account, version=0)
        db.add(m)
        db.flush()
        before = None
    else:
        before = snapshot(m, MAP_FIELDS)
    m.category_code = body.category_code
    m.status = body.status
    m.explanation = body.explanation
    m.source_ref = body.source_ref
    m.reviewer_id = actor.user_id
    m.reviewed_at = datetime.now(UTC)
    m.version = (m.version or 0) + 1
    db.add(
        M.ReviewDecision(
            organization_id=actor.org_id,
            property_id=pid,
            target_type="expense_mapping",
            target_id=gl_account,
            decision=body.status,
            note=f"{body.category_code or '-'}: {body.explanation}",
            reviewer_id=actor.user_id,
        )
    )
    log(db, actor, "review", m, before, snapshot(m, MAP_FIELDS))
    return m


def _validate(db, actor, pid, body: MappingIn):
    if body.status == "recoverable" and not body.category_code:
        raise HTTPException(422, "A recoverable mapping needs a category.")
    if body.status != "needs_review" and not body.explanation:
        raise HTTPException(422, "Explain the decision. Recoverability is never inferred.")
    if body.category_code and not db.scalar(
        scoped(M.ExpenseCategory, actor).where(
            M.ExpenseCategory.property_id == pid, M.ExpenseCategory.code == body.category_code
        )
    ):
        raise HTTPException(422, f"Unknown category {body.category_code}.")


@router.put("/properties/{pid}/mappings/{gl_account}", response_model=GLAccountOut)
def set_mapping(
    pid: uuid.UUID,
    gl_account: str,
    body: MappingIn,
    actor: Actor = Depends(current_actor),
    db: Session = Depends(get_session),
):
    get_owned(db, M.Property, pid, actor)
    _validate(db, actor, pid, body)
    _apply(db, actor, pid, gl_account, body)
    db.commit()
    return _accounts(db, actor, pid, only=[gl_account])[0]  # F-15: one account, not all


@router.post("/properties/{pid}/mappings/bulk", response_model=list[GLAccountOut])
def bulk_mapping(
    pid: uuid.UUID, body: BulkMappingIn, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)
):
    """One reviewed decision applied to several accounts. Each account gets its own audit record."""
    get_owned(db, M.Property, pid, actor)
    _validate(db, actor, pid, body)
    accounts = sorted(set(body.gl_accounts))
    for a in accounts:
        _apply(db, actor, pid, a, body)
    db.commit()
    return _accounts(db, actor, pid, only=accounts)


@router.get("/properties/{pid}/mappings/{gl_account}/history")
def mapping_history(
    pid: uuid.UUID, gl_account: str, actor: Actor = Depends(current_actor), db: Session = Depends(get_session)
):
    get_owned(db, M.Property, pid, actor)
    users = {u.id: u.name for u in db.scalars(scoped(M.User, actor))}
    rows = db.scalars(
        scoped(M.ReviewDecision, actor)
        .where(
            M.ReviewDecision.property_id == pid,
            M.ReviewDecision.target_type == "expense_mapping",
            M.ReviewDecision.target_id == gl_account,
        )
        .order_by(M.ReviewDecision.created_at.desc())
    ).all()
    return [
        {"decision": r.decision, "note": r.note, "reviewer": users.get(r.reviewer_id), "at": r.created_at.isoformat()}
        for r in rows
    ]
