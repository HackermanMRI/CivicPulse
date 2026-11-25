"""Profile, addresses (wards), consents, reputation, price watch list and account deletion."""
from __future__ import annotations

import re
import uuid
from datetime import timedelta
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import ratelimit
from app.core.audit import audit
from app.core.deps import client_ip, current_user, get_db
from app.core.params import get_params
from app.core.timeutil import now_utc
from app.services import photos
from app.core.tokens import revoke_all_for_user
from app.models import Commodity, Consent, PriceWatch, Report, ReputationEvent, SavedPost, User, UserAddress, Vote, Ward
from app.scoring.reputation import to_display
from app.services.reputation import reputation_of

router = APIRouter(prefix="/api/me", tags=["Me"])


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2066-\u2069]")   # incl. bidi overrides


def _blank_to_none(v):
    return None if isinstance(v, str) and not v.strip() else v


def _one_line(v: str | None) -> str | None:
    if v is None:
        return None
    if CONTROL.search(v) or "\n" in v:
        raise ValueError("Use plain text on one line.")
    return re.sub(r"\s+", " ", v).strip()


class ProfilePatch(Strict):
    """Everything is optional; only the fields sent are changed. Text is stored as plain text (React escapes it)."""
    display_name: str | None = Field(default=None, min_length=2, max_length=80)
    preferred_module: Literal["green_guard", "price_patrol"] | None = None
    email: str | None = Field(default=None, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    email_public: bool | None = None
    bio: str | None = Field(default=None, max_length=160)
    occupation: str | None = Field(default=None, max_length=60)
    website: str | None = Field(default=None, max_length=200)
    interests: list[str] | None = Field(default=None, max_length=20)

    _blank = field_validator("email", "bio", "occupation", "website", mode="before")(_blank_to_none)

    @field_validator("display_name", "occupation")
    @classmethod
    def _line(cls, v):
        v = _one_line(v)
        if v is not None and len(v) < 2:
            raise ValueError("Use at least 2 characters.")
        return v

    @field_validator("bio")
    @classmethod
    def _bio(cls, v):
        if v is None:
            return None
        v = v.replace("\r\n", "\n").replace("\r", "\n")
        if CONTROL.search(v):
            raise ValueError("Use plain text.")
        v = re.sub(r"\n{3,}", "\n\n", v).strip()
        if v.count("\n") > 3:
            raise ValueError("Use at most 4 lines.")
        return v

    @field_validator("website")
    @classmethod
    def _site(cls, v):
        """Only http(s) links with a real host: blocks javascript:, data: and other schemes (stored XSS)."""
        if v is None:
            return None
        v = v.strip()
        if not re.match(r"^https?://", v, re.I):
            v = "https://" + v
        parts = urlsplit(v)
        if parts.scheme.lower() not in ("http", "https") or not parts.hostname or "." not in parts.hostname \
                or re.search(r"[\s<>\"'`\\]", v) or parts.username or parts.password:
            raise ValueError("Enter a web address like https://example.com.")
        return v


class AddressIn(Strict):
    kind: Literal["home", "work", "other"]
    ward_id: int | None = None


class ConsentIn(Strict):
    purpose: Literal["location", "camera", "research_use"]
    granted: bool


def masked_phone(phone: str | None) -> str | None:
    """+8801712345678 → "+880 1XXX-XXX-X78" (the profile board's format)."""
    if not phone:
        return None
    if phone.startswith("+880") and len(phone) == 14:
        return f"+880 {phone[4]}XXX-XXX-X{phone[-2:]}"
    return phone[:4] + "XXX-X" + phone[-2:]


def _addresses(db: Session, user: User) -> list[dict]:
    rows = (db.query(UserAddress, Ward).outerjoin(Ward, Ward.id == UserAddress.ward_id)
            .filter(UserAddress.user_id == user.id).order_by(UserAddress.created_at).all())
    return [{"id": str(a.id), "kind": a.kind, "ward_id": a.ward_id,
             "ward_name_en": w.name_en if w else "Outside the pilot area", "ward_name_bn": w.name_bn if w else None}
            for a, w in rows]


def allowed_interests() -> set[str]:
    return {c.code for c in get_params().categories} | {"prices"}


def avatar_url(user: User) -> str | None:
    """API path (never a file path). `v` changes with every new photo, so caches never show an old one."""
    if not user.avatar_path or user.state == "deleted":
        return None
    v = int(user.avatar_updated_at.timestamp()) if user.avatar_updated_at else 0
    return f"/api/people/{user.id}/avatar?v={v}"


def profile_stats(db: Session, user_id) -> dict:
    """Counts shown on the profile. All are the person's own activity; none reveals another report's result."""
    by_type = dict(db.query(Report.report_type, func.count(Report.id)).filter(Report.user_id == user_id)
                   .group_by(Report.report_type).all())
    credible = db.query(func.count(Report.id)).filter(Report.user_id == user_id, Report.report_type == "civic",
                                                     Report.status.in_(("supported", "strongly_supported"))).scalar()
    live = (Vote.voter_id == user_id, Vote.replaced_at.is_(None))
    votes = db.query(func.count(Vote.id)).filter(*live).scalar()
    on_spot = db.query(func.count(Vote.id)).filter(*live, Vote.mode_verified == "on_spot").scalar()
    return {"reports": sum(by_type.values()), "civic_reports": by_type.get("civic", 0), "price_reports": by_type.get("price", 0),
            "credible_reports": credible, "votes": votes, "on_spot_votes": on_spot}


def public_fields(user: User) -> dict:
    return {"bio": user.bio, "occupation": user.occupation, "website": user.website,
            "interests": list(user.interests or []), "avatar_url": avatar_url(user)}


@router.get("")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rep = reputation_of(db, user.id)
    stats = profile_stats(db, user.id)
    consents = {}
    for c in db.query(Consent).filter_by(user_id=user.id).order_by(Consent.created_at).all():
        consents[c.purpose] = {"granted": c.granted, "version": c.version, "at": c.created_at.isoformat()}
    return {
        "id": str(user.id), "display_name": user.display_name, "phone_masked": masked_phone(user.phone),
        "email": user.email, "role": user.role, "preferred_module": user.preferred_module, "is_seed": user.is_seed,
        "member_since": user.created_at.isoformat(),
        "reputation": {"display": to_display(rep.rep), "uncertainty_display": to_display(rep.uncertainty),
                       "rep": rep.rep, "uncertainty": rep.uncertainty, "alpha": rep.alpha, "beta": rep.beta},
        "stats": {**stats,
                  "pinned": db.query(func.count()).select_from(SavedPost).filter(SavedPost.user_id == user.id).scalar()},
        "addresses": _addresses(db, user), "consents": consents,
        **public_fields(user), "email_public": user.email_public,
        "name_change_available_at": _next_rename(user).isoformat() if _next_rename(user) else None,
    }


def _next_rename(user: User):
    """When the name may change again, or None if it may change now."""
    days = get_params().profile.name_change_days
    if not user.name_changed_at or days == 0:
        return None
    nxt = user.name_changed_at + timedelta(days=days)
    return nxt if nxt > now_utc() else None


@router.patch("")
def update_me(body: ProfilePatch, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ratelimit.enforce(f"profile:{user.id}", 30, 3600, "Too many profile changes. Try again later.")
    changes = body.model_dump(exclude_unset=True)
    if "interests" in changes:
        picked = list(dict.fromkeys(changes["interests"] or []))          # de-duplicate, keep order
        if any(code not in allowed_interests() for code in picked):
            raise HTTPException(status_code=422, detail="Choose interests from the list.")
        if len(picked) > get_params().profile.max_interests:
            raise HTTPException(status_code=422, detail=f"Choose at most {get_params().profile.max_interests} interests.")
        changes["interests"] = picked
    new_name = changes.get("display_name")
    if new_name is not None and new_name != user.display_name:
        nxt = _next_rename(user)
        if nxt:
            raise HTTPException(status_code=429, detail=f"You can change your name again on {nxt:%d %b %Y}.")
        audit(db, actor_id=user.id, action="user.rename", entity="user", entity_id=user.id,
              before={"display_name": user.display_name}, after={"display_name": new_name}, ip=client_ip(request))
        user.name_changed_at = now_utc()
    elif "display_name" in changes and new_name is None:
        changes.pop("display_name")                                     # a name can be changed, never removed
    for k, v in changes.items():
        setattr(user, k, v)
    db.commit()
    return {"ok": True}


@router.put("/avatar")
def set_avatar(request: Request, photo: UploadFile = File(...), user: User = Depends(current_user),
               db: Session = Depends(get_db)):
    """Profile photo (gallery allowed; never evidence). Re-encoded, square, EXIF/GPS removed."""
    ratelimit.enforce(f"avatar:{user.id}", 10, 3600, "Too many photo changes. Try again later.")
    data = photo.file.read(get_params().profile.avatar_max_bytes + 1)
    if not data:
        raise HTTPException(status_code=422, detail="The photo is empty.")
    jpeg = photos.process_avatar(data)
    old = user.avatar_path
    user.avatar_path = photos.store_avatar(jpeg)
    user.avatar_updated_at = now_utc()
    audit(db, actor_id=user.id, action="user.avatar", entity="user", entity_id=user.id, after={"set": True}, ip=client_ip(request))
    db.commit()
    photos.remove_file(old)
    return {"avatar_url": avatar_url(user)}


@router.delete("/avatar")
def delete_avatar(user: User = Depends(current_user), db: Session = Depends(get_db)):
    old = user.avatar_path
    user.avatar_path = None
    user.avatar_updated_at = now_utc()
    db.commit()
    photos.remove_file(old)
    return {"avatar_url": None}


@router.delete("", status_code=204)
def delete_me(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Anonymise (Q31): reports stay and show "reporter unavailable"."""
    before = {"state": user.state}
    user.display_name = None
    user.phone = None
    user.email = None
    user.pass_hash = None
    old_avatar = user.avatar_path
    user.bio = user.occupation = user.website = user.avatar_path = None
    user.interests = []
    user.email_public = False
    user.state = "deleted"
    user.deleted_at = now_utc()
    db.query(UserAddress).filter_by(user_id=user.id).delete()
    revoke_all_for_user(db, user.id)
    audit(db, actor_id=user.id, action="user.delete", entity="user", entity_id=user.id, before=before,
          after={"state": "deleted"}, ip=client_ip(request))
    db.commit()
    photos.remove_file(old_avatar)
    return Response(status_code=204)


@router.get("/addresses")
def list_addresses(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _addresses(db, user)


@router.post("/addresses", status_code=201)
def add_address(body: AddressIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.ward_id is not None and db.get(Ward, body.ward_id) is None:
        raise HTTPException(status_code=422, detail="Choose a ward from the pilot list.")
    if db.query(UserAddress).filter_by(user_id=user.id, ward_id=body.ward_id, kind=body.kind).first():
        raise HTTPException(status_code=409, detail="You already added this area.")
    db.add(UserAddress(user_id=user.id, ward_id=body.ward_id, kind=body.kind))
    db.commit()
    return _addresses(db, user)


@router.delete("/addresses/{address_id}")
def delete_address(address_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(UserAddress).filter_by(id=address_id, user_id=user.id).first()   # owner check (no IDOR)
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    if db.query(UserAddress).filter_by(user_id=user.id).count() <= 1:
        raise HTTPException(status_code=422, detail="Keep at least one area.")
    db.delete(row)
    db.commit()
    return _addresses(db, user)


@router.post("/consents")
def update_consent(body: ConsentIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.add(Consent(user_id=user.id, purpose=body.purpose, granted=body.granted, version="1.0"))
    audit(db, actor_id=user.id, action="consent.update", entity="user", entity_id=user.id,
          after={body.purpose: body.granted}, ip=client_ip(request))
    db.commit()
    return {"ok": True}


@router.get("/reputation")
def my_reputation(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rep = reputation_of(db, user.id)
    events = (db.query(ReputationEvent).filter(ReputationEvent.user_id == user.id, ReputationEvent.superseded_at.is_(None))
              .order_by(ReputationEvent.occurred_at.desc()).limit(50).all())
    return {"display": to_display(rep.rep), "uncertainty_display": to_display(rep.uncertainty),
            "events": [{"kind": e.kind, "d_alpha": e.d_alpha, "d_beta": e.d_beta, "report_id": str(e.report_id),
                        "occurred_at": e.occurred_at.isoformat()} for e in events]}


@router.get("/price-watch")
def list_watch(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(PriceWatch.commodity_id).filter_by(user_id=user.id).all()
    return [r[0] for r in rows]


@router.put("/price-watch/{commodity_id}")
def watch(commodity_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if db.get(Commodity, commodity_id) is None:
        raise HTTPException(status_code=404, detail="Not found")
    if db.get(PriceWatch, (user.id, commodity_id)) is None:
        db.add(PriceWatch(user_id=user.id, commodity_id=commodity_id))
        db.commit()
    return {"ok": True}


@router.delete("/price-watch/{commodity_id}")
def unwatch(commodity_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.get(PriceWatch, (user.id, commodity_id))
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}
