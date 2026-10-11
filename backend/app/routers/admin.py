"""Minimal admin portal (V4, W2–W8). Admin actions never change credibility or reputation directly (C7);
every action is written to the audit log in the same transaction (spec §8). Raw 0–1 values are shown (C1)."""
from __future__ import annotations

import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.deps import client_ip, get_db, require_admin
from app.core.timeutil import dhaka_day_bounds, now_utc
from app.core.tokens import revoke_all_for_user
from app.models import (
    AbuseReport, AuditLog, CollusionAlert, Device, Evidence, Report, ReputationEvent, ScoringRun, User, Vote,
)
from app.services.reputation import reputation_of
from app.services.views import components_view, report_cards, report_detail
from app.worker.queue import enqueue

router = APIRouter(prefix="/api/admin", tags=["Admin"])


class Reason(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=5, max_length=1000)


class Solve(BaseModel):
    model_config = ConfigDict(extra="forbid")
    outcome: Literal["collusion_confirmed", "false_alarm"]
    note: str = Field(min_length=5, max_length=2000)


def _user_brief(db: Session, u: User | None) -> dict | None:
    if u is None:
        return None
    rep = reputation_of(db, u.id)
    return {"id": str(u.id), "display_name": u.display_name, "phone": u.phone, "role": u.role, "state": u.state,
            "is_seed": u.is_seed, "created_at": u.created_at.isoformat(), "rep": rep.rep, "rep_uncertainty": rep.uncertainty,
            "alpha": rep.alpha, "beta": rep.beta,
            "devices": db.query(func.count(Device.id)).filter(Device.user_id == u.id).scalar()}


@router.get("/overview")
def overview(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return {
        "open_alerts": db.query(func.count(CollusionAlert.id)).filter_by(status="open").scalar(),
        "flagged_reports": db.query(func.count(Report.id)).filter(Report.visibility == "visible",
                                                                  Report.flags.overlap(["requires_more_verification",
                                                                                        "category_mismatch", "price_outlier"])).scalar(),
        "hidden_reports": db.query(func.count(Report.id)).filter(Report.visibility != "visible").scalar(),
        "open_abuse": db.query(func.count(AbuseReport.id)).filter_by(state="open").scalar(),
        "users": db.query(func.count(User.id)).filter(User.role == "citizen", User.state != "deleted").scalar(),
        "suspended": db.query(func.count(User.id)).filter_by(state="suspended").scalar(),
        "pending_reports": db.query(func.count(Report.id)).filter_by(status="pending").scalar(),
    }


# ---------------- collusion alerts (W4) ----------------

def _alert(a: CollusionAlert) -> dict:
    return {"id": str(a.id), "kind": a.kind, "status": a.status, "outcome": a.outcome, "note": a.note,
            "signals": a.signals, "user_ids": [str(u) for u in a.user_ids], "report_ids": [str(r) for r in a.report_ids],
            "created_at": a.created_at.isoformat(), "solved_at": a.solved_at.isoformat() if a.solved_at else None}


@router.get("/alerts")
def list_alerts(status: Literal["open", "solved"] = "open", admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.query(CollusionAlert).filter_by(status=status).order_by(CollusionAlert.created_at.desc()).limit(200).all()
    return [_alert(a) for a in rows]


@router.get("/alerts/{alert_id}")
def get_alert(alert_id: uuid.UUID, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    a = db.get(CollusionAlert, alert_id)
    if a is None:
        raise HTTPException(status_code=404, detail="Not found")
    users = [_user_brief(db, db.get(User, u)) for u in a.user_ids]
    votes = db.query(Vote).filter(Vote.voter_id.in_(a.user_ids), Vote.report_id.in_(a.report_ids or [uuid.uuid4()])) \
        .order_by(Vote.report_id, Vote.created_at).all()
    return {**_alert(a), "users": users,
            "votes": [{"report_id": str(v.report_id), "voter_id": str(v.voter_id), "decision": v.decision,
                       "mode_claimed": v.mode_claimed, "mode_verified": v.mode_verified, "distance_m": v.distance_m,
                       "created_at": v.created_at.isoformat(), "replaced": v.replaced_at is not None} for v in votes]}


@router.post("/alerts/{alert_id}/solve")
def solve_alert(alert_id: uuid.UUID, body: Solve, request: Request, admin: User = Depends(require_admin),
                db: Session = Depends(get_db)):
    a = db.get(CollusionAlert, alert_id, with_for_update=True)
    if a is None:
        raise HTTPException(status_code=404, detail="Not found")
    if a.status == "solved":
        raise HTTPException(status_code=409, detail="Already solved")
    a.status, a.outcome, a.note, a.solved_by, a.solved_at = "solved", body.outcome, body.note.strip(), admin.id, now_utc()
    audit(db, actor_id=admin.id, action="alert.solve", entity="collusion_alert", entity_id=a.id,
          before={"status": "open"}, after={"status": "solved", "outcome": body.outcome}, reason=body.note, ip=client_ip(request))
    db.commit()
    return _alert(a)


# ---------------- report review (W2) ----------------

@router.get("/reports")
def list_reports(filter: Literal["flagged", "hidden", "abuse", "pending", "all"] = "flagged",
                 limit: int = Query(100, ge=1, le=300), admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    q = db.query(Report)
    if filter == "flagged":
        q = q.filter(Report.visibility == "visible", Report.flags.overlap(["requires_more_verification", "category_mismatch",
                                                                           "price_outlier", "duplicate"]))
    elif filter == "hidden":
        q = q.filter(Report.visibility != "visible")
    elif filter == "abuse":
        q = q.filter(Report.id.in_(db.query(AbuseReport.report_id).filter_by(state="open")))
    elif filter == "pending":
        q = q.filter(Report.status == "pending")
    rows = q.order_by(Report.submitted_at.desc()).limit(limit).all()
    cards = report_cards(db, admin, rows)
    abuse = dict(db.query(AbuseReport.report_id, func.count(AbuseReport.id)).filter(
        AbuseReport.state == "open", AbuseReport.report_id.in_([r.id for r in rows])).group_by(AbuseReport.report_id).all()) if rows else {}
    for card, r in zip(cards, rows):
        card["open_abuse"] = abuse.get(r.id, 0)
        card["visibility_reason"] = r.visibility_reason
    return cards


@router.get("/reports/{report_id}")
def admin_report(report_id: uuid.UUID, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    r = db.get(Report, report_id)
    if r is None:
        raise HTTPException(status_code=404, detail="Not found")
    out = report_detail(db, admin, r)
    out["visibility_reason"] = r.visibility_reason
    out["judging_status"] = r.judging_status
    out["components_judging"] = components_view(db, r.id, "judging")
    out["reporter"] = _user_brief(db, db.get(User, r.user_id)) if r.user_id else None
    out["runs"] = [{"id": s.id, "run_at": s.run_at.isoformat(), "trigger": s.trigger, "status": s.status,
                    "judging_status": s.judging_status, "credibility": s.credibility, "uncertainty": s.uncertainty,
                    "conflict": s.conflict, "alpha": s.alpha, "beta": s.beta, "gates": s.gates, "flags": s.flags,
                    "config_hash": s.config_hash[:12], "scoring_version": s.scoring_version}
                   for s in db.query(ScoringRun).filter_by(report_id=r.id).order_by(ScoringRun.id.desc()).limit(20)]
    out["votes"] = [{"id": str(v.id), "voter_id": str(v.voter_id) if v.voter_id else None, "decision": v.decision,
                     "mode_claimed": v.mode_claimed, "mode_verified": v.mode_verified, "distance_m": v.distance_m,
                     "in_ward": v.in_ward, "weight_at_vote": v.weight_at_vote, "created_at": v.created_at.isoformat(),
                     "replaced": v.replaced_at is not None}
                    for v in db.query(Vote).filter_by(report_id=r.id).order_by(Vote.created_at)]
    out["abuse_reports"] = [{"id": str(a.id), "reason": a.reason, "state": a.state, "created_at": a.created_at.isoformat()}
                            for a in db.query(AbuseReport).filter_by(report_id=r.id).order_by(AbuseReport.created_at)]
    out["evidence"] = [{"id": str(e.id), "kind": e.kind, "sha256": e.sha256[:16], "width": e.width, "height": e.height}
                       for e in db.query(Evidence).filter_by(report_id=r.id)]
    return out


@router.post("/reports/{report_id}/hide")
def hide(report_id: uuid.UUID, body: Reason, request: Request, admin: User = Depends(require_admin),
         db: Session = Depends(get_db)):
    r = db.get(Report, report_id, with_for_update=True)
    if r is None:
        raise HTTPException(status_code=404, detail="Not found")
    if r.visibility == "admin_hidden":
        raise HTTPException(status_code=409, detail="Already hidden")
    before = {"visibility": r.visibility}
    r.visibility, r.visibility_reason, r.visibility_changed_at = "admin_hidden", body.reason.strip(), now_utc()
    audit(db, actor_id=admin.id, action="report.hide", entity="report", entity_id=r.id, before=before,
          after={"visibility": "admin_hidden"}, reason=body.reason, ip=client_ip(request))
    db.commit()
    return {"ok": True, "visibility": r.visibility}


@router.post("/reports/{report_id}/restore")
def restore(report_id: uuid.UUID, body: Reason, request: Request, admin: User = Depends(require_admin),
            db: Session = Depends(get_db)):
    r = db.get(Report, report_id, with_for_update=True)
    if r is None:
        raise HTTPException(status_code=404, detail="Not found")
    if r.visibility == "visible":
        raise HTTPException(status_code=409, detail="Already visible")
    before = {"visibility": r.visibility, "reason": r.visibility_reason}
    r.visibility, r.visibility_reason, r.visibility_changed_at = "visible", None, now_utc()
    audit(db, actor_id=admin.id, action="report.restore", entity="report", entity_id=r.id, before=before,
          after={"visibility": "visible"}, reason=body.reason, ip=client_ip(request))
    db.commit()
    if r.status != "pending":
        enqueue("rescore_report", str(r.id), "admin_restore")     # restored reports re-enter their event and cell
    return {"ok": True, "visibility": r.visibility}


@router.post("/abuse/{abuse_id}/review")
def review_abuse(abuse_id: uuid.UUID, body: Reason, request: Request, admin: User = Depends(require_admin),
                 db: Session = Depends(get_db)):
    a = db.get(AbuseReport, abuse_id)
    if a is None:
        raise HTTPException(status_code=404, detail="Not found")
    a.state = "reviewed"
    audit(db, actor_id=admin.id, action="abuse.review", entity="abuse_report", entity_id=a.id,
          after={"state": "reviewed"}, reason=body.reason, ip=client_ip(request))
    db.commit()
    return {"ok": True}


# ---------------- accounts (W3) ----------------

@router.get("/users")
def list_users(q: str | None = Query(None, max_length=80), state: str | None = Query(None, max_length=20),
               admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    query = db.query(User).filter(User.state != "deleted")
    if q:
        like = f"%{q.replace('%', '').replace('_', '')}%"
        query = query.filter((User.display_name.ilike(like)) | (User.phone.ilike(like)))
    if state:
        query = query.filter(User.state == state)
    return [_user_brief(db, u) for u in query.order_by(User.created_at.desc()).limit(200).all()]


@router.get("/users/{user_id}")
def get_user(user_id: uuid.UUID, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(status_code=404, detail="Not found")
    reports = db.query(Report).filter_by(user_id=u.id).order_by(Report.submitted_at.desc()).limit(50).all()
    return {**_user_brief(db, u),
            "reports": report_cards(db, admin, reports),
            "votes": [{"report_id": str(v.report_id), "decision": v.decision, "mode_verified": v.mode_verified,
                       "created_at": v.created_at.isoformat()}
                      for v in db.query(Vote).filter_by(voter_id=u.id).order_by(Vote.created_at.desc()).limit(100)],
            "reputation_events": [{"kind": e.kind, "d_alpha": e.d_alpha, "d_beta": e.d_beta, "report_id": str(e.report_id),
                                   "occurred_at": e.occurred_at.isoformat(), "superseded": e.superseded_at is not None}
                                  for e in db.query(ReputationEvent).filter_by(user_id=u.id)
                                  .order_by(ReputationEvent.occurred_at.desc()).limit(100)],
            "moderation": [{"action": a.action, "reason": a.reason, "created_at": a.created_at.isoformat()}
                           for a in db.query(AuditLog).filter_by(entity="user", entity_id=str(u.id))
                           .order_by(AuditLog.created_at.desc()).limit(50)]}


def _set_state(db: Session, admin: User, user_id: uuid.UUID, new: str, reason: str, ip: str | None) -> User:
    u = db.get(User, user_id, with_for_update=True)
    if u is None or u.state == "deleted":
        raise HTTPException(status_code=404, detail="Not found")
    if u.id == admin.id:
        raise HTTPException(status_code=403, detail="You cannot change your own account state.")
    if u.role == "admin":
        raise HTTPException(status_code=403, detail="Admin accounts are managed on the server.")
    before = {"state": u.state}
    u.state = new
    u.suspended_at = now_utc() if new == "suspended" else None
    if new == "suspended":
        revoke_all_for_user(db, u.id)          # suspension blocks login and new actions (W3)
    audit(db, actor_id=admin.id, action=f"user.{'suspend' if new == 'suspended' else 'reinstate'}", entity="user",
          entity_id=u.id, before=before, after={"state": new}, reason=reason, ip=ip)
    db.commit()
    return u


@router.post("/users/{user_id}/suspend")
def suspend(user_id: uuid.UUID, body: Reason, request: Request, admin: User = Depends(require_admin),
            db: Session = Depends(get_db)):
    return _user_brief(db, _set_state(db, admin, user_id, "suspended", body.reason, client_ip(request)))


@router.post("/users/{user_id}/reinstate")
def reinstate(user_id: uuid.UUID, body: Reason, request: Request, admin: User = Depends(require_admin),
              db: Session = Depends(get_db)):
    return _user_brief(db, _set_state(db, admin, user_id, "active", body.reason, client_ip(request)))


# ---------------- audit log (W8 step 5) ----------------

@router.get("/audit")
def audit_log(actor: uuid.UUID | None = None, entity: str | None = Query(None, max_length=40),
              action: str | None = Query(None, max_length=60), start: date | None = Query(None, alias="from"),
              end: date | None = Query(None, alias="to"), limit: int = Query(200, ge=1, le=1000),
              admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    q = db.query(AuditLog)
    if actor:
        q = q.filter(AuditLog.actor_id == actor)
    if entity:
        q = q.filter(AuditLog.entity == entity)
    if action:
        q = q.filter(AuditLog.action == action)
    if start:
        q = q.filter(AuditLog.created_at >= dhaka_day_bounds(start)[0])
    if end:
        q = q.filter(AuditLog.created_at < dhaka_day_bounds(end)[1])
    rows = q.order_by(AuditLog.created_at.desc()).limit(limit).all()
    return [{"id": a.id, "actor_id": str(a.actor_id) if a.actor_id else None, "action": a.action, "entity": a.entity,
             "entity_id": a.entity_id, "before": a.before, "after": a.after, "reason": a.reason,
             "created_at": a.created_at.isoformat()} for a in rows]
