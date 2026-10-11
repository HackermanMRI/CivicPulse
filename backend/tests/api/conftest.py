"""API tests against a real PostgreSQL + PostGIS database.

Set TEST_DATABASE_URL to an EMPTY database owned by the user in the URL (it is wiped on every run), e.g.
    TEST_DATABASE_URL=postgresql+psycopg2://civicpulse_owner:<pw>@db:5432/civicpulse_test
Without it these tests are skipped; the scoring tests in tests/scoring still run.
"""
from __future__ import annotations

import io
import os
import tempfile
import uuid

import pytest

TEST_DB = os.environ.get("TEST_DATABASE_URL")
if not TEST_DB:
    pytest.skip("TEST_DATABASE_URL not set: API tests need PostgreSQL + PostGIS", allow_module_level=True)

_UPLOADS = tempfile.mkdtemp(prefix="cp-test-uploads-")
os.environ.update({
    "DATABASE_URL": TEST_DB, "MIGRATION_DATABASE_URL": TEST_DB, "SECRET_KEY": "t" * 48, "IP_HASH_SALT": "test-salt-123456",
    "DEV_MODE": "true", "JOBS_INLINE": "true", "COOKIE_SECURE": "false", "UPLOAD_DIR": _UPLOADS,
    "REDIS_URL": os.environ.get("TEST_REDIS_URL", "redis://127.0.0.1:1/0"),        # unreachable → memory rate limits
    "MODELS_DIR": tempfile.mkdtemp(prefix="cp-test-models-"),
})

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core import ratelimit  # noqa: E402
from app.database import SessionLocal, engine  # noqa: E402

KEEP = {"alembic_version", "spatial_ref_sys", "categories"}


@pytest.fixture(scope="session", autouse=True)
def schema():
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS postgis"))
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "..", "alembic"))
    command.upgrade(cfg, "head")
    from app.cli import seed_config
    seed_config()
    yield


@pytest.fixture(autouse=True)
def clean(schema):
    with engine.begin() as conn:
        tables = [r[0] for r in conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))]
        wipe = [t for t in tables if t not in KEEP]
        conn.execute(text("TRUNCATE " + ", ".join(f'"{t}"' for t in wipe) + " RESTART IDENTITY CASCADE"))
    ratelimit.reset_memory()
    yield


@pytest.fixture
def db():
    with SessionLocal() as s:
        yield s


@pytest.fixture
def client():
    from app.main import app
    with TestClient(app) as c:
        yield c


def photo_bytes(seed: int = 0, size=(320, 240)) -> bytes:
    """A real JPEG that differs from every other seed (random noise blocks, so pHash differs too)."""
    import random
    r = random.Random(seed)
    im = Image.new("RGB", size)
    px = im.load()
    for bx in range(0, size[0], 40):
        for by in range(0, size[1], 40):
            c = (r.randrange(256), r.randrange(256), r.randrange(256))
            for x in range(bx, min(bx + 40, size[0])):
                for y in range(by, min(by + 40, size[1])):
                    px[x, y] = c
    out = io.BytesIO()
    im.save(out, format="JPEG")
    return out.getvalue()


@pytest.fixture
def ward(db):
    """A real (non-DEMO) pilot ward with a small square polygon around Chashara."""
    from app.models import Ward
    w = Ward(name_en="Test ward", name_bn="টেস্ট", ref_point="SRID=4326;POINT(90.4990 23.6240)",
             geom="SRID=4326;MULTIPOLYGON(((90.494 23.619,90.504 23.619,90.504 23.629,90.494 23.629,90.494 23.619)))")
    db.add(w)
    db.commit()
    return w.id


class Citizen:
    def __init__(self, client: TestClient, phone: str, ward_id: int | None, name: str = "Test Citizen"):
        self.client, self.phone = client, phone
        self.device = uuid.uuid4().hex + uuid.uuid4().hex
        r = client.post("/api/auth/otp/request", json={"phone": phone, "purpose": "signup"})
        assert r.status_code == 200, r.text
        code = r.json()["dev_code"]
        r = client.post("/api/auth/otp/verify", json={"phone": phone, "purpose": "signup", "code": code})
        assert r.status_code == 200, r.text
        r = client.post("/api/auth/register", headers={"X-Device-Id": self.device}, json={
            "ticket": r.json()["ticket"], "display_name": name, "password": "correct horse 1",
            "consents": {"location": True, "camera": True, "research_use": True},
            "addresses": [{"kind": "home", "ward_id": ward_id}]})
        assert r.status_code == 201, r.text
        self.token = r.json()["access_token"]
        self.id = r.json()["user"]["id"]

    @property
    def h(self) -> dict:
        return {"Authorization": f"Bearer {self.token}", "X-Device-Id": self.device}

    def get(self, url, **kw):
        return self.client.get(url, headers=self.h, **kw)

    def post(self, url, **kw):
        return self.client.post(url, headers=self.h, **kw)

    def capture(self, purpose="report", report_id=None) -> str:
        body = {"purpose": purpose}
        if report_id:
            body["report_id"] = report_id
        r = self.post("/api/capture-tokens", json=body)
        assert r.status_code == 201, r.text
        return r.json()["token"]

    def civic(self, ward_lat=23.6241, ward_lon=90.4991, seed=1, category="garbage", photo=None, token=None, **extra):
        token = token or self.capture()
        data = {"category": category, "description": "Garbage has not been collected for days.",
                "lat": str(ward_lat), "lon": str(ward_lon), "accuracy": "12", "capture_token": token, **extra}
        files = {"photo": ("p.jpg", photo if photo is not None else photo_bytes(seed), "image/jpeg")}
        return self.post("/api/reports/civic", data=data, files=files)


@pytest.fixture
def citizens(client, ward):
    def make(n: int) -> list[Citizen]:
        return [Citizen(client, f"+88017{i:08d}", ward, f"Citizen {i}") for i in range(1, n + 1)]
    return make
