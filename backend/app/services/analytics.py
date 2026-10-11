"""Scheduled analytics (W7): live days, emerging-issue alerts, hotspots and the collusion scan.

The maths lives in app/scoring (pure, unit-tested). This module only reads the database,
calls those functions and stores the results.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta

from geoalchemy2 import Geometry
from sqlalchemy import cast, func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.params import get_params
from app.core.timeutil import DHAKA, dhaka_date, now_utc
from app.models import Alert, Category, CollusionAlert, Event, Hotspot, LiveDay, Report, Vote, VoterPair, Ward
from app.scoring.alerts import build_baseline, run_alerts
from app.scoring.collusion import VoteRow, flag_pairs, pair_statistics
from app.scoring.hotspots import HotspotReport, find_hotspots
from app.services import notify as N

SUPPORTED = ("supported", "strongly_supported")


def mark_live_day(db: Session, day: date | None = None) -> None:
    """A day counts as a zero-count day only if the system was running (P8)."""
    day = day or dhaka_date()
    db.execute(insert(LiveDay).values(date=day, live=True).on_conflict_do_update(index_elements=[LiveDay.date],
                                                                                 set_={"live": True}))


def _open_event_filter(q):
    """Resolved events leave hotspots and alerts (N3)."""
    return q.outerjoin(Event, Event.id == Report.event_id).filter(Event.resolved_at.is_(None))


# ---------------- alerts (F29) ----------------

def daily_alerts(db: Session, test_day: date) -> list[Alert]:
    params = get_params()
    start = test_day - timedelta(days=params.alerts.guard_days + params.alerts.baseline_days)
    local_day = func.date(func.timezone("Asia/Dhaka", Report.submitted_at))
    q = db.query(Report.ward_id, Category.code, local_day.label("d"), func.count(Report.id), func.avg(Report.credibility)) \
        .join(Category, Category.id == Report.category_id) \
        .filter(Report.report_type == "civic", Report.visibility == "visible", Report.ward_id.isnot(None),
                Report.status.in_(SUPPORTED), local_day >= start, local_day <= test_day)
    q = _open_event_filter(q).group_by(Report.ward_id, Category.code, local_day)
    counts: dict[tuple[str, str], dict[date, int]] = defaultdict(dict)
    cred: dict[tuple[str, str], float] = {}
    for ward_id, code, d, n, avg_c in q.all():
        counts[(str(ward_id), code)][d] = int(n)
        if d == test_day:
            cred[(str(ward_id), code)] = float(avg_c)
    live = {d for d, in db.query(LiveDay.date).filter(LiveDay.live.is_(True), LiveDay.date >= start).all()}
    # Every ward × category is tested, also those with no reports at all (their count is 0).
    wards = [str(w) for w, in db.query(Ward.id).all()]
    codes = [c.code for c in params.categories]
    baselines = {(w, c): build_baseline(counts.get((w, c), {}), live, test_day, params) for w in wards for c in codes}
    results = run_alerts(baselines, test_day, params)
    cats = {c.code: c for c in db.query(Category).all()}
    stored = []
    for r in results:
        if not r.alert:
            continue
        cat = cats[r.category]
        values = dict(kind="emerging_issue", ward_id=int(r.ward_id), category_id=cat.id, test_date=r.test_date,
                      observed=r.observed, baseline_n=r.baseline_n, baseline_days=r.baseline_days, p_value=r.p_value,
                      test=r.test, mean_credibility=cred.get((r.ward_id, r.category)))
        existed = db.query(Alert.id).filter_by(ward_id=values["ward_id"], category_id=cat.id, test_date=test_day).first()
        db.execute(insert(Alert).values(**values).on_conflict_do_update(
            constraint="uq_alert_cell_day", set_={k: v for k, v in values.items() if k not in ("ward_id", "category_id", "test_date")}))
        if existed is None:
            ward = db.get(Ward, int(r.ward_id))
            for uid in N.users_in_ward(db, ward.id):
                N.notify(db, uid, "emerging_issue",
                         {"text": f"Emerging issue: more {cat.name_en.lower()} reports than usual in {ward.name_en}.",
                          "ward": ward.name_en, "category": cat.name_en, "category_code": cat.code,
                          "observed": r.observed})
        stored.append(values)
    return stored


# ---------------- hotspots (F27–F28) ----------------

def daily_hotspots(db: Session, now: datetime | None = None) -> int:
    params = get_params()
    now = now or now_utc()
    since = now - timedelta(days=params.hotspots.window_days)
    geom = cast(Report.location, Geometry)
    q = db.query(Report.id, Report.user_id, Category.code, Report.submitted_at, func.ST_Y(geom), func.ST_X(geom),
                 Report.credibility) \
        .join(Category, Category.id == Report.category_id) \
        .filter(Report.report_type == "civic", Report.visibility == "visible", Report.submitted_at >= since,
                Report.status.notin_(("not_supported", "pending")), ~Report.flags.any("duplicate"),
                ~Report.flags.any("suspicious"))
    rows = _open_event_filter(q).all()
    reports = [HotspotReport(str(rid), str(uid), code, t.astimezone(DHAKA).date(), float(lat), float(lon), float(c),
                             (now - t).total_seconds() / 86400.0) for rid, uid, code, t, lat, lon, c in rows]
    found = find_hotspots(reports, params)
    cats = {c.code: c.id for c in db.query(Category).all()}
    db.query(Hotspot).delete()          # the table holds the latest daily run; every run stores its parameters
    for h in found:
        ids = [uuid.UUID(i) for i in h.report_ids]
        hull_sql = func.ST_ConvexHull(func.ST_Collect(cast(Report.location, Geometry)))
        hull_ewkt, hull_type = db.query(func.ST_AsEWKT(hull_sql), func.GeometryType(hull_sql)) \
            .filter(Report.id.in_(ids)).one()
        db.add(Hotspot(category_id=cats[h.category], centroid=f"SRID=4326;POINT({h.centroid[1]} {h.centroid[0]})",
                       hull=hull_ewkt if hull_type == "POLYGON" else None, score=h.score, s_severity=h.s_severity, v_volume=h.v_volume,  # points on one line give no polygon
                       c_compact=h.c_compact, t_trust=h.t_trust, n_reports=h.n_reports, n_users=h.n_users,
                       report_ids=ids, window_start=since, window_end=now, eps_m=h.eps_m, min_samples=h.min_samples,
                       config_hash=params.config_hash))
    return len(found)


# ---------------- collusion (X2, L13) ----------------

def collusion_scan(db: Session) -> int:
    params = get_params()
    rows = db.query(Vote).filter(Vote.replaced_at.is_(None), Vote.voter_id.isnot(None)).all()
    votes = [VoteRow(str(v.voter_id), str(v.report_id), v.decision, v.mode_verified, v.created_at) for v in rows]
    stats = pair_statistics(votes)
    now = now_utc()
    for s in stats:
        a, b = sorted((s.user_a, s.user_b))
        values = dict(user_a=uuid.UUID(a), user_b=uuid.UUID(b), co_votes=s.co_votes, disputed_co_votes=s.disputed_co_votes,
                      disputed_agreements=s.disputed_agreements, median_gap_seconds=s.median_gap_seconds, updated_at=now)
        db.execute(insert(VoterPair).values(**values).on_conflict_do_update(
            index_elements=[VoterPair.user_a, VoterPair.user_b], set_={k: v for k, v in values.items()
                                                                       if k not in ("user_a", "user_b")}))
    new = 0
    by_voter: dict[str, set[str]] = defaultdict(set)
    for v in votes:
        by_voter[v.voter_id].add(v.report_id)
    for flag in flag_pairs(stats, params):
        pair = sorted((flag.stats.user_a, flag.stats.user_b))
        users = [uuid.UUID(u) for u in pair]
        open_alert = db.query(CollusionAlert.id).filter(CollusionAlert.kind == "pair_agreement",
                                                        CollusionAlert.status == "open",
                                                        CollusionAlert.user_ids.contains(users)).first()
        if open_alert:
            continue
        shared = sorted(by_voter[pair[0]] & by_voter[pair[1]])
        s = flag.stats
        db.add(CollusionAlert(kind="pair_agreement", user_ids=users, report_ids=[uuid.UUID(r) for r in shared],
                              signals={**flag.signals, "co_votes": s.co_votes, "disputed_co_votes": s.disputed_co_votes,
                                       "disputed_agreements": s.disputed_agreements,
                                       "median_gap_seconds": s.median_gap_seconds}))
        audit(db, actor_id=None, action="collusion.flag", entity="user_pair", entity_id=f"{pair[0][:8]}-{pair[1][:8]}",
              after=flag.signals, reason="2-of-3 pair signals (P5, L13); log only, no penalty (M7)")
        new += 1
    return new



# ---------------- price alerts (P-2, P-4, A2) ----------------

def verified_series(db: Session, commodity_id: int, market_id: int, since: date) -> dict[date, float]:
    from app.models import VerifiedPrice
    rows = db.query(VerifiedPrice.date, VerifiedPrice.verified_price).filter(
        VerifiedPrice.commodity_id == commodity_id, VerifiedPrice.market_id == market_id,
        VerifiedPrice.status == "Verified", VerifiedPrice.date >= since).all()
    return {d: float(p) for d, p in rows if p is not None}


def price_alert_check(db: Session, commodity_id: int, market_id: int, today: date | None = None) -> str | None:
    """Notify users who watch this product when the 7-day change reaches ±10% (once per product, market and day)."""
    from app.models import Commodity, Market, Notification, PriceWatch
    from app.scoring.prices import price_alert, seven_day_change

    params = get_params()
    today = today or dhaka_date()
    series = verified_series(db, commodity_id, market_id, today - timedelta(days=params.prices.change_window_days))
    change = seven_day_change(series, today, params)
    kind = price_alert(change, params)
    if kind is None:
        return None
    com, mkt = db.get(Commodity, commodity_id), db.get(Market, market_id)
    arrow = "rose" if kind == "rise" else "dropped"
    for uid, in db.query(PriceWatch.user_id).filter(PriceWatch.commodity_id == commodity_id).all():
        already = db.query(Notification.id).filter(
            Notification.user_id == uid, Notification.kind == "price_alert",
            Notification.payload["commodity_id"].astext == str(commodity_id),
            Notification.payload["market_id"].astext == str(market_id),
            Notification.payload["date"].astext == today.isoformat()).first()
        if already:
            continue
        N.notify(db, uid, "price_alert", {
            "text": f"{com.name_en} ({com.variant}) {arrow} {abs(change.percent):.0f}% in 7 days at {mkt.name_en}.",
            "commodity_id": commodity_id, "market_id": market_id, "date": today.isoformat(), "direction": kind,
            "percent": round(change.percent, 1)})
    return kind
