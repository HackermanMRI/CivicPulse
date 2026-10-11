"""Insights for the dashboard: KPIs, map points, 2D/3D grid, hotspots and emerging-issue alerts (W7, X1, B4).

X1: a report's status and scores appear on the map only for people who voted on it and for its reporter.
Counts and grid totals are aggregates and are shown to everyone who is signed in.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2 import Geometry
from sqlalchemy import cast, func, text
from sqlalchemy.orm import Session

from app.core.deps import current_user, get_db
from app.core.params import get_params
from app.core.timeutil import dhaka_date, dhaka_day_bounds, now_utc
from app.models import Alert, Category, Event, Hotspot, Report, User, Vote, Ward
from app.services.labels import status_label
from app.scoring.reputation import to_display

router = APIRouter(prefix="/api/insights", tags=["Insights"])
CREDIBLE = ("supported", "strongly_supported")


def _window(days: int | None, start: date | None, end: date | None):
    if start or end:
        end = end or dhaka_date()
        start = start or end - timedelta(days=29)
        if start > end or (end - start).days > 366:
            raise HTTPException(status_code=422, detail="Choose a date range of at most one year")
        return dhaka_day_bounds(start)[0], dhaka_day_bounds(end)[1]
    days = days or 30
    return now_utc() - timedelta(days=days), now_utc()


def _civic(db: Session, since, until, category: str | None, ward_id: int | None):
    q = db.query(Report).filter(Report.report_type == "civic", Report.visibility == "visible",
                                Report.submitted_at >= since, Report.submitted_at < until)
    if category:
        cat = db.query(Category.id).filter_by(code=category).first()
        if cat is None:
            raise HTTPException(status_code=422, detail="Unknown category")
        q = q.filter(Report.category_id == cat[0])
    if ward_id is not None:
        q = q.filter(Report.ward_id == ward_id)
    return q


def band(score: float) -> str:
    low, high = get_params().hotspots.score_bands
    return "high" if score >= high else "medium" if score >= low else "low"


@router.get("/summary")
def summary(days: int = Query(30, ge=1, le=365), user: User = Depends(current_user), db: Session = Depends(get_db)):
    since, until = _window(days, None, None)
    base = _civic(db, since, until, None, None)
    total = base.count()
    scored = base.filter(Report.status != "pending").count()
    credible = base.filter(Report.status.in_(CREDIBLE)).count()
    today_start, _ = dhaka_day_bounds(dhaka_date())
    by_cat = dict(base.with_entities(Report.category_id, func.count(Report.id)).group_by(Report.category_id).all())
    cats = db.query(Category).order_by(Category.id).all()
    local_day = func.date(func.timezone("Asia/Dhaka", Report.submitted_at))
    trend = base.with_entities(local_day, func.count(Report.id)).group_by(local_day).order_by(local_day).all()
    resolved = db.query(func.count(Event.id)).filter(Event.resolved_at >= since).scalar()
    alerts = db.query(func.count(Alert.id)).filter(Alert.test_date >= dhaka_date() - timedelta(days=7)).scalar()
    return {
        "window_days": days, "reports": total, "reports_today": base.filter(Report.submitted_at >= today_start).count(),
        "scored": scored, "credible": credible,
        "credible_share_display": to_display(credible / scored) if scored else None,
        "hotspots": db.query(func.count(Hotspot.id)).scalar(), "alerts_7d": alerts, "resolved_events": resolved,
        "by_category": [{"code": c.code, "name_en": c.name_en, "name_bn": c.name_bn, "count": by_cat.get(c.id, 0)} for c in cats],
        "trend": [{"date": d.isoformat(), "count": n} for d, n in trend],
        "includes_demo_data": base.filter(Report.is_seed.is_(True)).count() > 0,
    }


@router.get("/map")
def map_points(days: int | None = Query(None, ge=1, le=365), start: date | None = None, end: date | None = None,
               category: str | None = Query(None, max_length=40), ward_id: int | None = None,
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    since, until = _window(days, start, end)
    g = cast(Report.location, Geometry)
    rows = _civic(db, since, until, category, ward_id).join(Category, Category.id == Report.category_id) \
        .with_entities(Report, Category.code, Category.name_en, func.ST_Y(g), func.ST_X(g)) \
        .order_by(Report.submitted_at).limit(5000).all()
    ids = [r.id for r, *_ in rows]
    voted = {rid for rid, in db.query(Vote.report_id).filter(Vote.voter_id == user.id, Vote.replaced_at.is_(None),
                                                            Vote.report_id.in_(ids)).all()} if ids else set()
    features = []
    for r, code, name, lat, lon in rows:
        props = {"id": str(r.id), "category": code, "category_name": name, "submitted_at": r.submitted_at.isoformat(),
                 "ward_id": r.ward_id, "is_seed": r.is_seed, "results_visible": False}
        if user.role == "admin" or r.user_id == user.id or r.id in voted:          # X1
            props.update(results_visible=True, status=r.status, status_label=status_label(r.status),
                         credibility_display=to_display(r.credibility), uncertainty_display=to_display(r.uncertainty))
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
                         "properties": props})
    return {"type": "FeatureCollection", "features": features}


GRID_SQL = text("""
WITH pts AS (
    SELECT ST_Transform(location::geometry, 3857) AS p
    FROM reports r
    WHERE r.report_type = 'civic' AND r.visibility = 'visible' AND r.status IN ('supported', 'strongly_supported')
      AND r.submitted_at >= :since AND r.submitted_at < :until
      AND (CAST(:category_id AS integer) IS NULL OR r.category_id = CAST(:category_id AS integer))
), cells AS (
    SELECT floor(ST_X(p) / :cell) AS gx, floor(ST_Y(p) / :cell) AS gy, count(*) AS n FROM pts GROUP BY 1, 2
)
SELECT n, ST_AsGeoJSON(ST_Transform(ST_MakeEnvelope(gx * :cell, gy * :cell, (gx + 1) * :cell, (gy + 1) * :cell, 3857), 4326), 6)
FROM cells ORDER BY n DESC LIMIT 2000
""")


@router.get("/grid")
def grid(days: int | None = Query(None, ge=1, le=365), start: date | None = None, end: date | None = None,
         category: str | None = Query(None, max_length=40), cell_m: int = Query(250, ge=50, le=2000),
         user: User = Depends(current_user), db: Session = Depends(get_db)):
    """B4: one column per grid cell; height = number of credible reports in the cell."""
    import json

    since, until = _window(days, start, end)
    cat_id = None
    if category:
        cat = db.query(Category.id).filter_by(code=category).first()
        if cat is None:
            raise HTTPException(status_code=422, detail="Unknown category")
        cat_id = cat[0]
    rows = db.execute(GRID_SQL, {"since": since, "until": until, "category_id": cat_id, "cell": float(cell_m)}).all()
    return {"type": "FeatureCollection", "cell_m": cell_m,
            "features": [{"type": "Feature", "geometry": json.loads(gj), "properties": {"count": int(n)}} for n, gj in rows]}


@router.get("/hotspots")
def hotspots(user: User = Depends(current_user), db: Session = Depends(get_db)):
    import json

    cats = {c.id: c for c in db.query(Category).all()}
    rows = db.query(Hotspot, func.ST_Y(cast(Hotspot.centroid, Geometry)), func.ST_X(cast(Hotspot.centroid, Geometry)),
                    func.ST_AsGeoJSON(Hotspot.hull, 6)).order_by(Hotspot.score.desc()).all()
    out = []
    for h, lat, lon, hull in rows:
        c = cats[h.category_id]
        out.append({"id": str(h.id), "category": {"code": c.code, "name_en": c.name_en, "name_bn": c.name_bn},
                    "lat": float(lat), "lon": float(lon), "hull": json.loads(hull) if hull else None,
                    "score": round(h.score, 1), "band": band(h.score), "severity": h.s_severity, "volume": h.v_volume,
                    "compactness": h.c_compact, "trust": h.t_trust, "n_reports": h.n_reports, "n_users": h.n_users,
                    "computed_at": h.computed_at.isoformat(), "window_start": h.window_start.isoformat(),
                    "window_end": h.window_end.isoformat()})
    return out


@router.get("/alerts")
def alerts(days: int = Query(14, ge=1, le=90), user: User = Depends(current_user), db: Session = Depends(get_db)):
    since = dhaka_date() - timedelta(days=days)
    rows = (db.query(Alert, Ward, Category).join(Ward, Ward.id == Alert.ward_id).join(Category, Category.id == Alert.category_id)
            .filter(Alert.test_date >= since)
            .order_by(Alert.test_date.desc(), Alert.mean_credibility.desc().nullslast()).all())
    return [{"id": str(a.id), "test_date": a.test_date.isoformat(), "ward": {"id": w.id, "name_en": w.name_en, "name_bn": w.name_bn},
             "category": {"code": c.code, "name_en": c.name_en, "name_bn": c.name_bn}, "observed": a.observed,
             "baseline_n": a.baseline_n, "baseline_days": a.baseline_days,
             "expected": round(a.baseline_n / a.baseline_days, 2) if a.baseline_days else None,
             "p_value": a.p_value, "test": a.test,
             "mean_credibility_display": to_display(a.mean_credibility)} for a, w, c in rows]
