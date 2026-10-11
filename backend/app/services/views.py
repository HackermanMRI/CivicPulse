"""Response shapes for reports, with the blind-voting rule enforced here on the server (T4, V8, X1).

- blind view   (not voted, not the reporter): photo, text, category, location, ward, time. Nothing else.
- result view  (voted, or the reporter, or an admin): + status, scores, flags, votes, comment photos.
Citizen screens get ×100 display numbers next to the raw 0–1 values (C1); the admin portal uses the raw ones.
"""
from __future__ import annotations

import uuid
from collections import Counter

from geoalchemy2 import Geometry
from sqlalchemy import cast, func
from sqlalchemy.orm import Session

from app.models import Category, Event, Evidence, PriceDetail, Report, SavedPost, ScoringRun, TrustScore, User, Vote, Ward
from app.scoring.reputation import to_display
from app.services.labels import FLAG_LABEL, status_label
from app.services.reputation import reputation_of

USER_FLAGS = ("duplicate", "category_mismatch", "requires_more_verification", "price_outlier", "suspicious")


def photo_url(evidence_id: uuid.UUID | None) -> str | None:
    return f"/api/photos/{evidence_id}" if evidence_id else None


def latlon_map(db: Session, report_ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[float, float]]:
    if not report_ids:
        return {}
    g = cast(Report.location, Geometry)
    rows = db.query(Report.id, func.ST_Y(g), func.ST_X(g)).filter(Report.id.in_(report_ids), Report.location.isnot(None))
    return {rid: (float(lat), float(lon)) for rid, lat, lon in rows.all()}


class ViewContext:
    """Loads everything a list of reports needs in a few queries (no N+1)."""

    def __init__(self, db: Session, viewer: User | None, reports: list[Report]):
        self.db, self.viewer = db, viewer
        ids = [r.id for r in reports]
        self.coords = latlon_map(db, ids)
        self.cats = {c.id: c for c in db.query(Category).all()}
        ward_ids = {r.ward_id for r in reports if r.ward_id}
        self.wards = {w.id: w for w in db.query(Ward).filter(Ward.id.in_(ward_ids)).all()} if ward_ids else {}
        self.photos: dict[uuid.UUID, uuid.UUID] = {}
        for ev_id, rid in db.query(Evidence.id, Evidence.report_id).filter(
                Evidence.report_id.in_(ids), Evidence.kind.in_(("report_photo", "product_photo"))).all() if ids else []:
            self.photos.setdefault(rid, ev_id)
        self.my_votes: dict[uuid.UUID, Vote] = {}
        self.saved: set[uuid.UUID] = set()
        if viewer is not None and ids:
            for v in db.query(Vote).filter(Vote.report_id.in_(ids), Vote.voter_id == viewer.id, Vote.replaced_at.is_(None)).all():
                self.my_votes[v.report_id] = v
            self.saved = {rid for rid, in db.query(SavedPost.report_id).filter(SavedPost.user_id == viewer.id,
                                                                              SavedPost.report_id.in_(ids)).all()}
        self.vote_counts: dict[uuid.UUID, Counter] = {}
        if ids:
            for rid, decision, mode, n in db.query(Vote.report_id, Vote.decision, Vote.mode_verified, func.count()).filter(
                    Vote.report_id.in_(ids), Vote.replaced_at.is_(None)).group_by(Vote.report_id, Vote.decision,
                                                                                    Vote.mode_verified).all():
                c = self.vote_counts.setdefault(rid, Counter())
                c[decision] += n
                c[f"{decision}:{mode}"] += n
                c["total"] += n
        event_ids = {r.event_id for r in reports if r.event_id}
        self.resolved = {e for e, in db.query(Event.id).filter(Event.id.in_(event_ids), Event.resolved_at.isnot(None)).all()} \
            if event_ids else set()
        user_ids = {r.user_id for r in reports if r.user_id}
        self.users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}

    def can_see_results(self, r: Report) -> bool:
        v = self.viewer
        if v is None:
            return False
        return v.role == "admin" or r.user_id == v.id or r.id in self.my_votes or r.report_type == "price"


def _category(cat: Category | None) -> dict | None:
    return None if cat is None else {"id": cat.id, "code": cat.code, "name_en": cat.name_en, "name_bn": cat.name_bn}


def _ward(w: Ward | None) -> dict | None:
    return None if w is None else {"id": w.id, "name_en": w.name_en, "name_bn": w.name_bn}


def flags_view(flags: list[str] | None) -> list[dict]:
    return [{"code": f, "label": FLAG_LABEL.get(f, f)} for f in (flags or []) if f in USER_FLAGS]


def scores_view(r: Report) -> dict:
    return {
        "status": r.status, "status_label": status_label(r.status),
        "credibility": r.credibility, "uncertainty": r.uncertainty, "conflict": r.conflict,
        "credibility_display": to_display(r.credibility), "uncertainty_display": to_display(r.uncertainty),
        "alpha": r.alpha, "beta": r.beta, "components_used": r.components_used, "flags": flags_view(r.flags),
    }


def votes_view(c: Counter | None) -> dict:
    c = c or Counter()
    return {"confirm": c["confirm"], "disagree": c["disagree"], "fixed_now": c["fixed_now"], "total": c["total"],
            "on_spot": sum(v for k, v in c.items() if k.endswith(":on_spot")),
            "same_ward": sum(v for k, v in c.items() if k.endswith(":same_ward")),
            "far_away": sum(v for k, v in c.items() if k.endswith(":far_away"))}


def report_card(ctx: ViewContext, r: Report) -> dict:
    lat_lon = ctx.coords.get(r.id)
    mine = ctx.viewer is not None and r.user_id == ctx.viewer.id
    my_vote = ctx.my_votes.get(r.id)
    out = {
        "id": str(r.id), "type": r.report_type, "category": _category(ctx.cats.get(r.category_id)),
        "description": r.description, "photo_url": photo_url(ctx.photos.get(r.id)),
        "location": {"lat": lat_lon[0], "lon": lat_lon[1]} if lat_lon else None,
        "gps_accuracy_m": r.gps_accuracy_m, "ward": _ward(ctx.wards.get(r.ward_id)),
        "submitted_at": r.submitted_at.isoformat(), "is_seed": r.is_seed, "is_mine": mine,
        "saved": r.id in ctx.saved, "visibility": r.visibility if (mine or (ctx.viewer and ctx.viewer.role == "admin")) else None,
        "my_vote": {"decision": my_vote.decision, "mode_claimed": my_vote.mode_claimed, "mode": my_vote.mode_verified,
                    "created_at": my_vote.created_at.isoformat()} if my_vote else None,
        "can_vote": (ctx.viewer is not None and ctx.viewer.role == "citizen" and not mine and r.report_type == "civic"
                     and r.visibility == "visible" and (my_vote is None or my_vote.mode_verified != "on_spot")),
        "results_visible": False, "results": None,
    }
    if ctx.can_see_results(r):
        reporter = ctx.users.get(r.user_id)
        rep = reputation_of(ctx.db, r.user_id) if reporter else None
        out["results_visible"] = True
        out["results"] = {
            **scores_view(r), "votes": votes_view(ctx.vote_counts.get(r.id)),
            "resolved": r.event_id in ctx.resolved,
            "reporter": {"display_name": reporter.display_name if reporter and reporter.state != "deleted" else None,
                         "reputation_display": to_display(rep.rep) if rep else None},
        }
    return out


def report_cards(db: Session, viewer: User | None, reports: list[Report]) -> list[dict]:
    ctx = ViewContext(db, viewer, reports)
    return [report_card(ctx, r) for r in reports]


def components_view(db: Session, report_id: uuid.UUID, view: str = "displayed") -> list[dict]:
    run = db.query(ScoringRun).filter_by(report_id=report_id).order_by(ScoringRun.id.desc()).first()
    if run is None:
        return []
    order = ("text", "image", "gps", "metadata", "reputation", "community", "history")
    rows = {t.component: t for t in db.query(TrustScore).filter_by(run_id=run.id, view=view).all()}
    return [{"component": k, "availability": rows[k].availability, "score": rows[k].score,
             "score_display": to_display(rows[k].score), "weight": rows[k].weight, "pos_ev": rows[k].pos_ev,
             "neg_ev": rows[k].neg_ev, "explanation": rows[k].explanation, "model_version": rows[k].model_version}
            for k in order if k in rows]


def comments_view(db: Session, report_id: uuid.UUID) -> list[dict]:
    """V9: a comment is an on-the-spot verification photo plus the vote choice, no text."""
    rows = (db.query(Vote, Evidence.id).join(Evidence, Evidence.vote_id == Vote.id)
            .filter(Vote.report_id == report_id, Vote.replaced_at.is_(None), Vote.mode_verified == "on_spot",
                    Evidence.kind == "verification_photo").order_by(Vote.created_at).all())
    return [{"decision": v.decision, "photo_url": photo_url(ev_id), "created_at": v.created_at.isoformat()} for v, ev_id in rows]


def report_detail(db: Session, viewer: User, r: Report) -> dict:
    ctx = ViewContext(db, viewer, [r])
    out = report_card(ctx, r)
    if r.report_type == "price":
        d = db.get(PriceDetail, r.id)
        from app.models import Commodity, Market
        com, mkt = db.get(Commodity, d.commodity_id), db.get(Market, d.market_id)
        out["price"] = {"commodity": {"id": com.id, "name_en": com.name_en, "name_bn": com.name_bn,
                                      "variant": com.variant, "unit": com.unit},
                        "market": {"id": mkt.id, "name_en": mkt.name_en, "name_bn": mkt.name_bn},
                        "price_bdt": float(d.price_bdt), "unit_qty": float(d.unit_qty),
                        "observed_at": d.observed_at.isoformat(), "observed_date": d.observed_date.isoformat()}
    if out["results_visible"]:
        out["results"]["components"] = components_view(db, r.id)
        out["results"]["comments"] = comments_view(db, r.id) if r.report_type == "civic" else []
    return out
