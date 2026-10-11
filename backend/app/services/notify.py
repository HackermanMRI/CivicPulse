"""Notifications (M9, U16, C4): rows in the database plus a best-effort push over Redis for the SSE stream."""
from __future__ import annotations

import json
import uuid

from sqlalchemy.orm import Session

from app.models import Notification, SavedPost, UserAddress

_redis = None


def _publish(user_id: uuid.UUID, payload: dict) -> None:
    global _redis
    try:
        if _redis is None:
            import redis

            from app.config import settings
            _redis = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=0.3, socket_timeout=0.3)
        _redis.publish(f"notify:{user_id}", json.dumps(payload, default=str))
    except Exception:  # noqa: BLE001 - the row is stored; SSE is only a live hint
        _redis = None


def notify(db: Session, user_id: uuid.UUID, kind: str, payload: dict, report_id: uuid.UUID | None = None) -> None:
    n = Notification(user_id=user_id, kind=kind, payload=payload, report_id=report_id)
    db.add(n)
    db.flush()
    _publish(user_id, {"id": str(n.id), "kind": kind, "payload": payload, "report_id": str(report_id) if report_id else None})


def users_in_ward(db: Session, ward_id: int) -> list[uuid.UUID]:
    rows = db.query(UserAddress.user_id).filter(UserAddress.ward_id == ward_id).distinct().all()
    return [r[0] for r in rows]


def pinned_by(db: Session, report_id: uuid.UUID) -> list[uuid.UUID]:
    return [r[0] for r in db.query(SavedPost.user_id).filter(SavedPost.report_id == report_id).all()]
