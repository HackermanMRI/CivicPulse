"""Report submission, detail, own reports, photos and abuse reports (W2, W6, spec §8 uploads, A1)."""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import ratelimit
from app.core.audit import audit
from app.core.deps import client_ip, current_user, device_hash, get_db, require_citizen, require_device
from app.core.params import get_params
from app.core.timeutil import DHAKA, dhaka_date, dhaka_day_bounds, now_utc
from app.models import AbuseReport, Category, Commodity, Evidence, Market, PriceDetail, Report, User, Vote, VerifiedPrice
from app.routers.capture import check_token
from app.services import photos
from app.services.views import report_cards, report_detail
from app.worker.queue import enqueue

router = APIRouter(prefix="/api", tags=["Reports"])


def _coords(lat: float | None, lon: float | None, acc: float | None, required: bool) -> str | None:
    if lat is None or lon is None:
        if required:
            raise HTTPException(status_code=422, detail="Location is required. Turn on GPS and try again.")
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(status_code=422, detail="Invalid location")
    if acc is not None and not (0 <= acc <= 100_000):
        raise HTTPException(status_code=422, detail="Invalid GPS accuracy")
    return f"SRID=4326;POINT({lon} {lat})"


def _evidence(db: Session, stored: photos.StoredPhoto, kind: str, token_id: uuid.UUID | None,
              report_id: uuid.UUID | None = None, vote_id: uuid.UUID | None = None) -> Evidence:
    ev = Evidence(report_id=report_id, vote_id=vote_id, kind=kind, file_path=stored.relpath, mime="image/jpeg",
                  width=stored.width, height=stored.height, bytes=stored.size, sha256=stored.sha256,
                  phash=stored.phash, token_id=token_id)
    db.add(ev)
    return ev


# ---------------- civic ----------------

@router.post("/reports/civic", status_code=201)
def submit_civic(
    category: str = Form(max_length=40), description: str = Form(min_length=3, max_length=2000),
    lat: float = Form(), lon: float = Form(), accuracy: float = Form(ge=0),
    capture_token: uuid.UUID = Form(), photo: UploadFile = File(),
    user: User = Depends(require_citizen), db: Session = Depends(get_db), dev_hash: str | None = Depends(device_hash),
):
    params = get_params()
    device = require_device(db, user, dev_hash)
    if len(description) > params.limits.description_max_chars:
        raise HTTPException(status_code=422, detail=f"Description is longer than {params.limits.description_max_chars} characters")
    cat = db.query(Category).filter_by(code=category, active=True).first()
    if cat is None:
        raise HTTPException(status_code=422, detail="Choose a category from the list")
    start, end = dhaka_day_bounds(dhaka_date())
    today = db.query(func.count(Report.id)).filter(Report.user_id == user.id, Report.report_type == "civic",
                                                   Report.submitted_at >= start, Report.submitted_at < end).scalar()
    if today >= params.limits.civic_per_day:
        raise HTTPException(status_code=429, detail="You can post one civic report per day. Try again tomorrow.")
    tok = check_token(db, capture_token, user, "report")
    point = _coords(lat, lon, accuracy, required=True)
    stored = photos.intake(photo)               # magic bytes, size, pixels, re-encode, hashes
    now = now_utc()
    tok.used_at = now
    report = Report(user_id=user.id, report_type="civic", category_id=cat.id, description=description.strip(),
                    location=point, gps_accuracy_m=accuracy, capture_token_id=tok.id, device_id=device.id,
                    submitted_at=now, is_seed=user.is_seed)          # anything a DEMO account posts is DEMO data
    db.add(report)
    db.flush()
    _evidence(db, stored, "report_photo", tok.id, report_id=report.id)
    db.commit()
    enqueue("process_report", str(report.id))
    db.refresh(report)
    return {"id": str(report.id), "status": report.status}


# ---------------- price ----------------

@router.post("/reports/price", status_code=201)
def submit_price(
    commodity_id: int = Form(), market_id: int = Form(), price_bdt: str = Form(max_length=12),
    observed_at: datetime = Form(), lat: float | None = Form(None), lon: float | None = Form(None),
    accuracy: float | None = Form(None, ge=0), capture_token: uuid.UUID | None = Form(None),
    photo: UploadFile | None = File(None), receipt: UploadFile | None = File(None),
    user: User = Depends(require_citizen), db: Session = Depends(get_db), dev_hash: str | None = Depends(device_hash),
):
    params = get_params()
    device = require_device(db, user, dev_hash)
    try:
        price = Decimal(price_bdt)
    except InvalidOperation:
        raise HTTPException(status_code=422, detail="Enter the price as a number")
    if not price.is_finite() or price <= 0 or price > Decimal("1000000"):
        raise HTTPException(status_code=422, detail="Price must be more than 0")
    if price != price.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP):
        raise HTTPException(status_code=422, detail="Use at most two decimals")
    com = db.get(Commodity, commodity_id)
    mkt = db.get(Market, market_id)
    if com is None or not com.active or mkt is None:
        raise HTTPException(status_code=422, detail="Choose a product and market from the list")
    if mkt.is_demo != user.is_seed or (com.is_demo and not user.is_seed):
        # DEMO accounts report only at DEMO markets, real accounts only at real ones, so a price cell never mixes both.
        raise HTTPException(status_code=403, detail="DEMO markets are for DEMO accounts only." if mkt.is_demo
                            else "DEMO accounts can report only at DEMO markets.")
    if observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=DHAKA)        # the form sends local Dhaka time
    now = now_utc()
    seen_day = dhaka_date(observed_at)
    if observed_at > now or (dhaka_date(now) - seen_day).days > params.prices.max_days_back:
        raise HTTPException(status_code=422, detail="Date seen must be today or up to 7 days back, never in the future")
    dup = db.query(Report.id).join(PriceDetail, PriceDetail.report_id == Report.id).filter(
        Report.user_id == user.id, PriceDetail.commodity_id == com.id, PriceDetail.market_id == mkt.id,
        PriceDetail.observed_date == seen_day).count()
    if dup >= params.limits.price_per_cell_per_day:
        raise HTTPException(status_code=429, detail="You already reported this product at this market for that day.")
    point = _coords(lat, lon, accuracy, required=False)
    tok = None
    stored_photo = stored_receipt = None
    if photo is not None or receipt is not None:
        tok = check_token(db, capture_token, user, "price_photo")
        stored_photo = photos.intake(photo) if photo is not None else None
        stored_receipt = photos.intake(receipt) if receipt is not None else None
        tok.used_at = now
    report = Report(user_id=user.id, report_type="price", location=point, gps_accuracy_m=accuracy if point else None,
                    capture_token_id=tok.id if tok else None, device_id=device.id, submitted_at=now,
                    is_seed=user.is_seed)
    db.add(report)
    db.flush()
    db.add(PriceDetail(report_id=report.id, commodity_id=com.id, market_id=mkt.id, price_bdt=price, unit_qty=1,
                       observed_at=observed_at, observed_date=seen_day))
    if stored_photo:
        _evidence(db, stored_photo, "product_photo", tok.id, report_id=report.id)
    if stored_receipt:
        _evidence(db, stored_receipt, "receipt", tok.id, report_id=report.id)   # stored only, never scored (T9)
    db.commit()
    enqueue("process_report", str(report.id))
    return {"id": str(report.id), "status": "pending"}


# ---------------- read ----------------

def visible_report(db: Session, report_id: uuid.UUID, user: User) -> Report:
    """Hidden reports exist only for their reporter and admins; everyone else gets 404 (no existence leak)."""
    r = db.get(Report, report_id)
    if r is None or (r.visibility != "visible" and r.user_id != user.id and user.role != "admin"):
        raise HTTPException(status_code=404, detail="Not found")
    return r


@router.get("/reports/{report_id}")
def get_report(report_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return report_detail(db, user, visible_report(db, report_id, user))


@router.get("/me/reports")
def my_reports(type: Literal["civic", "price"] = "civic", limit: int = Query(50, ge=1, le=100),
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = (db.query(Report).filter(Report.user_id == user.id, Report.report_type == type)
            .order_by(Report.submitted_at.desc()).limit(limit).all())
    cards = report_cards(db, user, rows)
    if type == "price" and rows:
        details = {d.report_id: d for d in db.query(PriceDetail).filter(PriceDetail.report_id.in_([r.id for r in rows]))}
        coms = {c.id: c for c in db.query(Commodity).all()}
        mkts = {m.id: m for m in db.query(Market).all()}
        for card, r in zip(cards, rows):
            d = details[r.id]
            vp = db.query(VerifiedPrice).filter_by(commodity_id=d.commodity_id, market_id=d.market_id,
                                                   date=d.observed_date).first()
            card["price"] = {
                "commodity": {"id": d.commodity_id, "name_en": coms[d.commodity_id].name_en,
                              "variant": coms[d.commodity_id].variant, "unit": coms[d.commodity_id].unit},
                "market": {"id": d.market_id, "name_en": mkts[d.market_id].name_en},
                "price_bdt": float(d.price_bdt), "observed_date": d.observed_date.isoformat(),
                "counts_toward_verified": bool(vp and vp.status == "Verified" and r.id in (vp.report_ids or [])),
                "verified_price": float(vp.verified_price) if vp and vp.verified_price is not None else None,
            }
    return cards


@router.get("/photos/{evidence_id}")
def get_photo(evidence_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Photos are never served by nginx; this route checks the viewer may see them (spec §8)."""
    ev = db.get(Evidence, evidence_id)
    if ev is None:
        raise HTTPException(status_code=404, detail="Not found")
    if ev.vote_id is not None:
        vote = db.get(Vote, ev.vote_id)
        report = visible_report(db, vote.report_id, user)
        voted = db.query(Vote.id).filter(Vote.report_id == report.id, Vote.voter_id == user.id,
                                         Vote.replaced_at.is_(None)).first()
        if not (user.role == "admin" or report.user_id == user.id or voted):
            raise HTTPException(status_code=404, detail="Not found")     # comments only after voting (T4)
    else:
        report = visible_report(db, ev.report_id, user)
        if ev.kind == "receipt" and report.user_id != user.id and user.role != "admin":
            raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(photos.abs_path(ev.file_path), media_type="image/jpeg",
                        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"})


class AbuseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=5, max_length=500)


@router.post("/reports/{report_id}/abuse", status_code=201)
def report_abuse(report_id: uuid.UUID, body: AbuseIn, request: Request, user: User = Depends(current_user),
                 db: Session = Depends(get_db)):
    """A1: goes to the admin queue only; it never changes scores."""
    ratelimit.enforce(f"abuse:{user.id}", 5, 3600, "Too many abuse reports. Try again later.")
    report = visible_report(db, report_id, user)
    if db.query(AbuseReport.id).filter_by(report_id=report.id, reporter_id=user.id, state="open").first():
        return {"ok": True}
    db.add(AbuseReport(report_id=report.id, reporter_id=user.id, reason=body.reason.strip()))
    audit(db, actor_id=user.id, action="report.abuse", entity="report", entity_id=report.id, ip=client_ip(request))
    db.commit()
    return {"ok": True}
