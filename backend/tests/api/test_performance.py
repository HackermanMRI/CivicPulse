"""Batched endpoints added for the tab-lag fix: the feed's area pulse (one request for many wards) and the prices
dashboard (a fixed number of queries, whatever the number of products and markets)."""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import event

from app.database import engine
from app.models import Commodity, Market, ReferencePrice, VerifiedPrice


def test_pulse_matches_summary_and_needs_sign_in(client, citizens, ward):
    a, b = citizens(2)
    assert a.civic(seed=1).status_code == 201
    assert b.civic(seed=2, ward_lat=23.6250, ward_lon=90.5000).status_code == 201
    s = a.get("/api/insights/summary", params={"days": 7, "ward_id": ward, "status": "all", "show_resolved": "true"}).json()
    p = a.get("/api/insights/pulse", params={"ward_id": [ward], "days": 7})
    assert p.status_code == 200, p.text
    assert p.json() == {"days": 7, "reports": s["in_view"], "fixed": s["resolved_events"]}
    assert p.json()["reports"] == 2
    # Repeating a ward doesn't count it twice; a ward with nothing in it adds nothing.
    assert a.get("/api/insights/pulse", params={"ward_id": [ward, ward, 999999]}).json()["reports"] == 2
    assert client.get("/api/insights/pulse", params={"ward_id": [ward]}).status_code == 401
    assert a.get("/api/insights/pulse").status_code == 422                          # at least one ward
    assert a.get("/api/insights/pulse", params={"ward_id": list(range(1, 12))}).status_code == 422  # at most 10


def _market(db, name):
    m = Market(name_en=name, name_bn=name, location="SRID=4326;POINT(90.499 23.624)", source="field", verified=True)
    db.add(m)
    db.flush()
    return m


def _seed_prices(db, n_products: int, markets: list[Market], first: int = 0):
    today = date.today()
    for i in range(first, first + n_products):
        c = Commodity(name_en=f"Rice {i}", name_bn=f"চাল {i}", variant="coarse", unit="kg", active=True)
        db.add(c)
        db.flush()
        for m in markets:
            for back in range(0, 9, 2):
                db.add(VerifiedPrice(commodity_id=c.id, market_id=m.id, date=today - timedelta(days=back),
                                     verified_price=50 + i + back, report_count=3, status="Verified", report_ids=[]))
    db.commit()


def _count_queries(fn):
    n = 0

    def tick(*_):
        nonlocal n
        n += 1
    event.listen(engine, "before_cursor_execute", tick)
    try:
        fn()
    finally:
        event.remove(engine, "before_cursor_execute", tick)
    return n


def test_price_dashboard_query_count_does_not_grow(citizens, db):
    a, = citizens(1)
    markets = [_market(db, "Market A"), _market(db, "Market B")]
    _seed_prices(db, 2, markets)
    small = _count_queries(lambda: a.get("/api/prices/dashboard").raise_for_status())
    _seed_prices(db, 6, markets + [_market(db, "Market C")], first=2)
    big = _count_queries(lambda: a.get("/api/prices/dashboard").raise_for_status())
    assert big == small, (small, big)                       # was ~4 queries per product × market
    cards = a.get("/api/prices/dashboard").json()["cards"]
    assert len(cards) == 8 and all(c["latest"] and c["change_7d"] is not None for c in cards[:2])
    assert a.get("/api/prices/alerts").status_code == 200


def test_price_dashboard_reference_prefers_market_then_newest(citizens, db):
    a, = citizens(1)
    m = _market(db, "Market A")
    other = _market(db, "Market B")
    _seed_prices(db, 1, [m])
    c = db.query(Commodity).one()
    today = date.today()
    db.add_all([
        ReferencePrice(source="TCB", commodity_id=c.id, market_id=None, date=today - timedelta(days=1), min_bdt=40, max_bdt=45),
        ReferencePrice(source="field", commodity_id=c.id, market_id=m.id, date=today - timedelta(days=1), min_bdt=41, max_bdt=44),
        ReferencePrice(source="DAM", commodity_id=c.id, market_id=other.id, date=today, min_bdt=10, max_bdt=11),  # other market
        ReferencePrice(source="TCB", commodity_id=c.id, market_id=None, date=today - timedelta(days=9), min_bdt=1, max_bdt=2),  # too old
    ])
    db.commit()
    card = a.get("/api/prices/dashboard", params={"market_id": m.id}).json()["cards"][0]
    assert card["reference"]["source"] == "field" and card["reference"]["min_bdt"] == 41.0
