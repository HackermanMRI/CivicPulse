"""Access JWTs, OTP tickets and rotating refresh tokens (spec §8, P12, U1).

- Access token: JWT HS256, 15 minutes, issuer and audience checked, algorithm pinned (never "none").
- Refresh token: random 384-bit value, only its SHA-256 is stored, rotated on every use.
  Re-use of an already-rotated token revokes the whole family.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import timedelta

import jwt
from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.config import settings
from app.core.params import get_params
from app.core.timeutil import now_utc
from app.models import RefreshToken, User

ALGORITHM = "HS256"


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def create_access_token(user: User) -> str:
    now = now_utc()
    payload = {
        "sub": str(user.id), "role": user.role, "typ": "access",
        "iat": int(now.timestamp()), "exp": int((now + timedelta(minutes=get_params().sessions.access_minutes)).timestamp()),
        "iss": settings.JWT_ISSUER, "aud": settings.JWT_AUDIENCE,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str, typ: str) -> dict:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM], issuer=settings.JWT_ISSUER,
                             audience=settings.JWT_AUDIENCE, options={"require": ["exp", "iat", "sub", "typ"]})
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Not signed in")
    if payload.get("typ") != typ:
        raise HTTPException(status_code=401, detail="Not signed in")
    return payload


def create_otp_ticket(phone: str, purpose: str) -> str:
    """Short-lived proof that the phone passed OTP; used by register and password reset."""
    now = now_utc()
    payload = {"sub": phone, "purpose": purpose, "typ": "otp_ticket", "iat": int(now.timestamp()),
               "exp": int((now + timedelta(minutes=15)).timestamp()), "iss": settings.JWT_ISSUER,
               "aud": settings.JWT_AUDIENCE, "jti": secrets.token_hex(8)}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def read_otp_ticket(ticket: str, purpose: str) -> str:
    payload = decode_token(ticket, "otp_ticket")
    if payload.get("purpose") != purpose:
        raise HTTPException(status_code=400, detail="This verification is for a different step. Start again.")
    return payload["sub"]


def _refresh_days(user: User) -> int:
    s = get_params().sessions
    return s.admin_refresh_days if user.role == "admin" else s.refresh_days


def issue_refresh(db: Session, user: User, family_id: uuid.UUID | None = None) -> tuple[str, RefreshToken]:
    raw = secrets.token_urlsafe(48)
    row = RefreshToken(user_id=user.id, family_id=family_id or uuid.uuid4(), token_hash=sha256(raw),
                       expires_at=now_utc() + timedelta(days=_refresh_days(user)))
    db.add(row)
    db.flush()
    return raw, row


def rotate_refresh(db: Session, raw: str) -> tuple[User, str]:
    """Return the user and a new refresh token, or raise 401. Reuse revokes the whole family."""
    row = db.query(RefreshToken).filter_by(token_hash=sha256(raw)).with_for_update().first()
    if row is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    now = now_utc()
    if row.revoked_at is not None:
        db.execute(update(RefreshToken).where(RefreshToken.family_id == row.family_id, RefreshToken.revoked_at.is_(None))
                   .values(revoked_at=now))
        from app.core.audit import audit
        audit(db, actor_id=row.user_id, action="auth.refresh_reuse", entity="user", entity_id=row.user_id,
              reason="A rotated refresh token was used again; all sessions in the family revoked")
        db.commit()
        raise HTTPException(status_code=401, detail="Not signed in")
    if row.expires_at <= now:
        raise HTTPException(status_code=401, detail="Session expired")
    user = db.get(User, row.user_id)
    if user is None or user.state in ("suspended", "deleted"):
        raise HTTPException(status_code=401, detail="Not signed in")
    new_raw, new_row = issue_refresh(db, user, row.family_id)
    row.revoked_at = now
    row.replaced_by = new_row.id
    return user, new_raw


def revoke_family_of(db: Session, raw: str | None) -> None:
    if not raw:
        return
    row = db.query(RefreshToken).filter_by(token_hash=sha256(raw)).first()
    if row:
        db.execute(update(RefreshToken).where(RefreshToken.family_id == row.family_id, RefreshToken.revoked_at.is_(None))
                   .values(revoked_at=now_utc()))


def revoke_all_for_user(db: Session, user_id: uuid.UUID) -> None:
    db.execute(update(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
               .values(revoked_at=now_utc()))
