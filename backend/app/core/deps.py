"""FastAPI dependencies: database session, current user, roles, client info."""
from __future__ import annotations

import hashlib
import uuid

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.tokens import decode_token
from app.database import get_db
from app.models import Device, User

__all__ = ["get_db", "current_user", "optional_user", "require_admin", "require_citizen", "client_ip", "device_hash"]


def _bearer(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


def _load_user(db: Session, token: str) -> User:
    payload = decode_token(token, "access")
    try:
        uid = uuid.UUID(payload["sub"])
    except ValueError:
        raise HTTPException(status_code=401, detail="Not signed in")
    user = db.get(User, uid)
    if user is None or user.state == "deleted":
        raise HTTPException(status_code=401, detail="Not signed in")
    if user.state == "suspended":
        raise HTTPException(status_code=403, detail="This account is suspended.")
    return user


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = _bearer(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    return _load_user(db, token)


def optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    token = _bearer(request)
    return _load_user(db, token) if token else None


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    return user


def require_citizen(user: User = Depends(current_user)) -> User:
    """Admin accounts cannot report or vote (W5)."""
    if user.role != "citizen":
        raise HTTPException(status_code=403, detail="Admin accounts cannot report or vote.")
    return user


def client_ip(request: Request) -> str | None:
    # nginx sets X-Real-IP; uvicorn --proxy-headers fills request.client from X-Forwarded-For.
    return request.headers.get("x-real-ip") or (request.client.host if request.client else None)


def device_hash(x_device_id: str | None = Header(default=None)) -> str | None:
    """The app sends its random device id; only its SHA-256 is ever stored (C11)."""
    if not x_device_id:
        return None
    if not 16 <= len(x_device_id) <= 128:
        raise HTTPException(status_code=400, detail="Invalid device id")
    return hashlib.sha256(x_device_id.encode()).hexdigest()


def require_device(db: Session, user: User, dev_hash: str | None) -> Device:
    """The device must already belong to this user (registered at sign-up or login)."""
    if not dev_hash:
        raise HTTPException(status_code=400, detail="Missing device id. Reload the app.")
    dev = db.query(Device).filter_by(device_hash=dev_hash).first()
    if dev is None or dev.user_id != user.id:
        raise HTTPException(status_code=403, detail="This device is not linked to your account. Log in again.")
    return dev
