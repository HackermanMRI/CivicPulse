"""Reports, capture tokens, uploads, blind voting, votes, feed, price rules and admin moderation."""
import uuid
from datetime import datetime, timedelta, timezone

from app.models import AuditLog, Market, Report
from tests.api.conftest import photo_bytes


def test_civic_report_is_scored_and_honest_about_missing_models(citizens):
    (a,) = citizens(1)
    r = a.civic()
    assert r.status_code == 201, r.text
    detail = a.get(f"/api/reports/{r.json()['id']}").json()
    res = detail["results"]
    assert res["status"] != "pending"
    comps = {c["component"]: c for c in res["components"]}
    assert comps["text"]["availability"] == "unavailable" and comps["text"]["score"] is None   # never faked (R6)
    assert "not installed" in comps["text"]["explanation"]
    assert comps["gps"]["score"] == 1.0
    assert detail["ward"]["name_en"] == "Test ward"
    assert 0 <= res["credibility_display"] <= 100                                          # ×100 for citizens (C1)


def test_one_civic_report_per_day(citizens):
    (a,) = citizens(1)
    assert a.civic(seed=1).status_code == 201
    assert a.civic(seed=2).status_code == 429


def test_capture_token_rules(citizens, db):
    a, b = citizens(2)
    tok = a.capture()
    assert b.civic(token=tok).status_code == 422                     # someone else's token
    assert a.civic(token=tok, seed=3).status_code == 201
    assert a.civic(token=tok, seed=4).status_code in (422, 429)      # single use (daily limit may answer first)
    from app.models import CaptureToken
    t2 = b.capture()
    row = db.get(CaptureToken, uuid.UUID(t2))
    row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    assert b.civic(token=t2, seed=5).status_code == 422              # expired (10 minutes, P6)


def test_non_image_upload_is_rejected(citizens):
    (a,) = citizens(1)
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    assert a.civic(photo=svg).status_code == 415
    php = b"<?php system($_GET['c']); ?>"
    assert a.civic(photo=php).status_code == 415


def test_very_large_upload_is_rejected(citizens):
    (a,) = citizens(1)
    big = b"\xff\xd8\xff\xe0" + b"0" * (9 * 1024 * 1024)        # 9 MB, over the 8 MB limit (B10)
    assert a.civic(photo=big).status_code == 413


def test_reused_photo_hides_the_report(citizens, db):
    a, b = citizens(2)
    same = photo_bytes(42)
    first = a.civic(photo=same).json()["id"]
    second = b.civic(photo=same).json()["id"]
    assert db.get(Report, uuid.UUID(first)).visibility == "visible"
    r2 = db.get(Report, uuid.UUID(second))
    assert r2.visibility == "auto_hidden" and "suspicious" in r2.flags
    assert a.get(f"/api/reports/{second}").status_code == 404                 # hidden from everyone else
    assert b.get(f"/api/reports/{second}").status_code == 200                 # but not from its reporter


def test_blind_view_until_vote_and_reporter_cannot_vote(citizens):
    a, b = citizens(2)
    rid = a.civic().json()["id"]
    blind = b.get(f"/api/reports/{rid}").json()
    assert blind["results_visible"] is False and blind["results"] is None    # T4: server-side blind view
    assert "credibility" not in str(blind)
    assert a.post(f"/api/reports/{rid}/votes", data={"decision": "confirm", "mode": "far_away"}).status_code == 403
    r = b.post(f"/api/reports/{rid}/votes", data={"decision": "confirm", "mode": "far_away"})
    assert r.status_code == 201, r.text
    assert r.json()["results_visible"] is True and r.json()["vote_result"]["mode_verified"] == "far_away"
    again = b.post(f"/api/reports/{rid}/votes", data={"decision": "disagree", "mode": "same_ward",
                                                      "lat": "23.6241", "lon": "90.4991"})
    assert again.status_code == 409                                           # only an on-the-spot upgrade (V7)


def test_claimed_vote_type_is_checked_by_the_server(citizens):
    a, b, c = citizens(3)
    rid = a.civic().json()["id"]
    r = b.post(f"/api/reports/{rid}/votes", data={"decision": "confirm", "mode": "same_ward", "lat": "23.70", "lon": "90.40"})
    assert r.json()["vote_result"]["mode_verified"] == "far_away"            # GPS outside the ward → moved down (V2)
    r = c.post(f"/api/reports/{rid}/votes", data={"decision": "fixed_now", "mode": "same_ward"})
    assert r.status_code == 422                                               # Fixed now is on-the-spot only (V6)


def test_on_the_spot_vote_with_photo_becomes_a_comment(citizens):
    a, b, c = citizens(3)
    rid = a.civic().json()["id"]
    tok = b.capture("verification", rid)
    r = b.post(f"/api/reports/{rid}/votes", data={"decision": "confirm", "mode": "on_spot", "lat": "23.62411",
                                                  "lon": "90.49911", "accuracy": "8", "capture_token": tok},
               files={"photo": ("v.jpg", photo_bytes(77), "image/jpeg")})
    assert r.status_code == 201, r.text
    assert r.json()["vote_result"]["mode_verified"] == "on_spot"
    comments = r.json()["results"]["comments"]
    assert len(comments) == 1 and comments[0]["decision"] == "confirm"
    assert c.get(comments[0]["photo_url"]).status_code == 404                # comments only after voting (T4)
    assert b.get(comments[0]["photo_url"]).status_code == 200


def test_vote_burst_limit(citizens):
    import time
    a, b = citizens(2)
    rid = a.civic().json()["id"]
    if time.time() % 60 > 50:                       # fixed one-minute windows: don't straddle a boundary
        time.sleep(61 - time.time() % 60)
    codes = [b.post(f"/api/reports/{rid}/votes", data={"decision": "confirm", "mode": "far_away"}).status_code
             for _ in range(11)]
    assert codes[-1] == 429                                                   # 10 per minute (P11)


def test_feed_shows_my_wards_only(citizens, client):
    from tests.api.conftest import Citizen
    a, b = citizens(2)
    a.civic()
    outsider = Citizen(client, "+8801799999999", None, "Outside")
    assert len(b.get("/api/feed").json()["items"]) == 1
    assert outsider.get("/api/feed").json()["items"] == []


def test_description_is_stored_as_plain_text(citizens):
    (a,) = citizens(1)
    nasty = "x'); DROP TABLE reports; -- <script>alert(1)</script>"
    rid = a.civic(description=nasty).json()["id"]
    assert a.get(f"/api/reports/{rid}").json()["description"] == nasty


def test_price_report_rules(citizens, db):
    (a,) = citizens(1)
    from app.models import Commodity
    m = Market(name_en="Real market", name_bn="বাজার", location="SRID=4326;POINT(90.4978 23.6232)", radius_m=150, source="field")
    demo_m = Market(name_en="DEMO market", name_bn="ডেমো", location="SRID=4326;POINT(90.4978 23.6232)", radius_m=150,
                    source="field", is_demo=True)
    com = Commodity(name_en="Onion", name_bn="পেঁয়াজ", variant="local", unit="kg")
    db.add_all([m, demo_m, com])
    db.commit()
    now = datetime.now(timezone.utc)
    base = {"commodity_id": str(com.id), "market_id": str(m.id), "price_bdt": "95"}
    future = a.post("/api/reports/price", data={**base, "observed_at": (now + timedelta(hours=2)).isoformat()})
    old = a.post("/api/reports/price", data={**base, "observed_at": (now - timedelta(days=9)).isoformat()})
    zero = a.post("/api/reports/price", data={**base, "price_bdt": "0", "observed_at": now.isoformat()})
    demo = a.post("/api/reports/price", data={**base, "market_id": str(demo_m.id), "observed_at": now.isoformat()})
    assert (future.status_code, old.status_code, zero.status_code, demo.status_code) == (422, 422, 422, 403)
    ok = a.post("/api/reports/price", data={**base, "observed_at": now.isoformat(), "lat": "23.6233", "lon": "90.4979",
                                            "accuracy": "10"})
    assert ok.status_code == 201, ok.text
    again = a.post("/api/reports/price", data={**base, "observed_at": now.isoformat()})
    assert again.status_code == 429                                           # 1 per product, market and day
    mine = a.get("/api/me/reports", params={"type": "price"}).json()
    assert mine[0]["price"]["counts_toward_verified"] is False                # 1 report < 3 (F23)
    dash = a.get("/api/prices/dashboard", params={"market_id": m.id}).json()
    assert dash["cards"][0]["today"]["status"] == "Insufficient Evidence"


def _admin(client, db):
    from app.models import User
    from app.security.passwords import hash_password
    db.add(User(phone="+8801744444444", phone_verified=True, display_name="Admin", role="admin",
                pass_hash=hash_password("admin pass 123")))
    db.commit()
    code = client.post("/api/auth/login", json={"phone": "+8801744444444", "password": "admin pass 123"}).json()["dev_code"]
    token = client.post("/api/auth/login/admin", json={"phone": "+8801744444444", "password": "admin pass 123",
                                                       "code": code}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_admin_hide_needs_reason_and_is_audited(citizens, client, db):
    (a,) = citizens(1)
    rid = a.civic().json()["id"]
    h = _admin(client, db)
    assert client.post(f"/api/admin/reports/{rid}/hide", headers=h, json={"reason": ""}).status_code == 422
    assert client.post(f"/api/admin/reports/{rid}/hide", headers=h, json={}).status_code == 422
    r = client.post(f"/api/admin/reports/{rid}/hide", headers=h, json={"reason": "Contains a phone number"})
    assert r.status_code == 200
    before = db.get(Report, uuid.UUID(rid))
    db.refresh(before)
    assert before.visibility == "admin_hidden"
    assert db.query(AuditLog).filter_by(action="report.hide", entity_id=rid).count() == 1
    r = client.post(f"/api/admin/reports/{rid}/restore", headers=h, json={"reason": "Phone number was a typo"})
    assert r.status_code == 200
    detail = client.get(f"/api/admin/reports/{rid}", headers=h).json()
    assert len(detail["components_judging"]) == 7 and detail["runs"]
    assert client.post(f"/api/admin/users/{a.id}/suspend", headers=h, json={"reason": "spam reports"}).status_code == 200
    assert a.get("/api/me").status_code == 403


def test_audit_log_is_append_only(db):
    from sqlalchemy import text
    import pytest
    from app.core.audit import audit
    audit(db, actor_id=None, action="test", entity="test")
    db.commit()
    with pytest.raises(Exception):
        db.execute(text("UPDATE audit_log SET action = 'changed'"))
        db.commit()
    db.rollback()
    with pytest.raises(Exception):
        db.execute(text("DELETE FROM audit_log"))
        db.commit()
    db.rollback()


def test_insights_respect_x1(citizens):
    a, b = citizens(2)
    a.civic()
    pts = b.get("/api/insights/map", params={"days": 7}).json()["features"]
    assert pts and pts[0]["properties"]["results_visible"] is False and "status" not in pts[0]["properties"]
    mine = a.get("/api/insights/map", params={"days": 7}).json()["features"]
    assert mine[0]["properties"]["results_visible"] is True
    s = a.get("/api/insights/summary", params={"status": "all", "show_resolved": "true"}).json()
    assert s["in_view"] == 1
    assert a.get("/api/insights/grid", params={"days": 7}).status_code == 200
    assert a.get("/api/insights/hotspots").status_code == 200


def test_card_shows_reporter_name_but_not_reputation_before_vote(citizens):
    a, b = citizens(2)
    rid = a.civic().json()["id"]
    blind = b.get(f"/api/reports/{rid}").json()
    assert blind["reporter"] == {"display_name": "Citizen 1", "initials": "C1"}   # UI decision 11 Oct 2026
    assert "reputation" not in str(blind) and blind["results"] is None
    b.post(f"/api/reports/{rid}/votes", data={"decision": "confirm", "mode": "far_away"})
    seen = b.get(f"/api/reports/{rid}").json()["results"]
    assert seen["votes"]["by_mode"]["far_away"] == {"confirm": 1, "disagree": 0, "fixed_now": 0}
    assert seen["votes"]["far_away"] == 1 and seen["comments_count"] == 0
    assert seen["reporter"]["reputation_display"] is not None


def test_status_filter_cannot_reveal_one_report_before_voting(citizens):
    from app.routers.insights import snap_to_cell
    a, b = citizens(2)
    a.civic()
    plain = b.get("/api/insights/map", params={"days": 7}).json()["features"][0]
    assert plain["properties"]["id"] and plain["properties"]["approximate"] is False
    # With a result filter (status = all but resolved hidden), b's unvoted point loses its id and exact position.
    hidden = b.get("/api/insights/map", params={"days": 7, "show_resolved": "false"}).json()["features"][0]
    assert hidden["properties"]["id"] is None and hidden["properties"]["approximate"] is True
    lat, lon = snap_to_cell(23.6241, 90.4991)
    assert hidden["geometry"]["coordinates"] == [lon, lat]
    mine = a.get("/api/insights/map", params={"days": 7, "show_resolved": "false"}).json()["features"][0]
    assert mine["properties"]["id"] and mine["properties"]["approximate"] is False   # the reporter still sees it


def test_dashboard_summary_panels(citizens):
    (a,) = citizens(1)
    a.civic()
    s = a.get("/api/insights/summary", params={"status": "all", "show_resolved": "true"}).json()
    assert s["in_view"] == 1 and s["new_this_week"] == 1
    assert s["top_category"]["code"] == "garbage" and s["top_category"]["share_display"] == 100
    assert len(s["trend"]) == 30 and s["trend"][-1]["count"] == 1 and s["trend"][-1]["alert"] is False
    credible = a.get("/api/insights/summary").json()                # default: credible only, resolved hidden
    assert credible["in_view"] == 0 and credible["wards"] == []
    year = a.get("/api/insights/summary", params={"start": f"{datetime.now().year}-01-01", "status": "all"}).json()
    assert year["in_view"] == 1
    assert a.get("/api/insights/summary", params={"status": "bogus"}).status_code == 422


def test_price_dashboard_for_all_markets(citizens, db):
    (a,) = citizens(1)
    from app.models import Commodity
    m1 = Market(name_en="Market A", name_bn="ক", location="SRID=4326;POINT(90.4978 23.6232)", radius_m=150, source="field")
    m2 = Market(name_en="Market B", name_bn="খ", location="SRID=4326;POINT(90.4980 23.6236)", radius_m=150, source="field")
    com = Commodity(name_en="Onion", name_bn="পেঁয়াজ", variant="local", unit="kg")
    db.add_all([m1, m2, com])
    db.commit()
    r = a.post("/api/reports/price", data={"commodity_id": str(com.id), "market_id": str(m2.id), "price_bdt": "90",
                                           "observed_at": datetime.now(timezone.utc).isoformat()})
    assert r.status_code == 201, r.text
    dash = a.get("/api/prices/dashboard").json()
    assert dash["market"] is None and len(dash["cards"]) == 1
    assert dash["cards"][0]["market"]["name_en"] == "Market B"        # the market with the most evidence today
    cmp = a.get("/api/prices/compare", params={"commodity_id": com.id}).json()["markets"]
    assert {m["market"]["name_en"]: m["report_count"] for m in cmp} == {"Market A": 0, "Market B": 1}


def test_locate_ward_for_the_report_form(citizens):
    (a,) = citizens(1)
    inside = a.get("/api/wards/locate", params={"lat": 23.6241, "lon": 90.4991}).json()
    assert inside["ward"]["name_en"] == "Test ward"
    assert a.get("/api/wards/locate", params={"lat": 23.9, "lon": 90.1}).json() == {"ward": None}
    assert a.get("/api/wards/locate", params={"lat": 123, "lon": 90}).status_code == 422


def test_hotspots_carry_their_ward(citizens, db):
    (a,) = citizens(1)
    from app.models import Category, Hotspot
    now = datetime.now(timezone.utc)
    cat = db.query(Category).filter_by(code="garbage").one()
    db.add(Hotspot(category_id=cat.id, centroid="SRID=4326;POINT(90.4991 23.6241)", score=70, s_severity=0.6, v_volume=0.5,
                   c_compact=0.7, t_trust=0.8, n_reports=4, n_users=3, report_ids=[], window_start=now - timedelta(days=30),
                   window_end=now, eps_m=150, min_samples=3, config_hash="test"))
    db.commit()
    h = a.get("/api/insights/hotspots").json()
    assert h[0]["ward"]["name_en"] == "Test ward" and h[0]["n_users"] == 3
    pts = a.get("/api/insights/map", params={"days": 7}).json()["features"]
    assert pts == [] or "severity" in pts[0]["properties"]


def test_notifications_split_by_module(citizens, db):
    import uuid
    from app.services.notify import notify
    a, b = citizens(2)
    civic_id = a.civic().json()["id"]
    uid = uuid.UUID(a.id)
    notify(db, uid, "price_alert", {"text": "Onion up 12%"})
    notify(db, uid, "emerging_issue", {"text": "More garbage", "category": "Garbage", "ward": "Test ward"})
    notify(db, uid, "own_report_status", {"text": "Your report is now Credible"}, uuid.UUID(civic_id))
    db.commit()
    kinds = lambda mod, tab: {n["kind"] for n in a.get("/api/notifications", params={"tab": tab, "module": mod}).json()["items"]}
    assert kinds("price_patrol", "alerts") == {"price_alert"}
    assert "price_alert" not in kinds("green_guard", "alerts") and "emerging_issue" in kinds("green_guard", "alerts")
    assert kinds("green_guard", "notifications") == {"own_report_status"}        # a civic report's status
    assert kinds("price_patrol", "notifications") == set()
    assert a.get("/api/notifications/unread-count", params={"module": "price_patrol"}).json() == {"alerts": 1, "notifications": 0}
    a.post("/api/notifications/read-all", params={"tab": "alerts", "module": "price_patrol"})
    assert a.get("/api/notifications/unread-count", params={"module": "price_patrol"}).json()["alerts"] == 0
    assert a.get("/api/notifications/unread-count", params={"module": "green_guard"}).json()["alerts"] >= 1   # untouched
