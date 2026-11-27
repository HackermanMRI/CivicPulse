"""Price Patrol read side: dashboard cards, history, market comparison, alerts and raw reports (W6, Q22, C19, P-2, P-4).

"Verified price" always means the median of at least 3 eligible credible reports (F23), never a proven price.
Raw medians are shown only as a labelled comparison line, never as a verified price.
"""
from __future__ import annotations

from datetime import date, timedelta
from statistics import median

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import current_user, get_db
from app.core.params import get_params
from app.core.timeutil import dhaka_date
from app.models import Commodity, Market, PriceDetail, PriceWatch, ReferencePrice, Report, User, VerifiedPrice
from app.scoring.prices import price_alert, seven_day_change
from app.services.analytics import verified_series
from app.services.labels import status_label

router = APIRouter(prefix="/api/prices", tags=["Prices"])


def _commodity(c: Commodity) -> dict:
    return {"id": c.id, "name_en": c.name_en, "name_bn": c.name_bn, "variant": c.variant, "unit": c.unit}


def _market(db: Session, market_id: int | None) -> Market:
    m = db.get(Market, market_id) if market_id else db.query(Market).order_by(Market.id).first()
    if m is None:
        raise HTTPException(status_code=404, detail="No markets yet")
    return m


def _reference_out(ref: ReferencePrice | None) -> dict | None:
    return None if ref is None else {"source": ref.source, "date": ref.date.isoformat(), "min_bdt": float(ref.min_bdt),
                                     "max_bdt": float(ref.max_bdt), "note": "Information only, never evidence (Q26)"}


def _reference(db: Session, commodity_id: int, market_id: int, day: date) -> dict | None:
    ref = (db.query(ReferencePrice).filter(ReferencePrice.commodity_id == commodity_id, ReferencePrice.date <= day,
                                          ReferencePrice.date >= day - timedelta(days=7),
                                          (ReferencePrice.market_id == market_id) | ReferencePrice.market_id.is_(None))
           .order_by(ReferencePrice.date.desc()).first())
    return _reference_out(ref)


def _change(series: dict[date, float], today: date) -> dict | None:
    params = get_params()
    ch = seven_day_change(series, today, params)
    if ch is None:
        return None
    return {"percent": round(ch.percent, 1), "from_date": ch.from_date.isoformat(), "from_price": ch.from_price,
            "to_date": ch.to_date.isoformat(), "to_price": ch.to_price, "alert": price_alert(ch, params)}


def _market_ref(m: Market) -> dict:
    return {"id": m.id, "name_en": m.name_en, "name_bn": m.name_bn}


class _CardData:
    """Everything the dashboard cards need, loaded in 3 queries for all products × markets at once. It used to be
    4 queries per card (112 queries for 7 products × 4 markets); now it is the same 3 queries for any number."""

    def __init__(self, db: Session, commodity_ids: list[int], market_ids: list[int], today: date):
        since = today - timedelta(days=13)
        self.cells: dict[tuple[int, int], dict[date, VerifiedPrice]] = {}
        for v in db.query(VerifiedPrice).filter(VerifiedPrice.commodity_id.in_(commodity_ids),
                                                VerifiedPrice.market_id.in_(market_ids), VerifiedPrice.date >= since):
            self.cells.setdefault((v.commodity_id, v.market_id), {})[v.date] = v
        self.raw_today = dict(((c, m), n) for c, m, n in
                              db.query(PriceDetail.commodity_id, PriceDetail.market_id, func.count(PriceDetail.report_id))
                              .join(Report, Report.id == PriceDetail.report_id)
                              .filter(PriceDetail.commodity_id.in_(commodity_ids), PriceDetail.market_id.in_(market_ids),
                                      PriceDetail.observed_date == today, Report.visibility == "visible")
                              .group_by(PriceDetail.commodity_id, PriceDetail.market_id).all())
        # Newest first; on the same day a market's own reference wins over the city-wide one (market_id NULL).
        self.refs: dict[int, list[ReferencePrice]] = {}
        for ref in (db.query(ReferencePrice).filter(ReferencePrice.commodity_id.in_(commodity_ids), ReferencePrice.date <= today,
                                                    ReferencePrice.date >= today - timedelta(days=7))
                    .order_by(ReferencePrice.date.desc(), ReferencePrice.market_id.is_(None))):
            self.refs.setdefault(ref.commodity_id, []).append(ref)

    def series(self, c: int, m: int) -> dict[date, float]:
        """Same as analytics.verified_series over the loaded window: verified days with a price."""
        return {d: float(v.verified_price) for d, v in self.cells.get((c, m), {}).items()
                if v.status == "Verified" and v.verified_price is not None}

    def reference(self, c: int, m: int) -> dict | None:
        return _reference_out(next((r for r in self.refs.get(c, []) if r.market_id in (m, None)), None))


def _card(data: _CardData, c: Commodity, m: Market, today: date, watched: set[int]) -> dict:
    series = data.series(c.id, m.id)
    cells = data.cells.get((c.id, m.id), {})
    cell = cells.get(today)
    latest_day = max(series) if series else None
    raw_today = data.raw_today.get((c.id, m.id), 0)
    return {
        "commodity": _commodity(c), "market": _market_ref(m), "watched": c.id in watched,
        "latest": {"date": latest_day.isoformat(), "verified_price": series[latest_day],
                   "report_count": cells[latest_day].report_count if latest_day in cells else None} if latest_day else None,
        "today": {"status": cell.status, "report_count": cell.report_count, "all_reports": raw_today,
                  "verified_price": float(cell.verified_price) if cell.verified_price is not None else None}
        if cell else {"status": "Insufficient Evidence", "report_count": 0, "all_reports": raw_today, "verified_price": None},
        "change_7d": _change(series, today),
        "sparkline": [{"date": d.isoformat(), "price": p} for d, p in sorted(series.items())],
        "reference": data.reference(c.id, m.id),
    }


def _rank(card: dict) -> tuple:
    """All-markets view: show each product at the market with the strongest evidence today, then the freshest price."""
    t, latest = card["today"], card["latest"]
    return (t["status"] == "Verified", t["report_count"], t["all_reports"], latest["date"] if latest else "",
            (latest["report_count"] or 0) if latest else 0)


@router.get("/dashboard")
def dashboard(market_id: int | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """One card per product. With a market: that market. Without one: every market, best-evidenced card per product."""
    today = dhaka_date()
    watched = {c for c, in db.query(PriceWatch.commodity_id).filter_by(user_id=user.id).all()}
    if market_id is not None:
        markets = [_market(db, market_id)]
    else:
        markets = db.query(Market).order_by(Market.id).all()
        if not markets:
            raise HTTPException(status_code=404, detail="No markets yet")
    commodities = db.query(Commodity).filter_by(active=True).order_by(Commodity.name_en, Commodity.variant).all()
    data = _CardData(db, [c.id for c in commodities], [m.id for m in markets], today)
    cards = [max((_card(data, c, m, today, watched) for m in markets), key=_rank) for c in commodities]
    return {"market": _market_ref(markets[0]) if market_id is not None else None, "date": today.isoformat(), "cards": cards}


@router.get("/history")
def history(commodity_id: int, market_id: int, days: int = Query(30, ge=7, le=180),
            user: User = Depends(current_user), db: Session = Depends(get_db)):
    c, m = db.get(Commodity, commodity_id), db.get(Market, market_id)
    if c is None or m is None:
        raise HTTPException(status_code=404, detail="Not found")
    today = dhaka_date()
    since = today - timedelta(days=days - 1)
    cells = {v.date: v for v in db.query(VerifiedPrice).filter(VerifiedPrice.commodity_id == c.id,
                                                              VerifiedPrice.market_id == m.id, VerifiedPrice.date >= since)}
    raw: dict[date, list[float]] = {}
    for d, p in (db.query(PriceDetail.observed_date, PriceDetail.price_bdt).join(Report, Report.id == PriceDetail.report_id)
                 .filter(PriceDetail.commodity_id == c.id, PriceDetail.market_id == m.id, PriceDetail.observed_date >= since,
                         Report.visibility == "visible").all()):
        raw.setdefault(d, []).append(float(p))
    points = []
    for i in range(days):
        d = since + timedelta(days=i)
        v = cells.get(d)
        points.append({"date": d.isoformat(),
                       "verified_price": float(v.verified_price) if v and v.verified_price is not None else None,
                       "status": v.status if v else None, "eligible_reports": v.report_count if v else 0,
                       "raw_median": median(raw[d]) if d in raw else None, "raw_count": len(raw.get(d, []))})
    series = {date.fromisoformat(p["date"]): p["verified_price"] for p in points if p["verified_price"] is not None}
    return {"commodity": _commodity(c), "market": {"id": m.id, "name_en": m.name_en}, "points": points,
            "change_7d": _change(series, today), "reference": _reference(db, c.id, m.id, today)}


@router.get("/compare")
def compare(commodity_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(Commodity, commodity_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Not found")
    today = dhaka_date()
    since = today - timedelta(days=get_params().prices.raw_display_days - 1)
    out = []
    for m in db.query(Market).order_by(Market.name_en).all():
        series = verified_series(db, c.id, m.id, today - timedelta(days=get_params().prices.raw_display_days))
        latest = max(series) if series else None
        reports = (db.query(func.count(PriceDetail.report_id)).join(Report, Report.id == PriceDetail.report_id)
                   .filter(PriceDetail.commodity_id == c.id, PriceDetail.market_id == m.id,
                           PriceDetail.observed_date >= since, Report.visibility == "visible").scalar())
        out.append({"market": _market_ref(m),
                    "latest": {"date": latest.isoformat(), "verified_price": series[latest]} if latest else None,
                    "change_7d": _change(series, today), "report_count": reports})
    return {"commodity": _commodity(c), "markets": out}


@router.get("/alerts")
def alerts(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """P-2: products whose verified price moved ±10% over 7 days. Watched products first (A2)."""
    today = dhaka_date()
    watched = {c for c, in db.query(PriceWatch.commodity_id).filter_by(user_id=user.id).all()}
    since = today - timedelta(days=7)
    series: dict[tuple[int, int], dict[date, float]] = {}  # one query for every product × market (was one per pair)
    for c_id, m_id, d, p in db.query(VerifiedPrice.commodity_id, VerifiedPrice.market_id, VerifiedPrice.date,
                                     VerifiedPrice.verified_price).filter(VerifiedPrice.status == "Verified",
                                                                           VerifiedPrice.date >= since):
        if p is not None:
            series.setdefault((c_id, m_id), {})[d] = float(p)
    out = []
    markets = db.query(Market).all()
    for c in db.query(Commodity).filter_by(active=True).all():
        for m in markets:
            ch = _change(series.get((c.id, m.id), {}), today)
            if ch and ch["alert"]:
                out.append({"commodity": _commodity(c), "market": {"id": m.id, "name_en": m.name_en},
                            "change_7d": ch, "watched": c.id in watched})
    return sorted(out, key=lambda a: (not a["watched"], -abs(a["change_7d"]["percent"])))


@router.get("/reports")
def raw_reports(commodity_id: int, market_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Explore prices: individual reports from the last 7 days only (C19)."""
    since = dhaka_date() - timedelta(days=get_params().prices.raw_display_days - 1)
    rows = (db.query(Report, PriceDetail).join(PriceDetail, PriceDetail.report_id == Report.id)
            .filter(PriceDetail.commodity_id == commodity_id, PriceDetail.market_id == market_id,
                    PriceDetail.observed_date >= since, Report.visibility == "visible")
            .order_by(PriceDetail.observed_at.desc()).limit(200).all())
    cells = {(v.date): v for v in db.query(VerifiedPrice).filter(VerifiedPrice.commodity_id == commodity_id,
                                                                VerifiedPrice.market_id == market_id,
                                                                VerifiedPrice.date >= since)}
    out = []
    for r, d in rows:
        cell = cells.get(d.observed_date)
        out.append({"id": str(r.id), "price_bdt": float(d.price_bdt), "observed_at": d.observed_at.isoformat(),
                    "status": r.status, "status_label": status_label(r.status),
                    "outlier": "price_outlier" in (r.flags or []), "is_mine": r.user_id == user.id, "is_seed": r.is_seed,
                    "counts_toward_verified": bool(cell and cell.status == "Verified" and r.id in (cell.report_ids or []))})
    return out
