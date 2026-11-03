"""Lease rules. Approved rules are locked. Editing requires returning to draft."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as M
from ..auth import Actor, current_actor
from ..db import get_session
from ..schemas import AllocationRuleOut, LeaseRuleIn, LeaseRuleOut, ReviewIn
from ..scoping import get_owned, log, scoped

router = APIRouter()


def _out(db, r: M.LeaseRule) -> LeaseRuleOut:
    pools = db.scalars(select(M.AllocationRule).where(M.AllocationRule.lease_rule_id == r.id)
                       .order_by(M.AllocationRule.pool)).all()
    out = LeaseRuleOut.model_validate(r)
    out.pools = [AllocationRuleOut.model_validate(p) for p in pools]
    return out


def _dump(db, r):
    return _out(db, r).model_dump(mode="json")


@router.get("/properties/{pid}/lease-rules", response_model=list[LeaseRuleOut])
def list_rules(pid: uuid.UUID, actor: Actor = Depends(current_actor),
               db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    rules = db.scalars(scoped(M.LeaseRule, actor).where(M.LeaseRule.property_id == pid)
                       .order_by(M.LeaseRule.ref)).all()
    return [_out(db, r) for r in rules]


def _apply(db, actor, r: M.LeaseRule, body: LeaseRuleIn):
    pools = [p.pool for p in body.pools]
    if len(pools) != len(set(pools)):
        raise HTTPException(422, "Each pool may appear once per lease rule.")
    for k in ("ref", "admin_fee_pct", "admin_fee_pools", "admin_fee_order", "unsupported_terms",
              "source_ref", "notes"):
        setattr(r, k, getattr(body, k))
    for old in db.scalars(select(M.AllocationRule).where(M.AllocationRule.lease_rule_id == r.id)):
        db.delete(old)
    db.flush()
    for p in body.pools:
        db.add(M.AllocationRule(organization_id=actor.org_id, lease_rule_id=r.id, **p.model_dump()))


@router.post("/properties/{pid}/lease-rules", response_model=LeaseRuleOut, status_code=201)
def create_rule(pid: uuid.UUID, body: LeaseRuleIn, actor: Actor = Depends(current_actor),
                db: Session = Depends(get_session)):
    get_owned(db, M.Property, pid, actor)
    if db.scalar(scoped(M.LeaseRule, actor).where(M.LeaseRule.property_id == pid,
                                                   M.LeaseRule.ref == body.ref)):
        raise HTTPException(409, f"Lease rule {body.ref} already exists.")
    r = M.LeaseRule(organization_id=actor.org_id, property_id=pid, ref=body.ref, status="draft")
    db.add(r)
    db.flush()
    _apply(db, actor, r, body)
    db.flush()
    log(db, actor, "create", r, after=_dump(db, r))
    db.commit()
    return _out(db, r)


@router.put("/lease-rules/{rid}", response_model=LeaseRuleOut)
def update_rule(rid: uuid.UUID, body: LeaseRuleIn, actor: Actor = Depends(current_actor),
                db: Session = Depends(get_session)):
    r = get_owned(db, M.LeaseRule, rid, actor)
    if r.status == "approved":
        raise HTTPException(409, "Approved rules are locked. Return it to draft first.")
    before = _dump(db, r)
    _apply(db, actor, r, body)
    db.flush()
    log(db, actor, "update", r, before, _dump(db, r))
    db.commit()
    return _out(db, r)


@router.post("/lease-rules/{rid}/approve", response_model=LeaseRuleOut)
def approve_rule(rid: uuid.UUID, body: ReviewIn, actor: Actor = Depends(current_actor),
                 db: Session = Depends(get_session)):
    r = get_owned(db, M.LeaseRule, rid, actor)
    if not db.scalar(select(M.AllocationRule).where(M.AllocationRule.lease_rule_id == r.id)):
        raise HTTPException(422, "A lease rule needs at least one pool before approval.")
    r.status = "approved"
    r.approved_by = actor.user_id
    r.approved_at = datetime.now(timezone.utc)
    db.add(M.ReviewDecision(organization_id=actor.org_id, property_id=r.property_id,
                            target_type="lease_rule", target_id=str(r.id), decision="approve",
                            note=body.note, reviewer_id=actor.user_id))
    log(db, actor, "approve", r, after={"note": body.note})
    db.commit()
    return _out(db, r)


@router.post("/lease-rules/{rid}/unapprove", response_model=LeaseRuleOut)
def unapprove_rule(rid: uuid.UUID, body: ReviewIn, actor: Actor = Depends(current_actor),
                   db: Session = Depends(get_session)):
    r = get_owned(db, M.LeaseRule, rid, actor)
    r.status = "draft"
    r.approved_by = None
    r.approved_at = None
    db.add(M.ReviewDecision(organization_id=actor.org_id, property_id=r.property_id,
                            target_type="lease_rule", target_id=str(r.id), decision="return_to_draft",
                            note=body.note, reviewer_id=actor.user_id))
    log(db, actor, "unapprove", r, after={"note": body.note})
    db.commit()
    return _out(db, r)
