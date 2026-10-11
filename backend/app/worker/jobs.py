"""Worker jobs. Each job opens its own session, commits once and is safe to run twice."""
from __future__ import annotations

import logging
import uuid
from datetime import date, timedelta

from app.core.timeutil import dhaka_date, now_utc
from app.database import SessionLocal
from app.models import Report
from app.services import analytics, pipeline

log = logging.getLogger("civicpulse.jobs")


def process_report(report_id: str) -> str:
    rid = uuid.UUID(report_id)
    with SessionLocal() as db:
        report = db.get(Report, rid)
        if report is None:
            return "missing"
        if report.status != "pending":
            return "already scored"          # idempotent: a re-queued job does nothing
        if report.report_type == "civic":
            pipeline.process_civic(db, rid)
        else:
            pipeline.process_price(db, rid)
            db.flush()
            from app.models import PriceDetail
            d = db.get(PriceDetail, rid)
            analytics.price_alert_check(db, d.commodity_id, d.market_id)
        db.commit()
        return report.status


def rescore_report(report_id: str, trigger: str) -> str:
    if trigger not in ("vote", "upgrade", "corroboration", "admin_restore", "recompute"):
        raise ValueError(f"bad trigger {trigger}")
    with SessionLocal() as db:
        report = pipeline.rescore(db, uuid.UUID(report_id), trigger)
        if report is not None and report.report_type == "price":
            from app.models import PriceDetail
            d = db.get(PriceDetail, report.id)
            pipeline.update_price_cell(db, d.commodity_id, d.market_id, d.observed_date)
            db.flush()
            analytics.price_alert_check(db, d.commodity_id, d.market_id)
        db.commit()
        return report.status if report else "missing"


def auto_hide() -> int:
    with SessionLocal() as db:
        n = pipeline.auto_hide_check(db)
        db.commit()
        return n


def requeue_pending(older_than_minutes: str = "2") -> int:
    """Reports still pending after a few minutes lost their job (Redis restart, worker down)."""
    from app.worker.queue import enqueue

    cutoff = now_utc() - timedelta(minutes=int(older_than_minutes))
    with SessionLocal() as db:
        ids = [str(r) for r, in db.query(Report.id).filter(Report.status == "pending", Report.submitted_at <= cutoff,
                                                            Report.visibility != "admin_hidden").limit(200).all()]
    for rid in ids:
        enqueue("process_report", rid)
    return len(ids)


def mark_live() -> None:
    with SessionLocal() as db:
        analytics.mark_live_day(db)
        db.commit()


def daily_alerts(test_day: str | None = None) -> int:
    """Runs at 12:10 AM for the day that just ended."""
    day = date.fromisoformat(test_day) if test_day else dhaka_date() - timedelta(days=1)
    with SessionLocal() as db:
        n = len(analytics.daily_alerts(db, day))
        db.commit()
        return n


def daily_hotspots() -> int:
    with SessionLocal() as db:
        n = analytics.daily_hotspots(db)
        db.commit()
        return n


def collusion_scan() -> int:
    with SessionLocal() as db:
        n = analytics.collusion_scan(db)
        db.commit()
        return n
