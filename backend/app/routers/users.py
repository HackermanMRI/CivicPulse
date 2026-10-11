"""Profile, addresses (wards), consents, reputation, price watch list and account deletion."""
from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.deps import client_ip, current_user, get_db
from app.core.timeutil import now_utc
from app.core.tokens import revoke_all_for_user
from app.models import Commodity, Consent, PriceWatch, Report, ReputationEvent, SavedPost, User, UserAddress, Vote, Ward
from app.scoring.reputation import to_display
from app.services.reputation import reputation_of

router = APIRouter(prefix="/api/me", tags=["Me"])


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProfilePatch(Strict):
    display_name: str | None = Field(default=None, min_length=2, max_length=80)
    preferred_module: Literal["green_guard", "price_patrol"] | None = None
    email: str | None = Field(default=None, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


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


@router.get("")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rep = reputation_of(db, user.id)
    reports = db.query(func.count(Report.id)).filter(Report.user_id == user.id).scalar()
    on_spot = db.query(func.count(Vote.id)).filter(Vote.voter_id == user.id, Vote.mode_verified == "on_spot",
                                                    Vote.replaced_at.is_(None)).scalar()
    consents = {}
    for c in db.query(Consent).filter_by(user_id=user.id).order_by(Consent.created_at).all():
        consents[c.purpose] = {"granted": c.granted, "version": c.version, "at": c.created_at.isoformat()}
    return {
        "id": str(user.id), "display_name": user.display_name, "phone_masked": masked_phone(user.phone),
        "email": user.email, "role": user.role, "preferred_module": user.preferred_module, "is_seed": user.is_seed,
        "member_since": user.created_at.isoformat(),
        "reputation": {"display": to_display(rep.rep), "uncertainty_display": to_display(rep.uncertainty),
                       "rep": rep.rep, "uncertainty": rep.uncertainty, "alpha": rep.alpha, "beta": rep.beta},
        "stats": {"reports": reports, "on_spot_votes": on_spot,
                  "pinned": db.query(func.count()).select_from(SavedPost).filter(SavedPost.user_id == user.id).scalar()},
        "addresses": _addresses(db, user), "consents": consents,
    }


@router.patch("")
def update_me(body: ProfilePatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(user, k, v.strip() if isinstance(v, str) else v)
    db.commit()
    return {"ok": True}


@router.delete("", status_code=204)
def delete_me(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Anonymise (Q31): reports stay and show "reporter unavailable"."""
    before = {"state": user.state}
    user.display_name = None
    user.phone = None
    user.email = None
    user.pass_hash = None
    user.state = "deleted"
    user.deleted_at = now_utc()
    db.query(UserAddress).filter_by(user_id=user.id).delete()
    revoke_all_for_user(db, user.id)
    audit(db, actor_id=user.id, action="user.delete", entity="user", entity_id=user.id, before=before,
          after={"state": "deleted"}, ip=client_ip(request))
    db.commit()
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
