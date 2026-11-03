"""Session auth: argon2 password hashes and a signed httpOnly cookie.

Basic by design. See SECURITY.md for what remains before real customer data.
"""

import uuid
from dataclasses import dataclass

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, HTTPException, Request, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy.orm import Session

from .config import settings
from .db import get_session
from .models import User

COOKIE = "veyra_session"
_hasher = PasswordHasher()
_signer = URLSafeTimedSerializer(settings.secret_key, salt="veyra-session")


def hash_password(pw: str) -> str:
    return _hasher.hash(pw)


def verify_password(hash_: str, pw: str) -> bool:
    try:
        return _hasher.verify(hash_, pw)
    except VerifyMismatchError:
        return False


def make_session_token(user: User) -> str:
    """Token carries the user's session_version. Logout increments it, revoking all tokens (F-07)."""
    return _signer.dumps({"uid": str(user.id), "sv": user.session_version})


@dataclass(frozen=True)
class Actor:
    user_id: uuid.UUID
    org_id: uuid.UUID
    email: str
    name: str


def current_actor(request: Request, db: Session = Depends(get_session)) -> Actor:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    try:
        data = _signer.loads(token, max_age=settings.session_max_age_seconds)
        uid = uuid.UUID(data["uid"])
        sv = int(data["sv"])
    except (BadSignature, SignatureExpired, ValueError, KeyError, TypeError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired. Sign in again.") from None
    user = db.get(User, uid)
    if user is None or user.session_version != sv:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired. Sign in again.")
    return Actor(user.id, user.organization_id, user.email, user.name)
