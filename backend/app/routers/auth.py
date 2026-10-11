"""Sign-up with mock OTP, login, refresh rotation, logout and password reset (W1, Q32, P12, U1, C7, C11)."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.config import settings
from app.core import ratelimit
from app.core.audit import audit
from app.core.deps import client_ip, device_hash, get_db
from app.core.params import get_params
from app.core.timeutil import now_utc
from app.core.tokens import (
    create_access_token, create_otp_ticket, issue_refresh, read_otp_ticket, revoke_all_for_user, revoke_family_of,
    rotate_refresh,
)
from app.models import CollusionAlert, Consent, Device, OtpCode, User, UserAddress, Ward
from app.security.passwords import hash_password, needs_rehash, validate_password, verify_password
from app.security.phone import normalize_phone

router = APIRouter(prefix="/api/auth", tags=["Auth"])
REFRESH_COOKIE = "cp_refresh"
CONSENT_VERSION = "1.0"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PhoneIn(Strict):
    phone: str = Field(max_length=20)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)


class OtpRequest(PhoneIn):
    purpose: Literal["signup", "reset"]


class OtpVerify(PhoneIn):
    purpose: Literal["signup", "reset", "admin"]
    code: str = Field(pattern=r"^\d{4,10}$")


class Consents(Strict):
    location: bool
    camera: bool
    research_use: bool


class AddressIn(Strict):
    kind: Literal["home", "work", "other"]
    ward_id: int | None = None   # null = outside the pilot area


class RegisterIn(Strict):
    ticket: str = Field(max_length=2000)
    display_name: str = Field(min_length=2, max_length=80)
    password: str = Field(max_length=128)
    consents: Consents
    addresses: list[AddressIn] = Field(min_length=1, max_length=20)
    preferred_module: Literal["green_guard", "price_patrol"] | None = None


class LoginIn(PhoneIn):
    password: str = Field(max_length=128)


class AdminOtpIn(PhoneIn):
    code: str = Field(pattern=r"^\d{4,10}$")
    password: str = Field(max_length=128)


class ResetIn(Strict):
    ticket: str = Field(max_length=2000)
    new_password: str = Field(max_length=128)


def _code_hash(phone: str, code: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), f"{phone}:{code}".encode(), hashlib.sha256).hexdigest()


def _send_otp(db: Session, phone: str, purpose: str) -> dict:
    p = get_params().otp
    code = "".join(str(secrets.randbelow(10)) for _ in range(p.digits))
    db.query(OtpCode).filter(OtpCode.phone == phone, OtpCode.purpose == purpose, OtpCode.used_at.is_(None)) \
        .update({OtpCode.used_at: now_utc()})          # only the newest code stays valid
    db.add(OtpCode(phone=phone, purpose=purpose, code_hash=_code_hash(phone, code),
                   expires_at=now_utc() + timedelta(minutes=p.expiry_minutes)))
    db.commit()
    out = {"sent": True, "expires_in": p.expiry_minutes * 60}
    if settings.DEV_MODE:
        out["dev_code"] = code   # mock OTP for the defence (Q32); real SMS gateway is future work
    return out


def _check_otp(db: Session, phone: str, purpose: str, code: str) -> None:
    p = get_params().otp
    row = (db.query(OtpCode).filter(OtpCode.phone == phone, OtpCode.purpose == purpose, OtpCode.used_at.is_(None))
           .order_by(OtpCode.created_at.desc()).with_for_update().first())
    if row is None or row.expires_at <= now_utc():
        raise HTTPException(status_code=400, detail="This code has expired. Ask for a new one.")
    if row.attempts >= p.max_attempts:
        raise HTTPException(status_code=429, detail="Too many wrong tries. Ask for a new code.")
    row.attempts += 1
    if not hmac.compare_digest(row.code_hash, _code_hash(phone, code)):
        db.commit()
        left = p.max_attempts - row.attempts
        raise HTTPException(status_code=400, detail=f"That code is wrong. {left} tries left." if left else
                            "Too many wrong tries. Ask for a new code.")
    row.used_at = now_utc()
    db.commit()


def _set_refresh_cookie(response: Response, raw: str, days: int) -> None:
    response.set_cookie(REFRESH_COOKIE, raw, max_age=days * 86400, httponly=True, secure=settings.COOKIE_SECURE,
                        samesite="strict", path="/api/auth")


def _session_response(db: Session, response: Response, user: User) -> dict:
    raw, _ = issue_refresh(db, user)
    s = get_params().sessions
    _set_refresh_cookie(response, raw, s.admin_refresh_days if user.role == "admin" else s.refresh_days)
    return {"access_token": create_access_token(user), "token_type": "bearer",
            "user": {"id": str(user.id), "display_name": user.display_name, "role": user.role,
                     "preferred_module": user.preferred_module}}


def _device_violation(db: Session, device: Device, user_ids: list, ip: str | None, where: str) -> None:
    db.add(CollusionAlert(kind="device_violation", user_ids=user_ids, report_ids=[],
                          signals={"rule": "one account per device (C11)", "where": where}))
    audit(db, actor_id=None, action="auth.device_violation", entity="device", entity_id=device.id, ip=ip,
          after={"users": [str(u) for u in user_ids]})
    db.commit()


def _check_origin(request: Request) -> None:
    """CSRF guard for cookie-based endpoints: the Origin header must be our own site."""
    origin = request.headers.get("origin")
    allowed = {o.strip().rstrip("/") for o in settings.FRONTEND_ORIGIN.split(",") if o.strip()}
    if settings.DEV_MODE:
        allowed |= {"http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000", "http://127.0.0.1:8000"}
    if origin and origin.rstrip("/") not in allowed:
        raise HTTPException(status_code=403, detail="Request from another site was blocked")


@router.post("/otp/request")
def otp_request(body: OtpRequest, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    ratelimit.enforce(f"otp:phone:{body.phone}", 3, 600, "Too many codes requested. Try again in 10 minutes.")
    ratelimit.enforce(f"otp:ip:{ip}", 10, 600, "Too many codes requested. Try again in 10 minutes.")
    exists = db.query(User).filter_by(phone=body.phone).first()
    if body.purpose == "signup" and exists:
        raise HTTPException(status_code=409, detail="This number already has an account. Log in instead.")
    if body.purpose == "reset" and not exists:
        # Same answer as success, so the form doesn't reveal which numbers have accounts.
        return {"sent": True, "expires_in": get_params().otp.expiry_minutes * 60}
    return _send_otp(db, body.phone, body.purpose)


@router.post("/otp/verify")
def otp_verify(body: OtpVerify, request: Request, db: Session = Depends(get_db)):
    ratelimit.enforce(f"otpv:ip:{client_ip(request)}", 30, 600)
    if body.purpose == "admin":
        raise HTTPException(status_code=400, detail="Use the admin login step for admin codes.")
    _check_otp(db, body.phone, body.purpose, body.code)
    return {"ticket": create_otp_ticket(body.phone, body.purpose)}


@router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db),
             dev_hash: str | None = Depends(device_hash)):
    phone = read_otp_ticket(body.ticket, "signup")
    ip = client_ip(request)
    if not dev_hash:
        raise HTTPException(status_code=400, detail="Missing device id. Reload the app.")
    if not (body.consents.location and body.consents.camera and body.consents.research_use):
        raise HTTPException(status_code=422, detail="Tick all three permissions to continue.")   # C2
    problem = validate_password(body.password)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    if db.query(User).filter_by(phone=phone).first():
        raise HTTPException(status_code=409, detail="This number already has an account. Log in instead.")
    existing = db.query(Device).filter_by(device_hash=dev_hash).first()
    if existing:
        _device_violation(db, existing, [existing.user_id], ip, "sign-up")
        raise HTTPException(status_code=409, detail="This phone already has a CivicPulse account. One account per device.")
    ward_ids = {a.ward_id for a in body.addresses if a.ward_id is not None}
    if ward_ids and db.query(Ward).filter(Ward.id.in_(ward_ids)).count() != len(ward_ids):
        raise HTTPException(status_code=422, detail="Choose wards from the pilot list.")

    user = User(phone=phone, phone_verified=True, display_name=body.display_name.strip(),
                pass_hash=hash_password(body.password), role="citizen", preferred_module=body.preferred_module)
    db.add(user)
    db.flush()
    db.add(Device(user_id=user.id, device_hash=dev_hash, last_seen=now_utc()))
    for purpose in ("location", "camera", "research_use"):
        db.add(Consent(user_id=user.id, purpose=purpose, granted=True, version=CONSENT_VERSION))
    seen = set()
    for a in body.addresses:
        if (a.kind, a.ward_id) in seen:
            continue
        seen.add((a.kind, a.ward_id))
        db.add(UserAddress(user_id=user.id, ward_id=a.ward_id, kind=a.kind))
    audit(db, actor_id=user.id, action="auth.register", entity="user", entity_id=user.id, ip=ip)
    out = _session_response(db, response, user)
    db.commit()
    return out


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db),
          dev_hash: str | None = Depends(device_hash)):
    ip = client_ip(request)
    ratelimit.enforce(f"login:ip:{ip}", 20, 600, "Too many login attempts. Try again in 10 minutes.")
    ratelimit.enforce(f"login:phone:{body.phone}", 10, 600, "Too many login attempts. Try again in 10 minutes.")
    user = db.query(User).filter_by(phone=body.phone).first()
    ok = verify_password(body.password, user.pass_hash if user else None)
    if not ok or user is None or user.state == "deleted":
        audit(db, actor_id=user.id if user else None, action="auth.login_failed", entity="user",
              entity_id=user.id if user else None, ip=ip)
        db.commit()
        raise HTTPException(status_code=401, detail="Phone number or password is wrong.")
    if user.state == "suspended":
        raise HTTPException(status_code=403, detail="This account is suspended.")
    if user.role == "admin":
        # Admins need an OTP every time (W); the code is sent now and checked by /login/admin.
        return {"otp_required": True, **_send_otp(db, user.phone, "admin")}
    if not dev_hash:
        raise HTTPException(status_code=400, detail="Missing device id. Reload the app.")
    dev = db.query(Device).filter_by(device_hash=dev_hash).first()
    if dev and dev.user_id != user.id:
        _device_violation(db, dev, [dev.user_id, user.id], ip, "login")
        raise HTTPException(status_code=409, detail="This phone is linked to another CivicPulse account.")
    if dev is None:
        db.add(Device(user_id=user.id, device_hash=dev_hash, last_seen=now_utc()))
    else:
        dev.last_seen = now_utc()
    if needs_rehash(user.pass_hash):
        user.pass_hash = hash_password(body.password)
    audit(db, actor_id=user.id, action="auth.login", entity="user", entity_id=user.id, ip=ip)
    out = _session_response(db, response, user)
    db.commit()
    return out


@router.post("/login/admin")
def login_admin(body: AdminOtpIn, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = client_ip(request)
    ratelimit.enforce(f"login:ip:{ip}", 20, 600, "Too many login attempts. Try again in 10 minutes.")
    user = db.query(User).filter_by(phone=body.phone, role="admin").first()
    if user is None or not verify_password(body.password, user.pass_hash):
        raise HTTPException(status_code=401, detail="Phone number or password is wrong.")
    _check_otp(db, body.phone, "admin", body.code)
    audit(db, actor_id=user.id, action="auth.login_admin", entity="user", entity_id=user.id, ip=ip)
    out = _session_response(db, response, user)
    db.commit()
    return out


@router.post("/refresh")
def refresh(request: Request, response: Response, db: Session = Depends(get_db),
            cp_refresh: str | None = Cookie(default=None)):
    _check_origin(request)
    if not cp_refresh:
        raise HTTPException(status_code=401, detail="Not signed in")
    user, new_raw = rotate_refresh(db, cp_refresh)
    s = get_params().sessions
    _set_refresh_cookie(response, new_raw, s.admin_refresh_days if user.role == "admin" else s.refresh_days)
    token = create_access_token(user)
    db.commit()
    return {"access_token": token, "token_type": "bearer",
            "user": {"id": str(user.id), "display_name": user.display_name, "role": user.role,
                     "preferred_module": user.preferred_module}}


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db),
           cp_refresh: str | None = Cookie(default=None)):
    _check_origin(request)
    revoke_family_of(db, cp_refresh)
    db.commit()
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth")
    response.status_code = 204
    return response


@router.post("/password/reset")
def password_reset(body: ResetIn, request: Request, db: Session = Depends(get_db)):
    phone = read_otp_ticket(body.ticket, "reset")
    problem = validate_password(body.new_password)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    user = db.query(User).filter_by(phone=phone).first()
    if user is None or user.state == "deleted":
        raise HTTPException(status_code=400, detail="Start again.")
    user.pass_hash = hash_password(body.new_password)
    revoke_all_for_user(db, user.id)
    audit(db, actor_id=user.id, action="auth.password_reset", entity="user", entity_id=user.id, ip=client_ip(request))
    db.commit()
    return {"ok": True}
