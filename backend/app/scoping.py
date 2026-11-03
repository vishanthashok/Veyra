"""Organization-scoped data access. All reads of org-owned rows go through here."""

import uuid
from typing import TypeVar

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import Actor
from .models import AuditLog

T = TypeVar("T")


def scoped(model, actor: Actor):
    return select(model).where(model.organization_id == actor.org_id)


def get_owned(db: Session, model: type[T], id_: uuid.UUID, actor: Actor) -> T:
    obj = db.get(model, id_)
    if obj is None or obj.organization_id != actor.org_id:
        # Same response for missing and foreign rows, so IDs cannot be probed.
        raise HTTPException(404, f"{model.__name__} not found")
    return obj


def log(db: Session, actor: Actor, action: str, entity, before=None, after=None):
    db.add(AuditLog(organization_id=actor.org_id, actor_id=actor.user_id, action=action,
                    entity_type=type(entity).__tablename__, entity_id=str(entity.id),
                    before=before, after=after))


def snapshot(obj, fields) -> dict:
    out = {}
    for f in fields:
        v = getattr(obj, f)
        out[f] = v if isinstance(v, (str, int, bool, list, dict, type(None))) else str(v)
    return out
