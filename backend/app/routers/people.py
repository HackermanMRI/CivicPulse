"""Public profiles (UI v2). A person's profile opens only for someone who has already voted on one of that person's
reports (or for the person themself and admins). So a profile can never shape a vote: blind voting (T4, D1) stays
intact. Everyone else gets 404, the same answer as for an unknown id, so ids can't be probed (no IDOR oracle).

Never public: phone, consents, and the email unless the person switched "show email" on. Areas (home/work wards)
are shown, by the user's decision of 26 Nov 2026.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.deps import current_user, get_db
from app.models import Report, User, Vote
from app.routers.users import _addresses, profile_stats, public_fields
from app.scoring.reputation import to_display
from app.services import photos
from app.services.reputation import reputation_of
from app.services.views import report_cards

router = APIRouter(prefix="/api/people", tags=["People"])
NOT_FOUND = HTTPException(status_code=404, detail="Not found")


def can_view(db: Session, viewer: User, target_id: uuid.UUID) -> bool:
    if viewer.id == target_id or viewer.role == "admin":
        return True
    voted = (db.query(Vote.id).join(Report, Report.id == Vote.report_id)
             .filter(Vote.voter_id == viewer.id, Vote.replaced_at.is_(None), Report.user_id == target_id).first())
    return voted is not None


def _target(db: Session, viewer: User, user_id: uuid.UUID) -> User:
    target = db.get(User, user_id)
    if target is None or target.state == "deleted" or target.role != "citizen" or not can_view(db, viewer, user_id):
        raise NOT_FOUND
    return target


@router.get("/{user_id}")
def profile(user_id: uuid.UUID, viewer: User = Depends(current_user), db: Session = Depends(get_db)):
    t = _target(db, viewer, user_id)
    rep = reputation_of(db, t.id)
    return {
        "id": str(t.id), "display_name": t.display_name, "is_seed": t.is_seed, "member_since": t.created_at.isoformat(),
        "is_me": t.id == viewer.id, **public_fields(t),
        "email": t.email if (t.email_public or t.id == viewer.id) else None,
        "reputation": {"display": to_display(rep.rep), "uncertainty_display": to_display(rep.uncertainty)},
        "stats": profile_stats(db, t.id),
        "areas": [{"kind": a["kind"], "ward_name_en": a["ward_name_en"], "ward_name_bn": a["ward_name_bn"]} for a in _addresses(db, t)],
    }


@router.get("/{user_id}/avatar")
def avatar(user_id: uuid.UUID, viewer: User = Depends(current_user), db: Session = Depends(get_db),
           v: int | None = Query(default=None)):     # `v` only busts caches
    t = _target(db, viewer, user_id)
    if not t.avatar_path:
        raise NOT_FOUND
    return FileResponse(photos.abs_path(t.avatar_path), media_type="image/jpeg",
                        headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"})


@router.get("/{user_id}/reports")
def reports(user_id: uuid.UUID, viewer: User = Depends(current_user), db: Session = Depends(get_db),
            limit: int = Query(20, ge=1, le=50)):
    """Their visible civic reports. Each card still follows the blind rule for this viewer."""
    t = _target(db, viewer, user_id)
    rows = (db.query(Report).filter(Report.user_id == t.id, Report.report_type == "civic", Report.visibility == "visible")
            .order_by(Report.submitted_at.desc()).limit(limit).all())
    return report_cards(db, viewer, rows)
