"""Remove every DEMO record and keep every real one (N13).

DEMO = reports with is_seed, users with is_seed, and wards / markets / commodities with is_demo, plus every row
that hangs off them (votes, photos, scoring runs, reputation events, notifications, saved posts, ...).
Real users who touched DEMO data (voted on a DEMO report, picked a DEMO ward) keep their accounts; only the
DEMO-linked rows are removed, and a real address in a DEMO ward becomes "outside the pilot area".
The audit log is append-only, so DEMO accounts that appear in it are anonymised instead of deleted.
"""
from __future__ import annotations

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.models import (
    AbuseReport, Alert, AuditLog, CaptureToken, CollusionAlert, Commodity, Device, Event, Evidence, Hotspot, LiveDay, Market,
    Notification, PriceDetail, PriceWatch, RefreshToken, Report, ReputationEvent, SavedPost, ScoringRun, User, UserAddress,
    VerifiedPrice, Vote, VoterPair, Ward,
)
from app.services import photos, pipeline


def reset_demo(db: Session) -> dict:
    seed_reports = select(Report.id).where(Report.is_seed.is_(True))
    seed_users = select(User.id).where(User.is_seed.is_(True))
    demo_wards = [w for w, in db.query(Ward.id).filter(Ward.is_demo.is_(True)).all()]
    demo_markets = [m for m, in db.query(Market.id).filter(Market.is_demo.is_(True)).all()]
    demo_coms = [c for c, in db.query(Commodity.id).filter(Commodity.is_demo.is_(True)).all()]
    seed_ids = {r for r, in db.execute(seed_reports).all()}
    seed_uids = {u for u, in db.execute(seed_users).all()}
    out: dict[str, int | list] = {"reports": len(seed_ids), "users": len(seed_uids)}

    votes = select(Vote.id).where(or_(Vote.report_id.in_(seed_reports), Vote.voter_id.in_(seed_users)))
    files = [f for f, in db.query(Evidence.file_path).filter(or_(Evidence.report_id.in_(seed_reports),
                                                                 Evidence.vote_id.in_(votes))).all()]
    db.execute(delete(ReputationEvent).where(or_(ReputationEvent.report_id.in_(seed_reports),
                                                 ReputationEvent.user_id.in_(seed_users),
                                                 ReputationEvent.vote_id.in_(votes))))
    db.execute(delete(ScoringRun).where(ScoringRun.report_id.in_(seed_reports)))      # trust_scores cascade
    db.execute(delete(Evidence).where(or_(Evidence.report_id.in_(seed_reports), Evidence.vote_id.in_(votes))))
    out["votes"] = db.execute(delete(Vote).where(Vote.id.in_(votes))).rowcount
    db.execute(delete(SavedPost).where(or_(SavedPost.report_id.in_(seed_reports), SavedPost.user_id.in_(seed_users))))
    db.execute(delete(AbuseReport).where(or_(AbuseReport.report_id.in_(seed_reports), AbuseReport.reporter_id.in_(seed_users))))
    demo_ward_names = [n for n, in db.query(Ward.name_en).filter(Ward.is_demo.is_(True)).all()]
    db.execute(delete(Notification).where(or_(
        Notification.report_id.in_(seed_reports), Notification.user_id.in_(seed_users),
        (Notification.kind == "emerging_issue") & Notification.payload["ward"].astext.in_(demo_ward_names or [""]),
        (Notification.kind == "price_alert") & Notification.payload["market_id"].astext.in_([str(m) for m in demo_markets] or [""]),
    )))

    # Capture tokens and reports point at each other: break the link first.
    db.execute(update(Report).where(Report.id.in_(seed_reports)).values(capture_token_id=None))
    db.execute(delete(CaptureToken).where(or_(CaptureToken.user_id.in_(seed_users), CaptureToken.report_id.in_(seed_reports))))

    # Verified prices built from DEMO reports, then the cells that still hold real reports are recomputed.
    cells = db.query(VerifiedPrice.commodity_id, VerifiedPrice.market_id, VerifiedPrice.date).filter(
        VerifiedPrice.report_ids.overlap(list(seed_ids) or [None])).all() if seed_ids else []
    db.execute(delete(VerifiedPrice).where(or_(VerifiedPrice.market_id.in_(demo_markets or [-1]),
                                               VerifiedPrice.commodity_id.in_(demo_coms or [-1]))))
    if seed_ids:
        db.execute(delete(VerifiedPrice).where(VerifiedPrice.report_ids.overlap(list(seed_ids))))
        db.execute(delete(Hotspot).where(Hotspot.report_ids.overlap(list(seed_ids))))
    events = select(Report.event_id).where(Report.id.in_(seed_reports), Report.event_id.isnot(None))
    event_ids = {e for e, in db.execute(events).all()}
    db.execute(delete(Report).where(Report.id.in_(seed_reports)))                     # price_details cascade
    if event_ids:
        still_used = select(Report.event_id).where(Report.event_id.isnot(None))
        db.execute(delete(Event).where(Event.id.in_(event_ids), Event.id.notin_(still_used)))
    for com, mkt, day in cells:
        if com not in demo_coms and mkt not in demo_markets:
            pipeline.update_price_cell(db, com, mkt, day)

    db.execute(delete(VoterPair).where(or_(VoterPair.user_a.in_(seed_users), VoterPair.user_b.in_(seed_users))))
    if seed_uids:
        db.execute(delete(CollusionAlert).where(CollusionAlert.user_ids.contained_by(list(seed_uids))))
    db.execute(delete(PriceWatch).where(or_(PriceWatch.user_id.in_(seed_users), PriceWatch.commodity_id.in_(demo_coms or [-1]))))

    # Users: delete, or anonymise when the append-only audit log refers to them.
    in_audit = {a for a, in db.query(AuditLog.actor_id).filter(AuditLog.actor_id.in_(seed_users)).distinct().all()}
    db.execute(update(User).where(User.id.in_(list(in_audit) or [None])).values(
        display_name=None, phone=None, email=None, pass_hash=None, state="deleted", deleted_at=func.now()))
    for model in (UserAddress, Device, RefreshToken):          # free the DEMO device ids and sessions for a re-seed
        db.execute(delete(model).where(model.user_id.in_(list(in_audit) or [None])))
    out["users_anonymised"] = len(in_audit)
    keep = [User.id.notin_(list(in_audit))] if in_audit else []      # NOT IN (NULL) would match nothing
    db.execute(delete(User).where(User.is_seed.is_(True), *keep))

    # DEMO geography. Real addresses in a DEMO ward become "outside the pilot area" (ward_id NULL).
    out["real_addresses_moved"] = db.execute(update(UserAddress).where(UserAddress.ward_id.in_(demo_wards or [-1]))
                                             .values(ward_id=None)).rowcount
    db.execute(update(Report).where(Report.ward_id.in_(demo_wards or [-1])).values(ward_id=None, ward_method="none"))
    db.execute(delete(Alert).where(Alert.ward_id.in_(demo_wards or [-1])))
    kept = []
    for model, ids, label in ((Market, demo_markets, "markets"), (Commodity, demo_coms, "commodities")):
        col = PriceDetail.market_id if model is Market else PriceDetail.commodity_id
        used = {i for i, in db.query(col).filter(col.in_(ids or [-1])).distinct().all()}
        db.execute(delete(model).where(model.id.in_([i for i in ids if i not in used] or [-1])))
        if used:
            kept.append(f"{label}: {sorted(used)} still used by real price reports")
    db.execute(update(Market).where(Market.ward_id.in_(demo_wards or [-1])).values(ward_id=None))
    db.execute(delete(Ward).where(Ward.id.in_(demo_wards or [-1])))
    out["kept"] = kept

    # Live days the seed added (recorded in its demo.seed audit entries).
    seeded_days = set()
    for after, in db.query(AuditLog.after).filter(AuditLog.action == "demo.seed").all():
        seeded_days |= set((after or {}).get("live_days", []))
    if seeded_days:
        from datetime import date
        db.execute(delete(LiveDay).where(LiveDay.date.in_([date.fromisoformat(d) for d in seeded_days])))
    out["live_days_removed"] = len(seeded_days)
    audit(db, actor_id=None, action="demo.reset", entity="demo", after={k: v for k, v in out.items()},
          reason="DEMO seed data removed (N13)")
    db.commit()
    for rel in files:                                  # photos go only after the database change is committed
        try:
            photos.abs_path(rel).unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass
    out["photos_removed"] = len(files)
    return out
