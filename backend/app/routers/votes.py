"""Voting (W4, V2, V3, V6, V7, V9, N11, P11).

The client claims a vote type; the server proves what it can and moves the vote DOWN to the proven type:
  on_spot   GPS within 100 m + a fresh verification photo (token issued after the report was posted)
  same_ward GPS inside the report's ward (polygon, else the ward's fallback radius)
  far_away  nothing to prove
Raw vote GPS is used only for this check; only the distance and the in-ward result are stored (C15).
"""
from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from geoalchemy2 import Geometry
from sqlalchemy import cast, func, update
from sqlalchemy.orm import Session

from app.core import ratelimit
from app.core.audit import audit
from app.core.deps import device_hash, get_db, require_citizen, require_device
from app.core.params import get_params
from app.core.timeutil import now_utc
from app.models import Report, ReputationEvent, User, Vote, Ward
from app.routers.capture import check_token
from app.routers.reports import _evidence, visible_report
from app.scoring.components import vote_weight, Vote as EngineVote
from app.services import photos
from app.services.pipeline import _reuse_hit
from app.services.reputation import reputation_of
from app.services.views import report_detail
from app.worker.queue import enqueue

router = APIRouter(prefix="/api", tags=["Votes"])
RANK = {"far_away": 0, "same_ward": 1, "on_spot": 2}


def _in_ward(db: Session, ward_id: int | None, point: str) -> bool:
    """Point in the ward polygon, or within the fallback radius when the ward has no polygon (R34)."""
    if ward_id is None:
        return False
    geog = func.ST_GeogFromText(point)
    row = db.query(Ward.geom.isnot(None),
                   func.ST_Covers(Ward.geom, cast(geog, Geometry)),
                   func.ST_DWithin(Ward.ref_point, geog, Ward.fallback_radius_m)).filter(Ward.id == ward_id).one()
    has_polygon, covers, near = row
    return bool(covers) if has_polygon else bool(near)


@router.post("/reports/{report_id}/votes", status_code=201)
def vote(
    report_id: uuid.UUID,
    decision: Literal["confirm", "disagree", "fixed_now"] = Form(),
    mode: Literal["on_spot", "same_ward", "far_away"] = Form(),
    lat: float | None = Form(None), lon: float | None = Form(None), accuracy: float | None = Form(None, ge=0),
    capture_token: uuid.UUID | None = Form(None), photo: UploadFile | None = File(None),
    user: User = Depends(require_citizen), db: Session = Depends(get_db), dev_hash: str | None = Depends(device_hash),
):
    params = get_params()
    report = visible_report(db, report_id, user)
    if report.report_type != "civic":
        raise HTTPException(status_code=422, detail="Price reports have no votes")
    if report.visibility != "visible":
        raise HTTPException(status_code=404, detail="Not found")
    if user.is_seed and not report.is_seed:
        raise HTTPException(status_code=403, detail="DEMO accounts can vote only on DEMO reports.")
    if report.user_id == user.id:                                                   # C9, V8
        raise HTTPException(status_code=403, detail="You cannot vote on your own report.")
    ratelimit.enforce(f"vote:{user.id}", params.votes.burst_per_minute, 60, "Too many votes. Wait a minute.")  # P11
    device = require_device(db, user, dev_hash)                                     # C11
    if decision == "fixed_now" and mode != "on_spot":
        raise HTTPException(status_code=422, detail="\"Fixed now\" needs an on-the-spot vote with a photo.")

    old = db.query(Vote).filter(Vote.report_id == report.id, Vote.voter_id == user.id, Vote.replaced_at.is_(None)) \
        .with_for_update().first()
    if old is not None and (mode != "on_spot" or old.mode_verified == "on_spot"):   # V7: upgrade to on-the-spot only
        raise HTTPException(status_code=409, detail="You already voted. You can only upgrade to an on-the-spot vote.")

    # --- verify the claimed type (V2) ---
    point = None
    distance = in_ward = None
    if lat is not None and lon is not None:
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise HTTPException(status_code=422, detail="Invalid location")
        point = f"SRID=4326;POINT({lon} {lat})"
        distance = float(db.query(func.ST_Distance(Report.location, func.ST_GeogFromText(point)))
                         .filter(Report.id == report.id).scalar())
        in_ward = _in_ward(db, report.ward_id, point)
    proven = "far_away"
    if point is not None and in_ward:
        proven = "same_ward"
    notes = []
    stored = tok = None
    if mode == "on_spot":
        if photo is None:
            raise HTTPException(status_code=422, detail="An on-the-spot vote needs a photo. Open the camera.")
        tok = check_token(db, capture_token, user, "verification", report.id)
        stored = photos.intake(photo)
        tok.used_at = now_utc()
        if point is None or distance is None or distance > params.votes.on_spot_radius_m:
            notes.append("not within 100 m of the report")
        elif tok.captured_at <= report.submitted_at:
            notes.append("photo taken before the report was posted")
        else:
            proven = "on_spot"
    verified = min(mode, proven, key=lambda m: RANK[m])
    if decision == "fixed_now" and verified != "on_spot":
        raise HTTPException(status_code=422, detail="\"Fixed now\" needs an on-the-spot check: " + ", ".join(notes or ["GPS missing"]))
    if old is not None and verified != "on_spot":
        raise HTTPException(status_code=422, detail="Upgrade failed: " + ", ".join(notes or ["GPS missing"]) + ". Your earlier vote is kept.")

    rep = reputation_of(db, user.id)
    weight = vote_weight(EngineVote(str(user.id), str(device.id), verified, decision, rep.alpha, rep.beta),
                         params.votes.mode_weights)
    now = now_utc()
    if old is not None:
        old.replaced_at = now
        # The replaced vote's reputation result must not count twice (N2).
        db.execute(update(ReputationEvent).where(ReputationEvent.vote_id == old.id, ReputationEvent.superseded_at.is_(None))
                   .values(superseded_at=now))
        db.flush()
    v = Vote(report_id=report.id, voter_id=user.id, device_id=device.id, decision=decision, mode_claimed=mode,
             mode_verified=verified, distance_m=distance, gps_accuracy_m=accuracy if point else None, in_ward=in_ward,
             weight_at_vote=weight, created_at=now)
    db.add(v)
    db.flush()
    if stored is not None and verified == "on_spot":
        ev = _evidence(db, stored, "verification_photo", tok.id, vote_id=v.id)
        db.flush()
        hit = _reuse_hit(db, ev)
        if hit is not None:
            # A copied verification photo proves nothing. The vote drops to what GPS proves and the photo is
            # not shown as a comment. The *report* is not hidden: otherwise anyone could hide someone else's
            # report by re-uploading its photo as a "verification" (finding F-4).
            v.mode_verified = "same_ward" if in_ward else "far_away"
            if decision == "fixed_now":
                raise HTTPException(status_code=422, detail="This photo matches an earlier photo. Take a new one.")
            v.weight_at_vote = vote_weight(EngineVote(str(user.id), str(device.id), v.mode_verified, decision,
                                                      rep.alpha, rep.beta), params.votes.mode_weights)
            db.delete(ev)
            audit(db, actor_id=None, action="vote.photo_reuse", entity="vote", entity_id=v.id,
                  after={"matched_evidence": str(hit.id), "mode_verified": v.mode_verified},
                  reason="verification photo matched a stored photo (W1, V9)")
    db.commit()
    enqueue("rescore_report", str(report.id), "upgrade" if old is not None else "vote")
    db.refresh(report)
    out = report_detail(db, user, report)
    out["vote_result"] = {"mode_claimed": mode, "mode_verified": v.mode_verified, "notes": notes}
    return out
