"""Insights for the dashboard: KPIs, map points, 2D/3D grid, hotspots and emerging-issue alerts (W7, X1, B4).

X1: a report's status and scores appear on the map only for people who voted on it and for its reporter.
Counts and grid totals are aggregates and are shown to everyone who is signed in.
"""
from __future__ import annotations

import math
from collections import Counter
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2 import Geometry
from sqlalchemy import cast, func, or_, select, text
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
        q = q.filter(Report.category_id == _category_id(db, category))
    if ward_id is not None:
        q = q.filter(Report.ward_id == ward_id)
    return q


def _category_id(db: Session, code: str) -> int:
    cat = db.query(Category.id).filter_by(code=code).first()
    if cat is None:
        raise HTTPException(status_code=422, detail="Unknown category")
    return cat[0]


StatusFilter = Literal["credible", "all", "strongly_supported", "supported", "uncertain", "not_supported"]


def _resolved_events():
    return select(Event.id).where(Event.resolved_at.isnot(None))


def _result_filters(q, status: StatusFilter, show_resolved: bool):
    """Filters that depend on a report's result (status, resolved). Used by the dashboard filter bar."""
    if status == "credible":
        q = q.filter(Report.status.in_(CREDIBLE))
    elif status != "all":
        q = q.filter(Report.status == status)
    if not show_resolved:
        q = q.filter(or_(Report.event_id.is_(None), Report.event_id.not_in(_resolved_events())))
    return q


def _uses_results(status: StatusFilter, show_resolved: bool) -> bool:
    return status != "all" or not show_resolved


# 250 m grid in Web Mercator, the same cells as GRID_SQL. Snapping a point to its cell centre hides the exact
# report while revealing nothing the 3D grid does not already show to every signed-in user (X1).
_R = 6378137.0


def snap_to_cell(lat: float, lon: float, cell_m: float = 250.0) -> tuple[float, float]:
    x = math.radians(lon) * _R
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * _R
    cx = (math.floor(x / cell_m) + 0.5) * cell_m
    cy = (math.floor(y / cell_m) + 0.5) * cell_m
    return math.degrees(2 * math.atan(math.exp(cy / _R)) - math.pi / 2), math.degrees(cx / _R)


def band(score: float) -> str:
    low, high = get_params().hotspots.score_bands
    return "high" if score >= high else "medium" if score >= low else "low"


@router.get("/summary")
def summary(days: int = Query(30, ge=1, le=366), start: date | None = None, category: str | None = Query(None, max_length=40),
            ward_id: int | None = None, status: StatusFilter = "credible", show_resolved: bool = False,
            user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Dashboard KPIs and panels. Every number is an aggregate, so it is shown to every signed-in user (X1).
    `start` (e.g. 1 January) overrides `days` for "This year"."""
    since, until = _window(None, start, None) if start else _window(days, None, None)
    span_days = max(1, (until - since).days)
    in_area = _civic(db, since, until, None, ward_id)            # all categories: for the category panel
    base = in_area if not category else _civic(db, since, until, category, ward_id)
    shown = _result_filters(base, status, show_resolved)
    week_start = max(since, now_utc() - timedelta(days=7))
    cats = db.query(Category).order_by(Category.id).all()
    by_cat = dict(_result_filters(in_area, status, show_resolved)
                  .with_entities(Report.category_id, func.count(Report.id)).group_by(Report.category_id).all())
    total_cat = sum(by_cat.values())
    top = max(cats, key=lambda c: by_cat.get(c.id, 0)) if total_cat else None
    local_day = func.date(func.timezone("Asia/Dhaka", Report.submitted_at))
    trend = dict(shown.with_entities(local_day, func.count(Report.id)).group_by(local_day).all())
    alert_q = db.query(Alert.test_date).filter(Alert.test_date >= dhaka_date() - timedelta(days=span_days))
    if category:
        alert_q = alert_q.filter(Alert.category_id == _category_id(db, category))
    if ward_id is not None:
        alert_q = alert_q.filter(Alert.ward_id == ward_id)
    alert_days = {d for d, in alert_q.all()}
    first_day = dhaka_date() - timedelta(days=min(span_days, 366) - 1)
    days_list = [first_day + timedelta(days=i) for i in range((dhaka_date() - first_day).days + 1)]
    resolved_ids = {e for e, in db.query(Event.id).filter(Event.resolved_at.isnot(None), Event.resolved_at >= since).all()}
    resolved = base.filter(Report.event_id.in_(resolved_ids)).with_entities(func.count(func.distinct(Report.event_id))).scalar() \
        if resolved_ids else 0
    hs = db.query(Hotspot)
    if category:
        hs = hs.filter(Hotspot.category_id == _category_id(db, category))
    return {
        "window": {"since": since.isoformat(), "until": until.isoformat(), "days": span_days},
        "in_view": shown.count(),
        "new_this_week": shown.filter(Report.submitted_at >= week_start).count(),
        "resolved_events": resolved,
        "active_hotspots": hs.count(),
        "top_category": {"code": top.code, "name_en": top.name_en, "name_bn": top.name_bn,
                         "share_display": round(100 * by_cat.get(top.id, 0) / total_cat)} if top else None,
        "by_category": sorted(({"code": c.code, "name_en": c.name_en, "name_bn": c.name_bn, "count": by_cat.get(c.id, 0)}
                               for c in cats), key=lambda r: -r["count"]),
        "trend": [{"date": d.isoformat(), "count": trend.get(d, 0), "alert": d in alert_days} for d in days_list],
        "wards": _ward_table(db, since, until, category, cats),
        "includes_demo_data": base.filter(Report.is_seed.is_(True)).count() > 0,
    }


def _ward_table(db: Session, since, until, category: str | None, cats: list[Category]) -> list[dict]:
    """Ward comparison: credible reports, share of them resolved, and the most common category."""
    names = {c.id: c.name_en for c in cats}
    resolved = {e for e, in db.query(Event.id).filter(Event.resolved_at.isnot(None)).all()}
    rows = (_civic(db, since, until, category, None).filter(Report.status.in_(CREDIBLE), Report.ward_id.isnot(None))
            .with_entities(Report.ward_id, Report.category_id, Report.event_id).all())
    per: dict[int, dict] = {}
    for ward_id, cat_id, event_id in rows:
        w = per.setdefault(ward_id, {"n": 0, "resolved": 0, "cats": Counter()})
        w["n"] += 1
        w["resolved"] += event_id in resolved
        w["cats"][cat_id] += 1
    wards = {w.id: w for w in db.query(Ward).filter(Ward.id.in_(list(per))).all()} if per else {}
    out = [{"ward": {"id": wid, "name_en": wards[wid].name_en, "name_bn": wards[wid].name_bn},
            "credible": v["n"], "resolved_share_display": round(100 * v["resolved"] / v["n"]),
            "top_category": names[v["cats"].most_common(1)[0][0]]} for wid, v in per.items()]
    return sorted(out, key=lambda r: -r["credible"])[:10]


@router.get("/map")
def map_points(days: int | None = Query(None, ge=1, le=366), start: date | None = None, end: date | None = None,
               category: str | None = Query(None, max_length=40), ward_id: int | None = None,
               status: StatusFilter = "all", show_resolved: bool = True,
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Map points. X1: status and scores only for reports the viewer voted on or posted. When a status or
    resolved filter is on, the other points are snapped to their 250 m cell and lose their id, so a filter can't be
    used to learn one report's result before voting."""
    since, until = _window(days, start, end)
    g = cast(Report.location, Geometry)
    q = _result_filters(_civic(db, since, until, category, ward_id), status, show_resolved)
    rows = q.join(Category, Category.id == Report.category_id) \
        .with_entities(Report, Category.code, Category.name_en, func.ST_Y(g), func.ST_X(g)) \
        .order_by(Report.submitted_at).limit(5000).all()
    ids = [r.id for r, *_ in rows]
    voted = {rid for rid, in db.query(Vote.report_id).filter(Vote.voter_id == user.id, Vote.replaced_at.is_(None),
                                                            Vote.report_id.in_(ids)).all()} if ids else set()
    hide = _uses_results(status, show_resolved)
    params = get_params()
    severity = {c.code: round(params.severity(c.code), 3) for c in params.categories}
    features = []
    for r, code, name, lat, lon in rows:
        lat, lon = float(lat), float(lon)
        sees = user.role == "admin" or r.user_id == user.id or r.id in voted
        props = {"id": str(r.id), "category": code, "category_name": name, "submitted_at": r.submitted_at.isoformat(),
                 "ward_id": r.ward_id, "is_seed": r.is_seed, "results_visible": False, "approximate": False,
                 "severity": severity.get(code, 0.5)}                       # heatmap "Weight by severity" (F27)
        if sees:                                                                     # X1
            props.update(results_visible=True, status=r.status, status_label=status_label(r.status),
                         credibility_display=to_display(r.credibility), uncertainty_display=to_display(r.uncertainty))
        elif hide:
            lat, lon = snap_to_cell(lat, lon)
            props.update(id=None, approximate=True)
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props})
    return {"type": "FeatureCollection", "features": features}


GRID_SQL = text("""
WITH pts AS (
    SELECT ST_Transform(location::geometry, 3857) AS p
    FROM reports r
    WHERE r.report_type = 'civic' AND r.visibility = 'visible' AND r.status IN ('supported', 'strongly_supported')
      AND r.submitted_at >= :since AND r.submitted_at < :until
      AND (CAST(:category_id AS integer) IS NULL OR r.category_id = CAST(:category_id AS integer))
      AND (CAST(:ward_id AS integer) IS NULL OR r.ward_id = CAST(:ward_id AS integer))
      AND (CAST(:show_resolved AS boolean) OR r.event_id IS NULL
           OR r.event_id NOT IN (SELECT id FROM events WHERE resolved_at IS NOT NULL))
), cells AS (
    SELECT floor(ST_X(p) / :cell) AS gx, floor(ST_Y(p) / :cell) AS gy, count(*) AS n FROM pts GROUP BY 1, 2
)
SELECT n, ST_AsGeoJSON(ST_Transform(ST_MakeEnvelope(gx * :cell, gy * :cell, (gx + 1) * :cell, (gy + 1) * :cell, 3857), 4326), 6)
FROM cells ORDER BY n DESC LIMIT 2000
""")


@router.get("/grid")
def grid(days: int | None = Query(None, ge=1, le=366), start: date | None = None, end: date | None = None,
         category: str | None = Query(None, max_length=40), ward_id: int | None = None, show_resolved: bool = False,
         cell_m: int = Query(250, ge=50, le=2000), user: User = Depends(current_user), db: Session = Depends(get_db)):
    """B4: one column per grid cell; height = number of credible reports in the cell."""
    import json

    since, until = _window(days, start, end)
    cat_id = _category_id(db, category) if category else None
    rows = db.execute(GRID_SQL, {"since": since, "until": until, "category_id": cat_id, "ward_id": ward_id,
                                 "show_resolved": show_resolved, "cell": float(cell_m)}).all()
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
        centre = cast(select(Hotspot.centroid).where(Hotspot.id == h.id).scalar_subquery(), Geometry)   # never re-send loaded geography
        ward = db.query(Ward.id, Ward.name_en).filter(Ward.geom.isnot(None), func.ST_Covers(Ward.geom, centre)).first()
        out.append({"id": str(h.id), "category": {"code": c.code, "name_en": c.name_en, "name_bn": c.name_bn},
                    "ward": {"id": ward[0], "name_en": ward[1]} if ward else None,
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
