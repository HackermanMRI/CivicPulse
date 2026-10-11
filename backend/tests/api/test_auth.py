"""Sign-up, login, sessions and the security checklist items for auth (spec §8 "Security tests")."""
from app.models import CollusionAlert, User
from app.security.passwords import hash_password
from tests.api.conftest import Citizen


def test_signup_login_and_profile(client, ward):
    c = Citizen(client, "+8801711111111", ward)
    me = c.get("/api/me").json()
    assert me["display_name"] == "Test Citizen"
    assert me["phone_masked"].endswith("11") and "XXX" in me["phone_masked"]
    assert me["reputation"]["display"] == 50 and me["reputation"]["rep"] == 0.5      # Beta(1,1), shown ×100 (C1)
    r = client.post("/api/auth/login", headers={"X-Device-Id": c.device},
                    json={"phone": "01711111111", "password": "correct horse 1"})
    assert r.status_code == 200 and r.json()["access_token"]


def test_login_error_is_generic(client, ward):
    Citizen(client, "+8801711111111", ward)
    wrong = client.post("/api/auth/login", headers={"X-Device-Id": "x" * 32},
                        json={"phone": "01711111111", "password": "not the password"})
    missing = client.post("/api/auth/login", headers={"X-Device-Id": "x" * 32},
                          json={"phone": "01799999999", "password": "not the password"})
    assert wrong.status_code == missing.status_code == 401
    assert wrong.json() == missing.json()


def test_second_account_on_same_device_is_blocked(client, ward, db):
    a = Citizen(client, "+8801711111111", ward)
    r = client.post("/api/auth/otp/request", json={"phone": "+8801722222222", "purpose": "signup"})
    code = r.json()["dev_code"]
    ticket = client.post("/api/auth/otp/verify", json={"phone": "+8801722222222", "purpose": "signup", "code": code}).json()["ticket"]
    r = client.post("/api/auth/register", headers={"X-Device-Id": a.device}, json={
        "ticket": ticket, "display_name": "Second", "password": "another pass 2",
        "consents": {"location": True, "camera": True, "research_use": True}, "addresses": [{"kind": "home", "ward_id": ward}]})
    assert r.status_code == 409
    assert db.query(CollusionAlert).filter_by(kind="device_violation").count() == 1


def test_sixth_otp_attempt_is_locked(client):
    client.post("/api/auth/otp/request", json={"phone": "+8801733333333", "purpose": "signup"})
    codes = [client.post("/api/auth/otp/verify", json={"phone": "+8801733333333", "purpose": "signup", "code": "000000"})
             for _ in range(6)]
    assert [r.status_code for r in codes[:5]] == [400] * 5
    assert codes[5].status_code == 429


def test_refresh_rotation_and_reuse_revokes_family(client, ward):
    Citizen(client, "+8801711111111", ward)
    first = client.cookies.get("cp_refresh")
    r = client.post("/api/auth/refresh")
    assert r.status_code == 200
    second = client.cookies.get("cp_refresh")
    assert second and second != first
    client.cookies.set("cp_refresh", first, path="/api/auth")            # replay the rotated token
    assert client.post("/api/auth/refresh").status_code == 401
    client.cookies.set("cp_refresh", second, path="/api/auth")           # the whole family is now dead
    assert client.post("/api/auth/refresh").status_code == 401


def test_refresh_rejects_foreign_origin(client, ward):
    Citizen(client, "+8801711111111", ward)
    r = client.post("/api/auth/refresh", headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


def test_citizen_cannot_use_admin_routes(client, ward):
    c = Citizen(client, "+8801711111111", ward)
    for url in ("/api/admin/overview", "/api/admin/reports", "/api/admin/users", "/api/admin/audit"):
        assert c.get(url).status_code == 403


def test_admin_needs_otp_every_login(client, db):
    db.add(User(phone="+8801744444444", phone_verified=True, display_name="Admin", role="admin",
                pass_hash=hash_password("admin pass 123")))
    db.commit()
    r = client.post("/api/auth/login", json={"phone": "+8801744444444", "password": "admin pass 123"})
    assert r.status_code == 200 and r.json()["otp_required"] is True and "access_token" not in r.json()
    code = r.json()["dev_code"]
    r = client.post("/api/auth/login/admin", json={"phone": "+8801744444444", "password": "admin pass 123", "code": code})
    assert r.status_code == 200
    token = r.json()["access_token"]
    assert client.get("/api/admin/overview", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_suspended_user_is_blocked(client, ward, db):
    c = Citizen(client, "+8801711111111", ward)
    u = db.get(User, __import__("uuid").UUID(c.id))
    u.state = "suspended"
    db.commit()
    assert c.get("/api/me").status_code == 403


def test_notifications_are_private(client, ward, db):
    from app.services.notify import notify
    a = Citizen(client, "+8801711111111", ward)
    b = Citizen(client, "+8801722222222", ward)
    import uuid
    notify(db, uuid.UUID(a.id), "own_report_status", {"text": "hi"})
    db.commit()
    nid = a.get("/api/notifications", params={"tab": "notifications"}).json()["items"][0]["id"]
    assert b.post(f"/api/notifications/{nid}/read").status_code == 404           # no IDOR
    assert a.post(f"/api/notifications/{nid}/read").status_code == 200
