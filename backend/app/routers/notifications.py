"""Notification tabs and the live SSE stream (W3, B10, C4, open parameter B11).

The stream is read with fetch() so the normal Authorization header is sent (B11 preferred option);
EventSource cannot send headers. The stream closes when the access token expires, and the app reconnects
with a fresh token.
"""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.core.deps import _bearer, current_user, get_db
from app.core.timeutil import now_utc
from app.core.tokens import decode_token
from app.models import Notification, User

router = APIRouter(prefix="/api", tags=["Notifications"])
TABS = {"alerts": ("new_report_in_ward", "emerging_issue", "price_alert"),
        "notifications": ("own_report_status", "pinned_report_status")}


def _row(n: Notification) -> dict:
    return {"id": str(n.id), "kind": n.kind, "payload": n.payload, "report_id": str(n.report_id) if n.report_id else None,
            "created_at": n.created_at.isoformat(), "read": n.read_at is not None}


@router.get("/notifications")
def list_notifications(tab: Literal["alerts", "notifications"] = "alerts", limit: int = Query(30, ge=1, le=100),
                       before: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(Notification).filter(Notification.user_id == user.id, Notification.kind.in_(TABS[tab]))
    if before:
        from datetime import datetime
        try:
            q = q.filter(Notification.created_at < datetime.fromisoformat(before))
        except ValueError:
            raise HTTPException(status_code=422, detail="Bad cursor")
    rows = q.order_by(Notification.created_at.desc()).limit(limit).all()
    return {"items": [_row(n) for n in rows], "next_before": rows[-1].created_at.isoformat() if len(rows) == limit else None}


@router.get("/notifications/unread-count")
def unread(user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = {}
    for tab, kinds in TABS.items():
        out[tab] = db.query(func.count(Notification.id)).filter(Notification.user_id == user.id, Notification.read_at.is_(None),
                                                                Notification.kind.in_(kinds)).scalar()
    return out


@router.post("/notifications/{notification_id}/read")
def mark_read(notification_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    n = db.query(Notification).filter_by(id=notification_id, user_id=user.id).first()   # owner check (no IDOR)
    if n is None:
        raise HTTPException(status_code=404, detail="Not found")
    if n.read_at is None:
        n.read_at = now_utc()
        db.commit()
    return {"ok": True}


@router.post("/notifications/read-all")
def mark_all(tab: Literal["alerts", "notifications"] = "alerts", user: User = Depends(current_user),
             db: Session = Depends(get_db)):
    db.query(Notification).filter(Notification.user_id == user.id, Notification.read_at.is_(None),
                                  Notification.kind.in_(TABS[tab])).update({"read_at": now_utc()}, synchronize_session=False)
    db.commit()
    return {"ok": True}


@router.get("/stream")
async def stream(request: Request):
    token = _bearer(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    payload = decode_token(token, "access")
    user_id, expires = payload["sub"], int(payload["exp"])
    from app.database import SessionLocal
    with SessionLocal() as db:
        try:
            u = db.get(User, uuid.UUID(user_id))
        except ValueError:
            u = None
        if u is None or u.state in ("deleted", "suspended"):
            raise HTTPException(status_code=401, detail="Not signed in")

    async def events():
        import redis.asyncio as aioredis

        r = aioredis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=1)
        pubsub = r.pubsub()
        try:
            await pubsub.subscribe(f"notify:{user_id}")
        except Exception:  # noqa: BLE001
            yield "event: unavailable\ndata: {}\n\n"       # the app falls back to polling the unread count
            await r.aclose()
            return
        yield "event: ready\ndata: {}\n\n"
        last_beat = time.monotonic()
        try:
            while time.time() < expires and not await request.is_disconnected():
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=5.0)
                if msg and msg.get("type") == "message":
                    data = msg["data"].decode() if isinstance(msg["data"], bytes) else str(msg["data"])
                    json.loads(data)                       # only forward valid JSON
                    yield f"event: notification\ndata: {data}\n\n"
                if time.monotonic() - last_beat > 15:
                    yield ": keep-alive\n\n"
                    last_beat = time.monotonic()
                await asyncio.sleep(0)
            yield "event: expired\ndata: {}\n\n"
        finally:
            await pubsub.aclose()
            await r.aclose()

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
