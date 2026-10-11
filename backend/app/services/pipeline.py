"""Scoring pipeline (W2, W5, W6): connects the pure engine in app/scoring to the database.

process_civic   first run for a new civic report (reuse check, ward, event, components, score, notify)
process_price   first run for a new price report, then the whole price cell is refreshed
rescore         re-run after a vote, an upgrade or a corroboration (report-only components are reused)
"""
from __future__ import annotations

import logging
import uuid
from datetime import timedelta

from geoalchemy2 import Geometry
from sqlalchemy import cast, func, or_, select
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.params import get_params
from app.core.timeutil import now_utc
from app.models import (
    CaptureToken, Category, Event, Evidence, Market, PriceDetail, Report, ScoringRun, TrustScore, Vote,
    VerifiedPrice, Ward,
)
from app.scoring import beta as B
from app.scoring.components import (
    ComponentResult, PastReport, Vote as EngineVote, community_price_component, gps_civic_component,
    gps_price_component, history_component, image_component, metadata_component, text_component,
)
from app.scoring.engine import CivicInputs, PriceInputs, ScoreResult, base_credibility, score_civic, score_price, vote_key
from app.scoring.prices import CellReport, outlier_flags, verified_price
from app.services import notify as N
from app.services.labels import status_label
from app.services.photos import hamming
from app.services.reputation import add_duplicate, reputation_of, set_outcome

log = logging.getLogger("civicpulse.pipeline")
SCORING_VERSION = "1.1-F1"          # 1.1: weighted votes as direct evidence (F-1)
REPORT_ONLY = ("text", "image", "gps", "metadata")
ENGINE_FLAGS = {"requires_more_verification", "category_mismatch"}


# ---------------- helpers ----------------

def _loc(report: Report):
    """The report's location as SQL (a scalar subquery). Loaded geography values are never sent back to the
    database as parameters: GeoAlchemy2 would need Shapely to re-encode them."""
    return select(Report.location).where(Report.id == report.id).scalar_subquery()


def _point(report: Report):
    return cast(_loc(report), Geometry)


def _component_from_row(row: TrustScore) -> ComponentResult:
    extra = {}
    if row.component == "image" and row.score is not None:
        extra["category_mismatch"] = row.score < get_params().flags.image_mismatch_threshold
    return ComponentResult(row.component, row.availability, row.score, row.explanation, extra)


def stored_components(db: Session, report_id: uuid.UUID) -> dict[str, ComponentResult]:
    """Report-only components from the latest run (text, image, GPS, metadata are computed once)."""
    run = db.query(ScoringRun).filter_by(report_id=report_id).order_by(ScoringRun.id.desc()).first()
    if run is None:
        return {}
    rows = db.query(TrustScore).filter_by(run_id=run.id, view="displayed").all()
    return {r.component: _component_from_row(r) for r in rows if r.component in REPORT_ONLY}


def stored_model_versions(db: Session, report_id: uuid.UUID) -> dict[str, str | None]:
    run = db.query(ScoringRun).filter_by(report_id=report_id).order_by(ScoringRun.id.desc()).first()
    if run is None:
        return {}
    return {r.component: r.model_version for r in db.query(TrustScore).filter_by(run_id=run.id, view="displayed").all()}


def ward_for_point(db: Session, report: Report) -> tuple[int | None, str]:
    """Point in polygon, else nearest ward reference point within its fallback radius (R34)."""
    if report.location is None:
        return None, "none"
    pt = _point(report)
    same_kind = Ward.is_demo.is_(bool(report.is_seed))     # DEMO reports use DEMO wards only, real reports real wards
    ward = db.query(Ward.id).filter(same_kind, Ward.geom.isnot(None), func.ST_Covers(Ward.geom, pt)).first()
    if ward:
        return ward[0], "polygon"
    loc = _loc(report)
    ward = (db.query(Ward.id).filter(same_kind, Ward.geom.is_(None),
                                     func.ST_DWithin(Ward.ref_point, loc, Ward.fallback_radius_m))
            .order_by(func.ST_Distance(Ward.ref_point, loc)).first())
    if ward:
        return ward[0], "radius"
    return None, "none"


def _reuse_hit(db: Session, ev: Evidence) -> Evidence | None:
    """Exact SHA-256 or pHash near-copy of any other stored photo (W1, M1)."""
    exact = db.query(Evidence).filter(Evidence.sha256 == ev.sha256, Evidence.id != ev.id).first()
    if exact:
        return exact
    thr = get_params().uploads.phash_threshold
    for other_id, other_hash in db.query(Evidence.id, Evidence.phash).filter(Evidence.id != ev.id).all():
        if other_hash and hamming(str(ev.phash), str(other_hash)) <= thr:
            return db.get(Evidence, other_id)
    return None


def _assign_event(db: Session, report: Report) -> str | None:
    """Same category, ≤ 50 m, ≤ 72 h (N8, M2). Returns "duplicate", "corroboration" or None (new event)."""
    p = get_params().events
    since = report.submitted_at - timedelta(hours=p.window_hours)
    same_kind = db.query(Report.event_id).filter(Report.event_id.isnot(None), Report.is_seed.is_(bool(report.is_seed)))
    ev = (db.query(Event).filter(Event.category_id == report.category_id, Event.resolved_at.is_(None),
                                 Event.last_seen >= since, Event.id.in_(same_kind),
                                 func.ST_DWithin(Event.centroid, _loc(report), p.radius_m))
          .order_by(Event.last_seen.desc()).first())
    if ev is None:
        ev = Event(category_id=report.category_id, centroid=_loc(report), first_seen=report.submitted_at,
                   last_seen=report.submitted_at, report_count=1)
        db.add(ev)
        db.flush()
        report.event_id = ev.id
        return None
    same_user = db.query(Report.id).filter(Report.event_id == ev.id, Report.user_id == report.user_id,
                                           Report.id != report.id).first()
    report.event_id = ev.id
    ev.last_seen = max(ev.last_seen, report.submitted_at)
    ev.report_count += 1
    return "duplicate" if same_user else "corroboration"


def _history(db: Session, report: Report, exclude_user: bool) -> ComponentResult:
    p = get_params().history
    since = report.submitted_at - timedelta(days=p.window_days)
    q = db.query(Report.judging_status, Report.submitted_at).filter(
        Report.report_type == "civic", Report.category_id == report.category_id, Report.id != report.id,
        Report.visibility == "visible", Report.judging_status.isnot(None), Report.submitted_at >= since,
        Report.is_seed.is_(bool(report.is_seed)),
        Report.submitted_at <= report.submitted_at, func.ST_DWithin(Report.location, _loc(report), p.radius_m))
    if exclude_user and report.user_id is not None:
        q = q.filter(or_(Report.user_id.is_(None), Report.user_id != report.user_id))
    past = [PastReport(B.Status(js), (report.submitted_at - t).total_seconds() / 86400.0) for js, t in q.all()]
    return history_component(past, p.half_life_days)


def _engine_votes(db: Session, report: Report) -> tuple[list[EngineVote], dict[str, Vote]]:
    now = now_utc()
    out, by_key = [], {}
    for v in db.query(Vote).filter(Vote.report_id == report.id, Vote.replaced_at.is_(None)).all():
        rep = reputation_of(db, v.voter_id, now)
        ev = EngineVote(str(v.voter_id), str(v.device_id), v.mode_verified, v.decision, rep.alpha, rep.beta)
        out.append(ev)
        by_key[vote_key(ev)] = v
    return out, by_key


def _corroboration_bases(db: Session, report: Report) -> list[float]:
    if report.event_id is None:
        return []
    others = db.query(Report).filter(Report.event_id == report.event_id, Report.id != report.id,
                                     Report.visibility == "visible", ~Report.flags.any("duplicate")).all()
    params = get_params()
    out = []
    for o in others:
        if o.user_id == report.user_id or (o.device_id is not None and o.device_id == report.device_id):
            continue
        comps = stored_components(db, o.id)
        if comps:
            out.append(base_credibility(comps, params))
    return out


def _persist(db: Session, report: Report, result: ScoreResult, trigger: str,
             model_versions: dict[str, str | None]) -> ScoringRun:
    params = get_params()
    d, j = result.displayed, result.judging
    run = ScoringRun(report_id=report.id, trigger=trigger, weight_profile=params.evidence.weight_profile,
                     alpha=d.alpha, beta=d.beta, credibility=d.credibility, uncertainty=d.uncertainty, conflict=d.conflict,
                     status=d.status.value, judging_status=j.status.value, flags=list(result.flags),
                     gates={"displayed_rule": d.rule, "displayed_gate": d.gate_applied, "judging_rule": j.rule,
                            "judging_gate": j.gate_applied, "judging": {"alpha": j.alpha, "beta": j.beta,
                                                                        "credibility": j.credibility,
                                                                        "uncertainty": j.uncertainty}},
                     config_hash=params.config_hash, scoring_version=SCORING_VERSION)
    db.add(run)
    db.flush()
    for view in (d, j):
        for row in view.rows:
            db.add(TrustScore(run_id=run.id, view=view.view, component=row.name, availability=row.availability,
                              score=row.score, weight=row.weight, pos_ev=row.pos_ev, neg_ev=row.neg_ev,
                              explanation=row.explanation, model_version=model_versions.get(row.name)))
    report.alpha, report.beta = d.alpha, d.beta
    report.credibility, report.uncertainty, report.conflict = d.credibility, d.uncertainty, d.conflict
    report.status = d.status.value
    report.judging_status = j.status.value
    report.components_used = d.components_used
    kept = [f for f in (report.flags or []) if f not in ENGINE_FLAGS]
    report.flags = kept + [f for f in result.flags if f not in kept]
    return run


def _notify_status_change(db: Session, report: Report, old_status: str | None) -> None:
    if old_status == report.status or old_status in (None, "pending"):
        return
    cat = db.get(Category, report.category_id) if report.category_id else None
    what = cat.name_en if cat else "price"
    label = status_label(report.status)
    if report.user_id:
        N.notify(db, report.user_id, "own_report_status",
                 {"text": f"Your {what} report is now {label}.", "status": report.status}, report.id)
    for uid in N.pinned_by(db, report.id):
        if uid != report.user_id:
            N.notify(db, uid, "pinned_report_status",
                     {"text": f"A {what} report you pinned is now {label}.", "status": report.status}, report.id)


def _apply_reputation(db: Session, report: Report, result: ScoreResult, votes_by_key: dict[str, Vote]) -> None:
    if report.user_id is not None:
        set_outcome(db, user_id=report.user_id, report_id=report.id, vote_id=None, kind=result.reporter_outcome,
                    occurred_at=report.submitted_at)
    for key, outcome in result.voter_outcomes.items():
        v = votes_by_key.get(key)
        if v is not None and v.voter_id is not None:
            set_outcome(db, user_id=v.voter_id, report_id=report.id, vote_id=v.id, kind=outcome, occurred_at=v.created_at)


def _ml_components(db: Session, report: Report, photo: Evidence | None, cat: Category) -> tuple[ComponentResult, ComponentResult, dict]:
    """Text and image scores from the zero-shot models, when they are installed. Otherwise the components
    are marked unavailable (never faked)."""
    params = get_params()
    n_cat = len(params.categories)
    versions: dict[str, str | None] = {}
    try:
        from app.ml import inference
        if not inference.models_ready(params):
            raise RuntimeError("models not installed")
        tp = inference.text_scorer(params).probability(report.description or "", cat.code)
        text = text_component(tp.p_chosen, tp.n_classes)
        versions["text"] = tp.model_version
        if photo is not None:
            from PIL import Image
            from app.services.photos import abs_path
            with Image.open(abs_path(photo.file_path)) as im:
                ip = inference.image_scorer(params).probability(im.convert("RGB"), cat.code)
            image = image_component(ip.p_chosen, ip.n_classes, params.flags.image_mismatch_threshold)
            versions["image"] = ip.model_version
        else:
            image = ComponentResult.unavailable("image", "No photo")
    except Exception as exc:  # noqa: BLE001
        why = "Model not installed on this server yet" if "not installed" in str(exc) else f"Model error: {type(exc).__name__}"
        if "not installed" not in str(exc):
            log.exception("ML scoring failed for report %s", report.id)
        text = ComponentResult.unavailable("text", why)
        image = ComponentResult.unavailable("image", why)
        n_cat = n_cat  # noqa: PLW0127
    return text, image, versions


# ---------------- civic ----------------

def process_civic(db: Session, report_id: uuid.UUID, *, injected: dict | None = None) -> Report:
    """First scoring run. `injected` is used only by the DEMO seed to supply synthetic text/image
    probabilities (stored with model_version "DEMO-synthetic", never used for evaluation)."""
    params = get_params()
    report = db.get(Report, report_id)
    cat = db.get(Category, report.category_id)
    photo = db.query(Evidence).filter_by(report_id=report.id, kind="report_photo").first()
    token = db.get(CaptureToken, report.capture_token_id) if report.capture_token_id else None

    if photo is not None:
        hit = _reuse_hit(db, photo)
        if hit is not None and "suspicious" not in (report.flags or []):
            report.flags = list(report.flags or []) + ["suspicious"]
            report.visibility, report.visibility_reason = "auto_hidden", "Photo matches an earlier photo (reuse check)"
            report.visibility_changed_at = now_utc()
            audit(db, actor_id=None, action="report.auto_hide_reuse", entity="report", entity_id=report.id,
                  after={"matched_evidence": str(hit.id)}, reason="SHA-256 / pHash reuse check (W1)")

    report.ward_id, report.ward_method = ward_for_point(db, report)
    relation = _assign_event(db, report)
    if relation == "duplicate" and "duplicate" not in (report.flags or []):
        report.flags = list(report.flags or []) + ["duplicate"]
        if report.user_id:
            add_duplicate(db, user_id=report.user_id, report_id=report.id, occurred_at=report.submitted_at)

    if injected:
        text = text_component(injected["text_p"], len(params.categories)) if injected.get("text_p") is not None \
            else ComponentResult.unavailable("text", "No description")
        image = image_component(injected["image_p"], len(params.categories) + 1, params.flags.image_mismatch_threshold) \
            if injected.get("image_p") is not None else ComponentResult.unavailable("image", "No photo")
        text = ComponentResult(text.name, text.availability, text.score, "DEMO synthetic score: " + text.explanation, text.extra) \
            if text.score is not None else text
        image = ComponentResult(image.name, image.availability, image.score, "DEMO synthetic score: " + image.explanation,
                                image.extra) if image.score is not None else image
        versions = {"text": "DEMO-synthetic", "image": "DEMO-synthetic"}
    else:
        text, image, versions = _ml_components(db, report, photo, cat)

    gps = gps_civic_component(report.gps_accuracy_m, params.gps.accuracy_limit_m)
    gap = (report.submitted_at - token.captured_at).total_seconds() if token else None
    if gap is not None:
        gap = min(max(gap, 0.0), params.metadata.capture_token_minutes * 60)
    meta = metadata_component(gap, params.metadata.capture_token_minutes)
    _score_civic(db, report, {"text": text, "image": image, "gps": gps, "metadata": meta}, "submit", versions)

    if report.visibility == "visible" and report.ward_id is not None:
        ward = db.get(Ward, report.ward_id)
        for uid in N.users_in_ward(db, report.ward_id):
            if uid != report.user_id:
                N.notify(db, uid, "new_report_in_ward",
                         {"text": f"A new report has been posted in your locality {ward.name_en}, go check it out!",
                          "category": cat.name_en, "category_code": cat.code, "ward": ward.name_en}, report.id)
    if relation == "corroboration":
        for other_id, in db.query(Report.id).filter(Report.event_id == report.event_id, Report.id != report.id).all():
            rescore(db, other_id, "corroboration")
    return report


def _score_civic(db: Session, report: Report, comps: dict[str, ComponentResult], trigger: str,
                 versions: dict[str, str | None]) -> ScoreResult:
    old = report.status
    votes, by_key = _engine_votes(db, report)
    rep = reputation_of(db, report.user_id)
    inp = CivicInputs(
        text=comps.get("text") or ComponentResult.unavailable("text", "Not available"),
        image=comps.get("image") or ComponentResult.unavailable("image", "Not available"),
        gps=comps.get("gps") or ComponentResult.unavailable("gps", "Not available"),
        metadata=comps.get("metadata") or ComponentResult.unavailable("metadata", "Not available"),
        history_displayed=_history(db, report, exclude_user=False),
        history_judging=_history(db, report, exclude_user=True),
        reporter_rep=rep.rep if report.user_id else None,
        reporter_rep_u=rep.uncertainty if report.user_id else None,
        votes=votes, corroboration_bases=_corroboration_bases(db, report),
    )
    result = score_civic(inp, get_params())
    _persist(db, report, result, trigger, versions)
    _apply_reputation(db, report, result, by_key)
    _notify_status_change(db, report, old)
    return result


def rescore(db: Session, report_id: uuid.UUID, trigger: str) -> Report | None:
    report = db.get(Report, report_id)
    if report is None:
        return None
    if report.report_type == "price":
        return _score_price(db, report, trigger)
    if report.event_id:
        ev = db.get(Event, report.event_id)
        if ev and ev.resolved_at is not None:
            return report            # Resolved events keep their status (N3)
    comps = stored_components(db, report.id)
    _score_civic(db, report, comps, trigger, stored_model_versions(db, report.id))
    check_resolved(db, report)
    return report


def check_resolved(db: Session, report: Report) -> bool:
    """Three on-the-spot "Fixed now" votes from different devices across the event mark it Resolved (N3)."""
    if report.event_id is None:
        return False
    ev = db.get(Event, report.event_id)
    if ev is None or ev.resolved_at is not None:
        return False
    devices = {d for d, in db.query(Vote.device_id).join(Report, Report.id == Vote.report_id).filter(
        Report.event_id == ev.id, Vote.replaced_at.is_(None), Vote.decision == "fixed_now",
        Vote.mode_verified == "on_spot").all()}
    if len(devices) >= get_params().votes.fixed_now_to_resolve:
        ev.resolved_at = now_utc()
        audit(db, actor_id=None, action="event.resolved", entity="event", entity_id=ev.id,
              after={"fixed_now_devices": len(devices)})
        return True
    return False


# ---------------- price ----------------

def _price_components(db: Session, report: Report, detail: PriceDetail) -> tuple[ComponentResult, ComponentResult]:
    params = get_params()
    market = db.get(Market, detail.market_id)
    if report.location is not None:
        market_loc = select(Market.location).where(Market.id == market.id).scalar_subquery()
        dist = db.query(func.ST_Distance(_loc(report), market_loc)).scalar()
        gps = gps_price_component(report.gps_accuracy_m, float(dist), market.radius_m, params.gps.accuracy_limit_m)
    else:
        gps = gps_price_component(None, None, market.radius_m, params.gps.accuracy_limit_m)
    token = db.get(CaptureToken, report.capture_token_id) if report.capture_token_id else None
    if token is not None:
        gap = min(max((report.submitted_at - token.captured_at).total_seconds(), 0.0),
                  params.metadata.capture_token_minutes * 60)
        meta = metadata_component(gap, params.metadata.capture_token_minutes)
    else:
        meta = metadata_component(None, params.metadata.capture_token_minutes)
    return gps, meta


def _cell_reports(db: Session, detail: PriceDetail) -> list[tuple[Report, PriceDetail]]:
    return (db.query(Report, PriceDetail).join(PriceDetail, PriceDetail.report_id == Report.id)
            .filter(PriceDetail.commodity_id == detail.commodity_id, PriceDetail.market_id == detail.market_id,
                    PriceDetail.observed_date == detail.observed_date, Report.visibility == "visible").all())


def _score_price(db: Session, report: Report, trigger: str, cache: dict | None = None) -> Report:
    """`cache` keeps each report's GPS and metadata components while a whole cell is scored (they never change)."""
    params = get_params()
    detail = db.get(PriceDetail, report.id)
    old = report.status
    cache = {} if cache is None else cache

    def comps(r: Report, d: PriceDetail):
        if r.id not in cache:
            cache[r.id] = _price_components(db, r, d)
        return cache[r.id]

    gps, meta = comps(report, detail)
    others = []
    for o, od in _cell_reports(db, detail):
        if o.id == report.id or o.user_id == report.user_id:
            continue
        og, om = comps(o, od)
        others.append((float(od.price_bdt), base_credibility({"gps": og, "metadata": om}, params, price=True)))
    community = community_price_component(float(detail.price_bdt), others, params.prices.agreement_tolerance)
    rep = reputation_of(db, report.user_id)
    result = score_price(PriceInputs(gps, meta, community, rep.rep if report.user_id else None,
                                     rep.uncertainty if report.user_id else None,
                                     bool(community.extra.get("corroborated"))), params)
    _persist(db, report, result, trigger, {})
    if report.user_id:
        set_outcome(db, user_id=report.user_id, report_id=report.id, vote_id=None, kind=result.reporter_outcome,
                    occurred_at=report.submitted_at)
    _notify_status_change(db, report, old)
    return report


def process_price(db: Session, report_id: uuid.UUID) -> Report:
    report = db.get(Report, report_id)
    if report.location is not None:
        report.ward_id, report.ward_method = ward_for_point(db, report)
    detail = db.get(PriceDetail, report.id)
    cache: dict = {}
    _score_price(db, report, "submit", cache)
    update_price_cell(db, detail.commodity_id, detail.market_id, detail.observed_date, skip=report.id, cache=cache)
    return report


def score_new_cell_reports(db: Session, report_ids: list[uuid.UUID]) -> None:
    """Score several new reports of ONE cell against the complete cell, once each, then refresh the cell.
    Same end state as calling process_price for each in turn, with far fewer scoring runs (DEMO seed)."""
    cache: dict = {}
    for rid in report_ids:
        _score_price(db, db.get(Report, rid), "submit", cache)
    d = db.get(PriceDetail, report_ids[0])
    update_price_cell(db, d.commodity_id, d.market_id, d.observed_date, rescore=False)


def update_price_cell(db: Session, commodity_id: int, market_id: int, day, skip: uuid.UUID | None = None,
                      rescore: bool = True, cache: dict | None = None) -> VerifiedPrice:
    """Re-score the other reports in the cell (their community changed), then F23 and F24–F26.
    `rescore=False` only when every report in the cell was just scored against the full cell (DEMO seed)."""
    params = get_params()
    probe = PriceDetail(commodity_id=commodity_id, market_id=market_id, observed_date=day)
    cache = {} if cache is None else cache
    for r, _ in (_cell_reports(db, probe) if rescore else []):
        if r.id != skip:
            _score_price(db, r, "corroboration", cache)
    rows = _cell_reports(db, probe)
    devices = {r.id: r.device_id for r, _ in rows}
    cell = [CellReport(str(r.id), str(r.user_id), str(devices[r.id]), float(d.price_bdt), B.Status(r.status),
                       "duplicate" in (r.flags or []), r.visibility == "visible", r.credibility)
            for r, d in rows if r.status != "pending"]
    flags = outlier_flags([c.price for c in cell], params)
    by_id = {str(r.id): r for r, _ in rows}
    for c, flagged in zip(cell, flags):
        r = by_id[c.report_id]
        has = "price_outlier" in (r.flags or [])
        if flagged and not has:
            r.flags = list(r.flags or []) + ["price_outlier"]
        elif not flagged and has:
            r.flags = [f for f in r.flags if f != "price_outlier"]
    vp = verified_price(cell, params)
    row = db.query(VerifiedPrice).filter_by(commodity_id=commodity_id, market_id=market_id, date=day).first()
    if row is None:
        row = VerifiedPrice(commodity_id=commodity_id, market_id=market_id, date=day, report_count=0,
                            status=vp.status, report_ids=[])
        db.add(row)
    row.verified_price = vp.value
    row.status = vp.status
    row.report_count = vp.report_count
    row.report_ids = [uuid.UUID(i) for i in vp.report_ids]
    row.computed_at = now_utc()
    return row


# ---------------- scheduled ----------------

def auto_hide_check(db: Session) -> int:
    """Hourly: hide reports still flagged after the window with u ≥ 0.80 (T1, V1)."""
    params = get_params()
    cutoff = now_utc() - timedelta(days=params.flags.auto_hide_after_days)
    rows = db.query(Report).filter(Report.visibility == "visible", Report.submitted_at <= cutoff,
                                   Report.flags.any("requires_more_verification"),
                                   Report.uncertainty >= params.flags.auto_hide_uncertainty).all()
    for r in rows:
        r.visibility, r.visibility_reason, r.visibility_changed_at = "auto_hidden", "Still unverified after 7 days", now_utc()
        audit(db, actor_id=None, action="report.auto_hide", entity="report", entity_id=r.id,
              reason="requires_more_verification and u >= 0.80 after 7 days (T1)")
    return len(rows)
