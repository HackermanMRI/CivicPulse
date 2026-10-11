"""DEMO data separation (N13) and research data tools (W6, W9)."""
import uuid
from pathlib import Path

import pytest

from app.models import Device, Report, User
from app.worker.scheduler import due_jobs


def _seed_row(db, ward_id, *, seed: bool, phone=None):
    u = User(display_name="DEMO user" if seed else "Real user", phone=phone, role="citizen", is_seed=seed)
    db.add(u)
    db.flush()
    db.add(Device(user_id=u.id, device_hash=uuid.uuid4().hex * 2))
    r = Report(user_id=u.id, report_type="civic", category_id=1, description="x", location="SRID=4326;POINT(90.499 23.624)",
               ward_id=ward_id, status="supported", judging_status="supported", is_seed=seed)
    db.add(r)
    db.commit()
    return u, r


def test_reset_demo_removes_demo_and_keeps_real(db, ward):
    from app.demo.reset import reset_demo
    _, real_r = _seed_row(db, ward, seed=False, phone="+8801755555555")
    seed_u, seed_r = _seed_row(db, ward, seed=True)
    real_id, seed_id, seed_uid = real_r.id, seed_r.id, seed_u.id
    out = reset_demo(db)
    assert out["reports"] == 1
    assert db.get(Report, real_id) is not None
    assert db.get(Report, seed_id) is None
    assert db.get(User, seed_uid) is None


def test_reset_anonymises_demo_users_named_in_the_audit_log(db, ward):
    from app.core.audit import audit
    from app.demo.reset import reset_demo
    from app.demo.seed import demo_loaded
    seed_u, _ = _seed_row(db, ward, seed=True)
    audit(db, actor_id=seed_u.id, action="auth.login", entity="user", entity_id=seed_u.id)   # e.g. a DEMO login
    db.commit()
    uid = seed_u.id
    assert demo_loaded(db)
    out = reset_demo(db)
    assert out["users_anonymised"] == 1
    db.expire_all()
    u = db.get(User, uid)
    assert u.state == "deleted" and u.phone is None and u.display_name is None
    assert db.query(Device).filter_by(user_id=uid).count() == 0       # device id freed for a re-seed
    assert not demo_loaded(db)                                         # so seed-demo can run again


def test_demo_accounts_cannot_vote_on_real_reports(citizens, db):
    a, b = citizens(2)
    rid = a.civic().json()["id"]
    u = db.get(User, uuid.UUID(b.id))
    u.is_seed = True
    db.commit()
    assert b.post(f"/api/reports/{rid}/votes", data={"decision": "confirm", "mode": "far_away"}).status_code == 403


def test_labels_refuse_demo_reports_and_import_all_or_nothing(db, ward, tmp_path: Path):
    from app.research import ResearchError, import_labels
    _, real_r = _seed_row(db, ward, seed=False, phone="+8801755555555")
    _, seed_r = _seed_row(db, ward, seed=True)
    f = tmp_path / "labels.csv"
    f.write_text(f"report_id,label,issue_present\n{real_r.id},supported,yes\n{seed_r.id},supported,yes\n", encoding="utf-8")
    with pytest.raises(ResearchError, match="DEMO"):
        import_labels(db, "member_b", f, "test")
    from app.models import Label
    assert db.query(Label).count() == 0                                   # nothing imported
    f.write_text(f"report_id,label,issue_present\n{real_r.id},supported,yes\n", encoding="utf-8")
    assert import_labels(db, "member_b", f, "test") == 1
    with pytest.raises(ResearchError, match="already"):
        import_labels(db, "member_b", f, "test")                          # same file twice


def test_export_for_labelling_has_no_scores(citizens, tmp_path: Path, db):
    from app.research import export_for_labelling
    (a,) = citizens(1)
    a.civic()
    n = export_for_labelling(db, tmp_path / "exp")
    text = (tmp_path / "exp" / "reports.csv").read_text(encoding="utf-8")
    assert n == 1 and "credibility" not in text and "status" not in text
    assert len(list((tmp_path / "exp" / "photos").iterdir())) == 1


def test_scheduler_due_jobs():
    from datetime import datetime
    from app.core.timeutil import DHAKA
    last: dict = {}
    first = due_jobs(datetime(2026, 10, 11, 0, 5, tzinfo=DHAKA), last)
    assert "mark_live" in first and "daily_alerts" not in first             # daily jobs wait until 12:10 AM
    second = due_jobs(datetime(2026, 10, 11, 0, 11, tzinfo=DHAKA), last)
    assert {"daily_alerts", "daily_hotspots", "collusion_scan"} <= set(second)
    third = due_jobs(datetime(2026, 10, 11, 0, 12, tzinfo=DHAKA), last)
    assert "daily_alerts" not in third and "mark_live" in third
