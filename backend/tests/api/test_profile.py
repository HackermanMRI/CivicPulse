"""Profile (UI v2): editing, profile photo safety, the name-change limit and who may see a public profile."""
from __future__ import annotations

import io
from pathlib import Path

from PIL import Image
from sqlalchemy import text

from app.config import settings
from app.models import AuditLog, User

from .conftest import photo_bytes


def _jpeg_with_gps(size=(900, 600)) -> bytes:
    im = Image.new("RGB", size, (40, 120, 90))
    exif = Image.Exif()
    exif[0x8825] = {1: "N", 2: (23.0, 37.0, 27.0), 3: "E", 4: (90.0, 30.0, 0.0)}   # GPSInfo: a home location
    exif[0x010F] = "PhoneMaker"
    out = io.BytesIO()
    im.save(out, format="JPEG", exif=exif)
    return out.getvalue()


def _vote(voter, rid):
    r = voter.post(f"/api/reports/{rid}/votes", data={"decision": "confirm", "mode": "far_away"})
    assert r.status_code == 201, r.text


def test_profile_fields_are_saved_and_cleaned(citizens):
    (a,) = citizens(1)
    me = a.get("/api/me").json()
    assert me["bio"] is None and me["interests"] == [] and me["avatar_url"] is None and me["email_public"] is False
    r = a.client.patch("/api/me", headers=a.h, json={
        "bio": "  Volunteer in Ward 12.\r\n\r\n\r\nI check drains after rain.  ", "occupation": "  Civil   engineer ",
        "website": "example.org/me", "interests": ["waterlogging", "prices", "waterlogging"], "email": "a@example.org",
        "email_public": True})
    assert r.status_code == 200, r.text
    me = a.get("/api/me").json()
    assert me["bio"] == "Volunteer in Ward 12.\n\nI check drains after rain."
    assert me["occupation"] == "Civil engineer"
    assert me["website"] == "https://example.org/me"            # a scheme is added, only http(s) is kept
    assert me["interests"] == ["waterlogging", "prices"]          # de-duplicated, order kept
    r = a.client.patch("/api/me", headers=a.h, json={"bio": "", "website": "", "occupation": ""})
    assert r.status_code == 200
    me = a.get("/api/me").json()
    assert me["bio"] is None and me["website"] is None and me["occupation"] is None   # blank clears


def test_profile_rejects_unsafe_or_invalid_input(citizens):
    (a,) = citizens(1)
    bad = [
        {"website": "javascript:alert(1)"}, {"website": "data:text/html,hi"}, {"website": "https://user:pw@example.org"},
        {"website": "https://localhost"}, {"website": "https://exa mple.org"},
        {"bio": "x" * 161}, {"bio": "1\n2\n3\n4\n5"}, {"bio": "hi‮evil"},
        {"occupation": "line\nbreak"}, {"display_name": "A"}, {"interests": ["not_a_category"]},
        {"interests": ["garbage"] * 21}, {"unknown_field": 1}, {"avatar_path": "../../etc/passwd"},
    ]
    for body in bad:
        r = a.client.patch("/api/me", headers=a.h, json=body)
        assert r.status_code == 422, (body, r.status_code, r.text)


def test_name_change_is_limited_and_audited(citizens, db):
    (a,) = citizens(1)
    r = a.client.patch("/api/me", headers=a.h, json={"display_name": "  New   Name "})
    assert r.status_code == 200, r.text
    me = a.get("/api/me").json()
    assert me["display_name"] == "New Name" and me["name_change_available_at"] is not None
    assert a.client.patch("/api/me", headers=a.h, json={"display_name": "New Name"}).status_code == 200   # same name: no-op
    again = a.client.patch("/api/me", headers=a.h, json={"display_name": "Third Name"})
    assert again.status_code == 429 and "change your name again" in again.json()["detail"]
    assert a.client.patch("/api/me", headers=a.h, json={"display_name": None}).status_code == 200
    assert a.get("/api/me").json()["display_name"] == "New Name"   # a name can't be removed
    logs = db.query(AuditLog).filter(AuditLog.action == "user.rename").all()
    assert len(logs) == 1 and logs[0].before == {"display_name": "Citizen 1"} and logs[0].after == {"display_name": "New Name"}


def test_profile_photo_is_square_and_has_no_location(citizens, db):
    (a,) = citizens(1)
    r = a.client.put("/api/me/avatar", headers=a.h, files={"photo": ("me.jpg", _jpeg_with_gps(), "image/jpeg")})
    assert r.status_code == 200, r.text
    url = r.json()["avatar_url"]
    assert url.startswith(f"/api/people/{a.id}/avatar?v=")
    rel = db.get(User, a.id).avatar_path
    stored = Path(settings.UPLOAD_DIR) / rel
    with Image.open(stored) as im:
        assert im.size == (512, 512) and im.format == "JPEG"
        assert len(im.getexif()) == 0                              # EXIF (and its GPS position) is gone
    got = a.get(url)
    assert got.status_code == 200 and got.headers["content-type"] == "image/jpeg"
    # a new photo replaces the old file
    r2 = a.client.put("/api/me/avatar", headers=a.h, files={"photo": ("me2.jpg", photo_bytes(3), "image/jpeg")})
    assert r2.status_code == 200 and not stored.exists()
    rel2 = db.get(User, a.id).avatar_path
    db.expire_all()
    assert a.client.delete("/api/me/avatar", headers=a.h).json() == {"avatar_url": None}
    assert not (Path(settings.UPLOAD_DIR) / rel2).exists()


def test_profile_photo_rejects_non_images_and_big_files(citizens):
    (a,) = citizens(1)
    r = a.client.put("/api/me/avatar", headers=a.h, files={"photo": ("x.jpg", b"<script>alert(1)</script>", "image/jpeg")})
    assert r.status_code == 415
    big = b"\xff\xd8\xff" + b"0" * (25 * 1024 * 1024 + 10)        # only a direct API upload can be this big
    assert a.client.put("/api/me/avatar", headers=a.h, files={"photo": ("big.jpg", big, "image/jpeg")}).status_code == 413
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    assert a.client.put("/api/me/avatar", headers=a.h, files={"photo": ("x.svg", svg, "image/svg+xml")}).status_code == 415


def test_public_profile_opens_only_after_voting(citizens):
    a, b, c = citizens(3)
    a.client.patch("/api/me", headers=a.h, json={"bio": "Hi", "email": "a@example.org", "interests": ["garbage"]})
    a.client.put("/api/me/avatar", headers=a.h, files={"photo": ("me.jpg", photo_bytes(5), "image/jpeg")})
    rid = a.civic().json()["id"]
    # before the vote: the card has no reporter id or photo, and the profile looks like it doesn't exist
    blind = b.get(f"/api/reports/{rid}").json()
    assert "avatar" not in str(blind) and a.id not in str(blind)
    assert b.get(f"/api/people/{a.id}").status_code == 404
    assert b.get(f"/api/people/{a.id}/avatar").status_code == 404
    assert b.get(f"/api/people/{a.id}/reports").status_code == 404
    _vote(b, rid)
    card = b.get(f"/api/reports/{rid}").json()
    assert card["results"]["reporter"]["id"] == a.id and card["results"]["reporter"]["avatar_url"].startswith("/api/people/")
    prof = b.get(f"/api/people/{a.id}").json()
    assert prof["bio"] == "Hi" and prof["interests"] == ["garbage"] and prof["is_me"] is False
    assert prof["email"] is None                                   # private unless switched on
    text = str(prof)
    assert "phone" not in text and "consents" not in text and "+880" not in text
    assert prof["areas"] == [{"kind": "home", "ward_name_en": "Test ward", "ward_name_bn": "টেস্ট"}]   # shown (user decision)
    assert b.get(prof["avatar_url"]).status_code == 200
    assert len(b.get(f"/api/people/{a.id}/reports").json()) == 1
    a.client.patch("/api/me", headers=a.h, json={"email_public": True})
    assert b.get(f"/api/people/{a.id}").json()["email"] == "a@example.org"
    # someone who never voted on a's reports still can't see it
    assert c.get(f"/api/people/{a.id}").status_code == 404
    assert a.get(f"/api/people/{a.id}").json()["is_me"] is True   # always your own


def test_public_reports_stay_blind_per_report(citizens, db):
    a, b = citizens(2)
    first = a.civic(seed=11).json()["id"]
    _vote(b, first)
    # one civic report per day: move the first one back a day, then post a second that b has not voted on
    db.execute(text("UPDATE reports SET submitted_at = submitted_at - interval '1 day' WHERE id = :i"), {"i": first})
    db.commit()
    second = a.civic(seed=12)
    assert second.status_code == 201, second.text
    cards = b.get(f"/api/people/{a.id}/reports").json()
    seen = {c["id"]: c["results_visible"] for c in cards}
    assert seen == {first: True, second.json()["id"]: False}      # the profile never leaks an unvoted result


def test_deleted_account_profile_and_photo_are_gone(citizens, db):
    a, b = citizens(2)
    a.client.put("/api/me/avatar", headers=a.h, files={"photo": ("me.jpg", photo_bytes(7), "image/jpeg")})
    rel = db.get(User, a.id).avatar_path
    rid = a.civic().json()["id"]
    _vote(b, rid)
    assert a.client.delete("/api/me", headers=a.h).status_code == 204
    assert b.get(f"/api/people/{a.id}").status_code == 404
    assert not (Path(settings.UPLOAD_DIR) / rel).exists()
    db.expire_all()
    u = db.get(User, a.id)
    assert u.bio is None and u.avatar_path is None and u.interests == []


def test_admin_can_clear_abusive_profile_content_with_a_reason(citizens, client, db):
    from .test_reports import _admin

    (a,) = citizens(1)
    a.client.patch("/api/me", headers=a.h, json={"bio": "rude text", "website": "https://spam.example.com"})
    a.client.put("/api/me/avatar", headers=a.h, files={"photo": ("me.jpg", photo_bytes(9), "image/jpeg")})
    rel = db.get(User, a.id).avatar_path
    h = _admin(client, db)
    assert client.post(f"/api/admin/users/{a.id}/clear-profile", headers=h, json={"fields": ["bio"]}).status_code == 422
    assert a.client.post(f"/api/admin/users/{a.id}/clear-profile", headers=a.h,
                         json={"fields": ["bio"], "reason": "abusive bio text"}).status_code in (401, 403)
    r = client.post(f"/api/admin/users/{a.id}/clear-profile", headers=h,
                    json={"fields": ["bio", "avatar", "website"], "reason": "abusive bio and photo"})
    assert r.status_code == 200, r.text
    me = a.get("/api/me").json()
    assert me["bio"] is None and me["avatar_url"] is None and me["website"] is None
    assert not (Path(settings.UPLOAD_DIR) / rel).exists()
    assert db.query(AuditLog).filter_by(action="user.clear_profile").count() == 1
