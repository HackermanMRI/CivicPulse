"""Read and write reputation events (P9, N2, F21–F22)."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.params import get_params
from app.core.timeutil import now_utc
from app.models import ReputationEvent
from app.scoring.reputation import RepEvent, Reputation, event_delta, read_reputation


def reputation_of(db: Session, user_id: uuid.UUID | None, now: datetime | None = None) -> Reputation:
    rows = [] if user_id is None else (
        db.query(ReputationEvent).filter(ReputationEvent.user_id == user_id, ReputationEvent.superseded_at.is_(None)).all()
    )
    events = [RepEvent(r.kind, r.d_alpha, r.d_beta, r.occurred_at) for r in rows]
    return read_reputation(events, now or now_utc(), get_params())


def set_outcome(db: Session, *, user_id: uuid.UUID, report_id: uuid.UUID, vote_id: uuid.UUID | None,
                kind: str | None, occurred_at: datetime) -> None:
    """One current result per (report, vote, user): a new result replaces the old one, never adds (N2).
    Duplicate events are separate and never replaced here."""
    q = db.query(ReputationEvent).filter(
        ReputationEvent.user_id == user_id, ReputationEvent.report_id == report_id,
        ReputationEvent.superseded_at.is_(None), ReputationEvent.kind != "duplicate",
        (ReputationEvent.vote_id == vote_id) if vote_id else ReputationEvent.vote_id.is_(None),
    )
    current = q.first()
    if current is not None and current.kind == kind:
        return
    if current is not None:
        current.superseded_at = now_utc()
    if kind is not None:
        da, dbeta = event_delta(kind, get_params())
        db.add(ReputationEvent(user_id=user_id, kind=kind, d_alpha=da, d_beta=dbeta, report_id=report_id,
                               vote_id=vote_id, occurred_at=occurred_at))


def add_duplicate(db: Session, *, user_id: uuid.UUID, report_id: uuid.UUID, occurred_at: datetime) -> None:
    exists = db.query(ReputationEvent).filter_by(user_id=user_id, report_id=report_id, kind="duplicate").first()
    if exists is None:
        da, dbeta = event_delta("duplicate", get_params())
        db.add(ReputationEvent(user_id=user_id, kind="duplicate", d_alpha=da, d_beta=dbeta, report_id=report_id,
                               occurred_at=occurred_at))
