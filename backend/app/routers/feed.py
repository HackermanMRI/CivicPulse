"""Ward feed and saved posts (W3, T3, T6, V10). The feed shows GreenGuard reports only."""
from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.core.deps import current_user, get_db
from app.models import Category, Report, SavedPost, User, UserAddress, Vote
from app.routers.reports import visible_report
from app.services.views import report_cards

router = APIRouter(prefix="/api", tags=["Feed"])


def _encode(r: Report) -> str:
    raw = json.dumps({"t": r.submitted_at.isoformat(), "id": str(r.id)}).encode()
    return base64.urlsafe_b64encode(raw).decode()


def _decode(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor.encode()))
        return datetime.fromisoformat(data["t"]), uuid.UUID(data["id"])
    except (ValueError, KeyError, TypeError):
        raise HTTPException(status_code=422, detail="Bad cursor")


@router.get("/feed")
def feed(ward_id: int | None = None, category: str | None = Query(None, max_length=40),
         voted: bool | None = None, cursor: str | None = None, limit: int = Query(20, ge=1, le=50),
         user: User = Depends(current_user), db: Session = Depends(get_db)):
    my_wards = [w for w, in db.query(UserAddress.ward_id).filter(UserAddress.user_id == user.id,
                                                                 UserAddress.ward_id.isnot(None)).distinct().all()]
    if ward_id is not None:
        if ward_id not in my_wards:
            raise HTTPException(status_code=403, detail="Add this area to your profile to see its feed.")
        my_wards = [ward_id]
    if not my_wards:
        return {"items": [], "next_cursor": None, "wards": []}
    q = db.query(Report).filter(Report.report_type == "civic", Report.visibility == "visible", Report.ward_id.in_(my_wards))
    if category:
        cat = db.query(Category.id).filter_by(code=category).first()
        if cat is None:
            raise HTTPException(status_code=422, detail="Unknown category")
        q = q.filter(Report.category_id == cat[0])
    if voted is not None:
        mine = db.query(Vote.report_id).filter(Vote.voter_id == user.id, Vote.replaced_at.is_(None))
        if voted:
            q = q.filter(Report.id.in_(mine))
        else:                       # "To verify": not voted yet and not my own report
            q = q.filter(~Report.id.in_(mine), or_(Report.user_id.is_(None), Report.user_id != user.id))
    if cursor:
        t, rid = _decode(cursor)
        q = q.filter(or_(Report.submitted_at < t, and_(Report.submitted_at == t, Report.id < rid)))
    rows = q.order_by(Report.submitted_at.desc(), Report.id.desc()).limit(limit + 1).all()
    more = len(rows) > limit
    rows = rows[:limit]
    return {"items": report_cards(db, user, rows), "next_cursor": _encode(rows[-1]) if more else None,
            "wards": my_wards}


@router.put("/reports/{report_id}/saved")
def save(report_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    report = visible_report(db, report_id, user)
    if db.get(SavedPost, (user.id, report.id)) is None:
        db.add(SavedPost(user_id=user.id, report_id=report.id))
        db.commit()
    return {"saved": True}


@router.delete("/reports/{report_id}/saved")
def unsave(report_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.get(SavedPost, (user.id, report_id))
    if row:
        db.delete(row)
        db.commit()
    return {"saved": False}


@router.get("/me/saved")
def my_saved(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = (db.query(Report).join(SavedPost, SavedPost.report_id == Report.id)
            .filter(SavedPost.user_id == user.id, Report.visibility == "visible")
            .order_by(SavedPost.created_at.desc()).limit(100).all())
    return report_cards(db, user, rows)
