"""Load the DEMO dataset by driving the real pipeline (spec D12, N13).

Nothing is faked after the fact: every report goes through the same scoring code as a live report, in time
order, so statuses, flags, reputation, events, verified prices, hotspots and alerts are what the system
itself computes. Only two inputs are synthetic and labelled as such:
  * the text and image model probabilities (stored with model_version "DEMO-synthetic"), and
  * the photos (generated drawings stamped "DEMO · SYNTHETIC IMAGE").
"""
from __future__ import annotations

import hashlib
import math
import random
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.params import get_params
from app.core.timeutil import DHAKA, dhaka_date, now_utc
from app.demo import data as D
from app.demo.images import ImageFactory
from app.models import (
    AbuseReport, CaptureToken, Category, CollusionAlert, Commodity, Consent, Device, Evidence, LiveDay, Market,
    PriceDetail, PriceWatch, Report, SavedPost, User, UserAddress, Vote, Ward,
)
from app.scoring.components import Vote as EngineVote, vote_weight
from app.security.passwords import hash_password, validate_password
from app.services import analytics, photos, pipeline
from app.services.reputation import reputation_of

SEED_VERSION = "demo-1"
MODEL_VERSION = "DEMO-synthetic"


class SeedError(RuntimeError):
    pass


def offset(lat: float, lon: float, dx_m: float, dy_m: float) -> tuple[float, float]:
    """Move a point dx metres east and dy metres north (small distances)."""
    return lat + dy_m / 111_320.0, lon + dx_m / (111_320.0 * math.cos(math.radians(lat)))


def wkt_point(lat: float, lon: float) -> str:
    return f"SRID=4326;POINT({lon:.7f} {lat:.7f})"


def wkt_box(lat: float, lon: float, half_m: float) -> str:
    s, w = offset(lat, lon, -half_m, -half_m)
    n, e = offset(lat, lon, half_m, half_m)
    return f"SRID=4326;MULTIPOLYGON((({w:.7f} {s:.7f},{e:.7f} {s:.7f},{e:.7f} {n:.7f},{w:.7f} {n:.7f},{w:.7f} {s:.7f})))"


@dataclass
class CivicPlan:
    tag: str
    ts: datetime
    user: int
    ward: str
    category: str
    lat: float
    lon: float
    accuracy: float
    description: str
    text_p: float
    image_p: float
    reuse_photo_of: str | None = None
    admin_hide: str | None = None
    capture_gap_s: float | None = None        # seconds from camera open to posting (metadata, F11)


@dataclass
class VotePlan:
    ts: datetime
    report_tag: str
    voter: int
    decision: str
    mode: str


@dataclass
class PriceCell:
    ts: datetime                     # when the last report of the cell is posted
    day: date
    market: str
    commodity: int
    reports: list[dict] = field(default_factory=list)


class Seeder:
    def __init__(self, db: Session, password: str, now: datetime | None = None, rng_seed: int = 2026):
        problem = validate_password(password)
        if problem:
            raise SeedError(f"DEMO_PASSWORD is not strong enough: {problem}")
        self.db, self.password = db, password
        self.now = now or now_utc()
        self.today = dhaka_date(self.now)
        self.rng = random.Random(rng_seed)
        self.images = ImageFactory(random.Random(rng_seed + 1))
        self.params = get_params()
        self.files: list[str] = []
        self.used_days: set[tuple[int, date]] = set()
        self.civic: list[CivicPlan] = []
        self.votes: list[VotePlan] = []
        self.cells: list[PriceCell] = []
        self.report_ids: dict[str, uuid.UUID] = {}
        self.photo_bytes: dict[str, bytes] = {}

    # ---------------- time helpers ----------------

    def at(self, days_ago: int, hour: float) -> datetime:
        """Asia/Dhaka wall time `hour` on the day `days_ago` days before today, never later than 10 minutes ago."""
        d = self.today - timedelta(days=days_ago)
        local = datetime(d.year, d.month, d.day, tzinfo=DHAKA) + timedelta(hours=hour)
        ts = local.astimezone(timezone.utc)
        latest = self.now - timedelta(minutes=10)
        if ts > latest:
            ts = latest - timedelta(minutes=self.rng.uniform(0, 30) + (0 if days_ago == 0 else 60))
        return ts

    # ---------------- reference data ----------------

    def geo(self) -> None:
        db = self.db
        self.wards: dict[str, Ward] = {}
        for key, en, bn, corp, district, (lat, lon), half in D.WARDS:
            w = Ward(name_en=en, name_bn=bn, city_corp=corp, district=district, ref_point=wkt_point(lat, lon),
                     geom=wkt_box(lat, lon, half) if half else None, fallback_radius_m=self.params.gps.ward_fallback_radius_m,
                     source=D.SOURCE, verified_by="DEMO seed (not verified)", is_demo=True)
            db.add(w)
            self.wards[key] = w
        self.ward_centre = {w[0]: w[5] for w in D.WARDS}
        db.flush()
        self.markets: dict[str, Market] = {}
        self.market_meta: dict[str, tuple[float, float, int, float, str]] = {}
        for key, en, bn, ward_key, (lat, lon), radius, factor in D.MARKETS:
            m = Market(name_en=en, name_bn=bn, ward_id=self.wards[ward_key].id, location=wkt_point(lat, lon),
                       radius_m=radius, source="field", verified=False, is_demo=True)
            db.add(m)
            self.markets[key] = m
            self.market_meta[key] = (lat, lon, radius, factor, ward_key)
        self.commodities: list[tuple[Commodity, float, str | None]] = []
        for en, bn, variant, unit, base, trend in D.COMMODITIES:
            c = db.query(Commodity).filter_by(name_en=en, variant=variant, unit=unit).first()
            if c is None:                          # reuse a real commodity row if the team already added it
                c = Commodity(name_en=en, name_bn=bn, variant=variant, unit=unit, active=True, is_demo=True)
                db.add(c)
            self.commodities.append((c, float(base), trend))
        db.flush()
        self.cat_ids = {c.code: c.id for c in db.query(Category).all()}
        missing = [c.code for c in self.params.categories if c.code not in self.cat_ids]
        if missing:
            raise SeedError(f"categories missing ({missing}); run `python -m app.cli seed-config` first")

    # ---------------- users ----------------

    def _device(self, user: User, n: int, ts: datetime) -> Device:
        # The real app sends a long random id; "demo-device-N" can never collide with one.
        dev = Device(user_id=user.id, device_hash=hashlib.sha256(f"civicpulse-demo-device-{n}".encode()).hexdigest(),
                     first_seen=ts, last_seen=ts)
        self.db.add(dev)
        return dev

    def users(self) -> None:
        db = self.db
        joined = self.at(40, 10)
        pw = hash_password(self.password)
        self.people: list[dict] = []
        for name, phone, addresses, module in D.DEMO_ACCOUNTS:
            if db.query(User.id).filter_by(phone=phone).first():
                raise SeedError(f"phone {phone} is already used by another account; DEMO accounts need it")
            u = User(display_name=name, phone=phone, phone_verified=True, pass_hash=pw, role="citizen",
                     preferred_module=module, is_seed=True, created_at=joined)
            db.add(u)
            self.people.append({"user": u, "wards": [w for _, w in addresses], "kinds": addresses, "login": True,
                                "role": "both"})
        ward_keys = [w[0] for w in D.WARDS]
        names = [(n, "civic") for n in D.SEED_NAMES] + [(n, "price") for n in D.PRICE_VOLUNTEERS] + [(D.NEWCOMER, "newcomer")]
        for i, (name, role) in enumerate(names):
            home = ward_keys[i % len(ward_keys)]
            other = ward_keys[(i * 2 + 1) % len(ward_keys)]
            kinds = [("home", home)] + ([("work", other)] if other != home else [])
            u = User(display_name=f"{name} (DEMO)", phone=None, phone_verified=False, pass_hash=None, role="citizen",
                     preferred_module="price_patrol" if role == "price" else "green_guard", is_seed=True,
                     created_at=joined + timedelta(hours=i) if role != "newcomer" else self.at(14, 9))
            db.add(u)
            self.people.append({"user": u, "wards": [w for _, w in kinds], "kinds": kinds, "login": False, "role": role})
        db.flush()
        for n, p in enumerate(self.people):
            u = p["user"]
            p["device"] = self._device(u, n, u.created_at)
            for kind, wk in p["kinds"]:
                db.add(UserAddress(user_id=u.id, ward_id=self.wards[wk].id, kind=kind, created_at=u.created_at))
            for purpose in ("location", "camera", "research_use"):
                db.add(Consent(user_id=u.id, purpose=purpose, granted=True, version="DEMO", created_at=u.created_at))
        db.flush()

    # ---------------- civic plan ----------------

    def _free_user(self, ts: datetime, exclude: set[int] = frozenset(), prefer_ward: str | None = None) -> int:
        """A user who has not posted a civic report that Dhaka day (limit 1/day, L4)."""
        day = dhaka_date(ts)
        order = [i for i, p in enumerate(self.people) if p["role"] in ("civic", "both")]
        self.rng.shuffle(order)
        if prefer_ward:
            order.sort(key=lambda i: prefer_ward not in self.people[i]["wards"])
        for i in order:
            if i not in exclude and (i, day) not in self.used_days:
                self.used_days.add((i, day))
                return i
        raise SeedError("ran out of DEMO users for one day")

    def _report(self, tag: str, ts: datetime, ward: str, category: str, dx: float, dy: float, *, user: int | None = None,
                exclude: set[int] = frozenset(), text_p: float | None = None, image_p: float | None = None,
                description: str | None = None, accuracy: float | None = None, **extra) -> CivicPlan:
        lat0, lon0 = self.ward_centre[ward]
        lat, lon = offset(lat0, lon0, dx, dy)
        if user is None:
            user = self._free_user(ts, exclude, ward)
        else:
            self.used_days.add((user, dhaka_date(ts)))
        plan = CivicPlan(tag, ts, user, ward, category, lat, lon,
                         accuracy if accuracy is not None else round(self.rng.uniform(5, 28), 1),
                         description or self.rng.choice(D.DESCRIPTIONS[category]),
                         text_p if text_p is not None else round(self.rng.uniform(0.40, 0.78), 3),
                         image_p if image_p is not None else round(self.rng.uniform(0.45, 0.82), 3), **extra)
        self.civic.append(plan)
        return plan

    def _vote(self, plan: CivicPlan, voter: int, decision: str, mode: str, minutes_after: float) -> None:
        if voter == plan.user:
            return
        if any(v.report_tag == plan.tag and v.voter == voter for v in self.votes):
            return
        ts = min(plan.ts + timedelta(minutes=minutes_after), self.now - timedelta(minutes=2))
        self.votes.append(VotePlan(ts, plan.tag, voter, decision, mode))

    def _voters(self, plan: CivicPlan, n: int, exclude: set[int] = frozenset()) -> list[int]:
        pool = [i for i, p in enumerate(self.people)
                if p["role"] in ("civic", "both") and i != plan.user and i not in exclude]
        pool.sort(key=lambda i: (plan.ward not in self.people[i]["wards"], self.rng.random()))
        return pool[:n]

    def plan_civic(self) -> None:
        r = self.rng
        cats = [c.code for c in self.params.categories]
        wards = ["bwest", "beast", "chashara", "tanbazar", "fatullah"]
        # Days the scripted scenarios need for fixed users (one civic report per user per day, L4).
        self.used_days |= {(0, self.today - timedelta(days=2)), (2, self.today - timedelta(days=3))}
        s5_user = next(i for i in range(3, len(self.people)))
        self.used_days |= {(s5_user, self.today - timedelta(days=10)), (s5_user, self.today - timedelta(days=9))}

        # Phase A (34–23 days ago): pairs of corroborating reports, so reporters earn their first reputation.
        for i in range(14):
            cat = cats[i % len(cats)]
            ward = wards[i % len(wards)]
            if ward == "chashara" and cat == "waterlogging":
                cat = "garbage"                   # keep the Chashara waterlogging baseline quiet for the alert scenario
            day = 34 - i * 11 // 14
            dx, dy = r.uniform(-350, 350), r.uniform(-300, 300)
            first = self._report(f"A{i}a", self.at(day, r.uniform(7, 12)), ward, cat, dx, dy)
            self._report(f"A{i}b", first.ts + timedelta(hours=r.uniform(2, 20)), ward, cat,
                         dx + r.uniform(-25, 25), dy + r.uniform(-25, 25), exclude={first.user})

        # Phase B (22–8 days ago): single reports with different kinds of community response.
        for i in range(20):
            cat = r.choice([c for c in cats if c != "waterlogging"])
            ward = r.choice(wards)
            kind = i % 4
            weak = kind == 2                       # vague text and photo: scores near chance (F6 → about 0.5)
            p = self._report(f"B{i}", self.at(r.randint(8, 22), r.uniform(7, 20)), ward, cat,
                             r.uniform(-400, 400), r.uniform(-350, 350),
                             text_p=round(r.uniform(0.13, 0.2), 3) if weak else None,
                             image_p=round(r.uniform(0.12, 0.2), 3) if weak else None,
                             accuracy=round(r.uniform(60, 140), 1) if weak else None)
            if kind == 1:
                continue                           # nobody verified it: the gate keeps it at "Needs more verification"
            modes = {0: ["on_spot", "on_spot", "same_ward"], 2: ["same_ward", "far_away"],
                     3: ["same_ward", "far_away", "far_away"]}[kind]
            for k, voter in enumerate(self._voters(p, len(modes))):
                decision = "disagree" if kind == 3 and k == 1 else "confirm"
                self._vote(p, voter, decision, modes[k], r.uniform(20, 600) + k * 30)
        # S8 strong disagreement on the spot (second conflict example).
        s8 = self._report("S8", self.at(17, 16), "chashara", "water_pollution", 260, -240)
        for k, voter in enumerate(self._voters(s8, 6)):
            self._vote(s8, voter, "confirm" if k % 2 else "disagree", "on_spot", 40 + 35 * k)

        # S1 voter rewards: five on-the-spot confirmations, so each voter has at least 3 others (L2, V5).
        s1 = self._report("S1", self.at(16, 9), "tanbazar", "drainage", 120, -80, text_p=0.7, image_p=0.75)
        for k, voter in enumerate(self._voters(s1, 5)):
            self._vote(s1, voter, "confirm", "on_spot", 40 + 50 * k)
        # S2 low credibility + image mismatch: off-topic text, mismatching photo, on-the-spot disagreement.
        newcomer = next(i for i, p in enumerate(self.people) if p["role"] == "newcomer")
        s2 = self._report("S2", self.at(13, 11), "beast", "damaged_road", -200, 150, user=newcomer, text_p=0.0,
                          image_p=0.0, description=r.choice(D.OFF_TOPIC), accuracy=1000, capture_gap_s=570)
        for k, voter in enumerate(self._voters(s2, 6)):
            self._vote(s2, voter, "disagree", "on_spot", 60 + 40 * k)
        # S3 strong disagreement: conflict κ ≥ θc → Needs more verification, stays visible (V1).
        s3 = self._report("S3", self.at(11, 15), "bwest", "garbage", 250, 220)
        for k, voter in enumerate(self._voters(s3, 6)):
            self._vote(s3, voter, "confirm" if k % 2 == 0 else "disagree", "on_spot", 30 + 45 * k)
        # S4 resolved: confirmed, then three "Fixed now" on-the-spot votes from different devices (N3).
        s4 = self._report("S4", self.at(19, 19), "chashara", "streetlight", -300, 300, text_p=0.72, image_p=0.7)
        vs = self._voters(s4, 5)
        self._vote(s4, vs[0], "confirm", "on_spot", 50)
        self._vote(s4, vs[1], "confirm", "on_spot", 90)
        for k, voter in enumerate(vs[2:5]):
            self._vote(s4, voter, "fixed_now", "on_spot", 4 * 24 * 60 + 60 * k)
        # S5 duplicate: the same user reports the same event again the next day (C8).
        self._report("S5", self.at(10, 8), "fatullah", "drainage", 40, 30, user=s5_user)
        self._report("S5dup", self.at(9, 9), "fatullah", "drainage", 50, 35, user=s5_user)
        # S6 reused photo: a copy of S1's photo sent again → suspicious, hidden at once (W1).
        self._report("S6", self.at(12, 13), "tanbazar", "drainage", -150, 60, reuse_photo_of="S1", exclude={s1.user})
        # S7 hidden by an admin with a written reason (W2).
        self._report("S7", self.at(14, 10), "beast", "deforestation", 300, -250,
                     admin_hide="DEMO seed: example of a report an admin hid (duplicate of a resolved complaint).")

        # Phase C (7–0 days ago).
        # H1 + alert: Chashara waterlogging builds up, four credible reports yesterday (alert x ≥ 3, F29a).
        h1 = []
        for tag, day, hour in (("H1a", 6, 8), ("H1b", 4, 18), ("H1c", 1, 7), ("H1d", 1, 9.5), ("H1e", 1, 12), ("H1f", 1, 16)):
            # different people each time: the same person again within the event would be a duplicate (C8)
            h1.append(self._report(tag, self.at(day, hour), "chashara", "waterlogging",
                                   80 + r.uniform(-25, 25), -60 + r.uniform(-25, 25), text_p=r.uniform(0.6, 0.8),
                                   image_p=r.uniform(0.65, 0.85), exclude={p.user for p in h1}))
        for p in h1:
            for k, voter in enumerate(self._voters(p, 2)):
                self._vote(p, voter, "confirm", "on_spot", 30 + 40 * k)
        # H2 garbage hotspot in Bashundhara west: separate events within ~100 m, each confirmed on the spot.
        h2_users: set[int] = set()
        for k, day in enumerate((5, 4, 3, 2)):
            p = self._report(f"H2{k}", self.at(day, 9 + k), "bwest", "garbage", -150 + 35 * k, 100 + 20 * (k % 2),
                             exclude=h2_users)
            h2_users.add(p.user)
            for j, voter in enumerate(self._voters(p, 2)):
                self._vote(p, voter, "confirm", "on_spot", 45 + 30 * j)
        # H3 drainage in Tanbazar.
        h3_users: set[int] = set()
        for k, day in enumerate((6, 3, 1)):
            p = self._report(f"H3{k}", self.at(day, 17 + k), "tanbazar", "drainage", -60 + 30 * k, 120 - 25 * k,
                             exclude=h3_users)
            h3_users.add(p.user)
            for j, voter in enumerate(self._voters(p, 2)):
                self._vote(p, voter, "confirm", "on_spot" if j == 0 else "same_ward", 35 + 30 * j)
        # Fresh reports that the DEMO accounts have not voted on (blind view in their feeds).
        demo = {0, 1, 2}
        for k, (ward, cat, day) in enumerate((("chashara", "garbage", 2), ("bwest", "damaged_road", 1),
                                              ("tanbazar", "water_pollution", 0), ("chashara", "deforestation", 0),
                                              ("beast", "streetlight", 1), ("bwest", "drainage", 0))):
            p = self._report(f"F{k}", self.at(day, 8 + 2 * k), ward, cat, r.uniform(-300, 300), r.uniform(-300, 300),
                             exclude=demo)
            for voter in self._voters(p, r.randint(0, 2), exclude=demo):
                self._vote(p, voter, "confirm", r.choice(["on_spot", "same_ward"]), r.uniform(30, 200))
        # The DEMO accounts' own reports and votes.
        d1 = self._report("D1", self.at(2, 10), "chashara", "garbage", -250, -200, user=0)
        for k, voter in enumerate(self._voters(d1, 3, exclude=demo)):
            self._vote(d1, voter, "confirm", "on_spot", 60 + 45 * k)
        self._report("D3", self.at(3, 19), "beast", "streetlight", 150, 280, user=2)
        for tag in ("H2", "H1c", "B"):
            for p in [c for c in self.civic if c.tag.startswith(tag)][:2]:
                if p.user != 0:
                    self._vote(p, 0, "confirm", "same_ward" if p.ward in self.people[0]["wards"] else "far_away", 300)

        # A vote ring for the collusion check (X2): two accounts voting together within a minute, many times.
        ring = (11, 12)                       # two civic DEMO users
        targets = [p for p in self.civic if p.user not in ring and not p.reuse_photo_of and not p.admin_hide][:14]
        for p in targets:
            gap = r.uniform(15, 55)
            self._vote(p, ring[0], "confirm", "far_away", 240)
            self._vote(p, ring[1], "confirm", "far_away", 240 + gap / 60)

    # ---------------- price plan ----------------

    def plan_prices(self) -> None:
        r = self.rng
        district = {"bkb": "Dhaka", "digu": "Narayanganj", "ckb": "Narayanganj"}
        ward_district = {k: dist for k, _en, _bn, _c, dist, _p, _h in D.WARDS}
        for mkey, (mlat, mlon, radius, factor, _wk) in self.market_meta.items():
            reporters = [i for i, p in enumerate(self.people) if p["role"] == "price" or i in (1, 3, 4, 5)]
            locals_ = [i for i in reporters if any(ward_district[w] == district[mkey] for w in self.people[i]["wards"])]
            others = [i for i in reporters if i not in locals_]
            for ci, (_com, base, trend) in enumerate(self.commodities):
                for day in range(27, -1, -1):
                    hot = (trend == "onion_rise" and mkey in ("digu", "ckb")) or (trend == "egg_drop" and mkey == "bkb")
                    if not (hot and day <= 8) and r.random() > 0.42:
                        continue
                    k = r.choice([3, 3, 4, 4, 5]) if hot and day <= 8 else r.choice([1, 2, 3, 3, 3, 4, 4, 5])
                    pool = r.sample(locals_, min(len(locals_), k))
                    if len(pool) < k:
                        pool += r.sample(others, k - len(pool))
                    mult = 1.0 + 0.015 * math.sin((27 - day) / 4.0 + ci)
                    if trend == "onion_rise" and mkey in ("digu", "ckb") and day <= 7:
                        mult *= 1 + 0.17 * (7 - day) / 7
                    if trend == "egg_drop" and mkey == "bkb" and day <= 7:
                        mult *= 1 - 0.13 * (7 - day) / 7
                    cell = PriceCell(ts=self.at(day, 21), day=self.today - timedelta(days=day), market=mkey, commodity=ci)
                    # At most one pumped price, only in busier cells, so the outlier flag (F24–F26) has a clear example.
                    pumped = r.randrange(k) if k >= 4 and r.random() < 0.12 else None
                    for n, uidx in enumerate(pool):
                        price = base * factor * mult * (1 + r.gauss(0, 0.025))
                        if n == pumped:
                            price *= 1.45
                        seen = self.at(day, r.uniform(7.5, 19.5) + n * 0.1)
                        if dhaka_date(seen) != cell.day:
                            continue                                    # seeding just after midnight
                        submitted = min(seen + timedelta(minutes=r.uniform(4, 90)), self.now - timedelta(minutes=3))
                        roll = r.random()
                        if roll < 0.8:
                            dist, ang = r.uniform(0, radius * 0.8), r.uniform(0, 2 * math.pi)
                            plat, plon = offset(mlat, mlon, dist * math.cos(ang), dist * math.sin(ang))
                            acc = round(r.uniform(6, 35), 1)
                        elif roll < 0.9:
                            plat = plon = acc = None                            # GPS is optional for prices (C6)
                        else:
                            dist, ang = r.uniform(400, 900), r.uniform(0, 2 * math.pi)
                            plat, plon = offset(mlat, mlon, dist * math.cos(ang), dist * math.sin(ang))
                            acc = round(r.uniform(15, 40), 1)
                        cell.reports.append({"user": uidx, "price": round(price), "seen": seen, "submitted": submitted,
                                             "lat": plat, "lon": plon, "acc": acc, "photo": r.random() < 0.75,
                                             "receipt": r.random() < 0.05})
                    if cell.reports:
                        cell.ts = max(x["submitted"] for x in cell.reports)
                        self.cells.append(cell)

    # ---------------- execution ----------------

    def _store(self, jpeg: bytes) -> photos.StoredPhoto:
        clean, w, h, bits = photos.process_image(jpeg)       # the same intake path as a real upload
        stored = photos.store(clean, w, h, bits)
        self.files.append(stored.relpath)
        return stored

    def _evidence(self, stored: photos.StoredPhoto, kind: str, ts: datetime, token_id, report_id=None, vote_id=None):
        ev = Evidence(report_id=report_id, vote_id=vote_id, kind=kind, file_path=stored.relpath, mime="image/jpeg",
                      width=stored.width, height=stored.height, bytes=stored.size, sha256=stored.sha256,
                      phash=stored.phash, token_id=token_id, received_at=ts)
        self.db.add(ev)
        return ev

    def _token(self, user: User, purpose: str, captured: datetime, used: datetime, report_id=None) -> CaptureToken:
        tok = CaptureToken(user_id=user.id, purpose=purpose, report_id=report_id, captured_at=captured, issued_at=captured,
                           expires_at=captured + timedelta(minutes=self.params.metadata.capture_token_minutes), used_at=used)
        self.db.add(tok)
        self.db.flush()
        return tok

    def _stamp(self, ts: datetime) -> None:
        """Rows written by the pipeline get the database's now(); move them to the simulated time."""
        for table, col in (("notifications", "created_at"), ("scoring_runs", "run_at"),
                           ("reputation_events", "recorded_at"), ("verified_prices", "computed_at")):
            self.db.execute(text(f"UPDATE {table} SET {col} = :ts WHERE {col} = now()"), {"ts": ts})

    def _run_civic(self, plan: CivicPlan) -> None:
        db = self.db
        person = self.people[plan.user]
        user, device = person["user"], person["device"]
        captured = plan.ts - timedelta(seconds=plan.capture_gap_s or self.rng.uniform(40, 420))
        tok = self._token(user, "report", captured, plan.ts)
        cat_name = self.params.category(plan.category).name_en
        if plan.reuse_photo_of:
            jpeg = self.photo_bytes[plan.reuse_photo_of]
        else:
            jpeg = self.images.make(plan.category, f"{cat_name} report")
        self.photo_bytes[plan.tag] = jpeg
        report = Report(user_id=user.id, report_type="civic", category_id=self.cat_ids[plan.category],
                        description=plan.description, location=wkt_point(plan.lat, plan.lon), gps_accuracy_m=plan.accuracy,
                        capture_token_id=tok.id, device_id=device.id, submitted_at=plan.ts, is_seed=True)
        db.add(report)
        db.flush()
        self._evidence(self._store(jpeg), "report_photo", plan.ts, tok.id, report_id=report.id)
        db.flush()
        db.expire(report)            # reload location as a geography value, as the worker would see it
        self.report_ids[plan.tag] = report.id
        pipeline.process_civic(db, report.id, injected={"text_p": plan.text_p, "image_p": plan.image_p})
        if plan.admin_hide:
            report.visibility, report.visibility_reason, report.visibility_changed_at = "admin_hidden", plan.admin_hide, plan.ts
            audit(db, actor_id=None, action="report.hide", entity="report", entity_id=report.id,
                  before={"visibility": "visible"}, after={"visibility": "admin_hidden"}, reason=plan.admin_hide)

    def _run_vote(self, vp: VotePlan) -> None:
        db = self.db
        rid = self.report_ids.get(vp.report_tag)
        report = db.get(Report, rid) if rid else None
        if report is None or report.visibility != "visible":
            return
        person = self.people[vp.voter]
        user, device = person["user"], person["device"]
        rep = reputation_of(db, user.id)
        if vp.mode == "on_spot":
            distance, in_ward = round(self.rng.uniform(4, 85), 1), report.ward_id is not None
        elif vp.mode == "same_ward":
            distance, in_ward = round(self.rng.uniform(150, 900), 1), True
        else:
            distance, in_ward = None, False
        weight = vote_weight(EngineVote(str(user.id), str(device.id), vp.mode, vp.decision, rep.alpha, rep.beta),
                             self.params.votes.mode_weights)
        v = Vote(report_id=report.id, voter_id=user.id, device_id=device.id, decision=vp.decision, mode_claimed=vp.mode,
                 mode_verified=vp.mode, distance_m=distance, gps_accuracy_m=round(self.rng.uniform(5, 25), 1) if distance else None,
                 in_ward=in_ward, weight_at_vote=weight, created_at=vp.ts)
        db.add(v)
        db.flush()
        if vp.mode == "on_spot":
            captured = vp.ts - timedelta(seconds=self.rng.uniform(30, 200))
            tok = self._token(user, "verification", captured, vp.ts, report_id=report.id)
            jpeg = self.images.make("verification", "On-the-spot verification", (480, 360))
            self._evidence(self._store(jpeg), "verification_photo", vp.ts, tok.id, vote_id=v.id)
            db.flush()
        pipeline.rescore(db, report.id, "vote")

    def _run_cell(self, cell: PriceCell) -> None:
        db = self.db
        com = self.commodities[cell.commodity][0]
        mkt = self.markets[cell.market]
        new_ids = []
        for rp in sorted(cell.reports, key=lambda x: x["submitted"]):
            person = self.people[rp["user"]]
            user, device = person["user"], person["device"]
            tok = None
            if rp["photo"]:
                captured = rp["submitted"] - timedelta(seconds=self.rng.uniform(40, 300))
                tok = self._token(user, "price_photo", captured, rp["submitted"])
            report = Report(user_id=user.id, report_type="price",
                            location=wkt_point(rp["lat"], rp["lon"]) if rp["lat"] is not None else None,
                            gps_accuracy_m=rp["acc"], capture_token_id=tok.id if tok else None, device_id=device.id,
                            submitted_at=rp["submitted"], is_seed=True)
            db.add(report)
            db.flush()
            db.add(PriceDetail(report_id=report.id, commodity_id=com.id, market_id=mkt.id, price_bdt=rp["price"], unit_qty=1,
                               observed_at=rp["seen"], observed_date=cell.day))
            if tok is not None:
                title = f"{com.name_en} ({com.variant})"
                self._evidence(self._store(self.images.make("product", title, (320, 240))), "product_photo",
                               rp["submitted"], tok.id, report_id=report.id)
                if rp["receipt"]:
                    self._evidence(self._store(self.images.make("product", "Receipt", (240, 320))), "receipt",
                                   rp["submitted"], tok.id, report_id=report.id)
            db.flush()
            db.expire(report)
            if rp["lat"] is not None:
                report.ward_id, report.ward_method = pipeline.ward_for_point(db, report)
            new_ids.append(report.id)
        pipeline.score_new_cell_reports(db, new_ids)

    def timeline(self) -> None:
        steps: list[tuple[datetime, int, object]] = []
        steps += [(p.ts, 0, p) for p in self.civic]
        steps += [(v.ts, 1, v) for v in self.votes]
        steps += [(c.ts, 2, c) for c in self.cells]
        steps.sort(key=lambda s: (s[0], s[1]))
        for ts, kind, item in steps:
            if kind == 0:
                self._run_civic(item)
            elif kind == 1:
                self._run_vote(item)
            else:
                self._run_cell(item)
            self.db.flush()
            self._stamp(ts)

    # ---------------- extras and analytics ----------------

    def extras(self) -> dict:
        db = self.db
        rid = self.report_ids
        demo_users = [p["user"] for p in self.people[:3]]
        for u, tags in zip(demo_users, (("F0", "H1f"), ("H32", "F2"), ("F1", "S3"))):
            for tag in tags:
                if tag in rid and db.get(Report, rid[tag]).user_id != u.id:
                    db.add(SavedPost(user_id=u.id, report_id=rid[tag], created_at=self.now - timedelta(hours=3)))
        onion = next(c for c, _b, t in self.commodities if t == "onion_rise")
        egg = next(c for c, _b, t in self.commodities if t == "egg_drop")
        for u in demo_users:
            for c in (onion, egg):
                db.add(PriceWatch(user_id=u.id, commodity_id=c.id, created_at=self.now - timedelta(days=10)))
        db.add(AbuseReport(report_id=rid["S2"], reporter_id=self.people[4]["user"].id,
                           reason="DEMO: this post is not about a road at all.", created_at=self.now - timedelta(days=12)))
        a, b = self.people[9]["user"], self.people[10]["user"]
        db.add(CollusionAlert(kind="device_violation", user_ids=[a.id, b.id], report_ids=[],
                              signals={"rule": "one account per device (C11)", "where": "login", "demo": True},
                              created_at=self.now - timedelta(days=6)))
        db.flush()
        return {"saved_posts": 6, "watches": 6}

    def run_analytics(self) -> dict:
        db = self.db
        live_new = []
        existing = {d for d, in db.query(LiveDay.date).all()}
        for k in range(1, 36):
            d = self.today - timedelta(days=k)
            if d not in existing:
                db.add(LiveDay(date=d, live=True))
                live_new.append(d.isoformat())
        db.flush()
        alerts = 0
        for k in range(7, 0, -1):
            alerts += len(analytics.daily_alerts(db, self.today - timedelta(days=k)))
            db.flush()
            self._stamp(self.at(k - 1, 0.17))
        hotspots = analytics.daily_hotspots(db, self.now)
        pairs = analytics.collusion_scan(db)
        for c, _b, _t in self.commodities:
            for m in self.markets.values():
                analytics.price_alert_check(db, c.id, m.id, self.today)
        db.flush()
        return {"live_days_added": live_new, "alerts": alerts, "hotspots": hotspots, "collusion_flags": pairs}

    def run(self) -> dict:
        self.geo()
        self.users()
        self.plan_civic()
        self.plan_prices()
        self.timeline()
        extra = self.extras()
        stats = self.run_analytics()
        db = self.db
        counts = {
            "users": len(self.people), "wards": len(self.wards), "markets": len(self.markets),
            "commodities": len(self.commodities), "civic_reports": len(self.civic), "votes": len(self.votes),
            "price_reports": sum(len(c.reports) for c in self.cells), "price_cells": len(self.cells),
            "photos": len(self.files), **extra, **{k: v for k, v in stats.items() if k != "live_days_added"},
            "status_counts": dict(db.query(Report.status, func.count()).filter(Report.is_seed.is_(True))
                                  .group_by(Report.status).all()),
        }
        audit(db, actor_id=None, action="demo.seed", entity="demo", entity_id=SEED_VERSION,
              after={"counts": {k: v for k, v in counts.items() if k != "status_counts"},
                     "live_days": stats["live_days_added"], "seeded_at": self.now.isoformat()},
              reason="DEMO seed data (N13). Never use for training, validation, testing or metrics.")
        return counts


def demo_loaded(db: Session) -> bool:
    # Anonymised DEMO accounts (kept because the append-only audit log refers to them) do not count.
    return db.query(User.id).filter(User.is_seed.is_(True), User.state != "deleted").first() is not None


def seed_demo(db: Session, password: str) -> dict | None:
    """Idempotent: returns None (and changes nothing) when DEMO data is already loaded."""
    if demo_loaded(db):
        return None
    seeder = Seeder(db, password)
    try:
        # The whole seed is one transaction, so the planner has no row statistics for the new rows; its generic
        # plans for repeated (prepared) queries then degrade to nested loops over whole tables. Custom plans
        # per execution keep every query on its index.
        db.execute(text("SET LOCAL plan_cache_mode = force_custom_plan"))
        counts = seeder.run()
        db.commit()
        return counts
    except Exception:
        db.rollback()
        for rel in seeder.files:                 # remove photos written before the failure
            try:
                photos.abs_path(rel).unlink(missing_ok=True)
            except Exception:  # noqa: BLE001
                pass
        raise
