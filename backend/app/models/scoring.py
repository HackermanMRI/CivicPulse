"""Scoring runs, per-component rows and reputation events (spec §7)."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import ARRAY, BigInteger, Enum, Float, ForeignKey, Index, PrimaryKeyConstraint, SmallInteger, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at, ts
from app.models.report import JUDGING

RUN_TRIGGER = Enum("submit", "vote", "upgrade", "corroboration", "admin_restore", "recompute", name="run_trigger")
PROFILE = Enum("A", "B", name="weight_profile")
VIEW = Enum("displayed", "judging", name="score_view")
COMPONENT = Enum("text", "image", "gps", "metadata", "reputation", "community", "history", name="component")
AVAILABILITY = Enum("available", "partial", "unavailable", name="availability")
REP_KIND = Enum("report_positive", "report_negative", "duplicate", "vote_agree", "vote_disagree", name="rep_kind")


class ScoringRun(Base):
    __tablename__ = "scoring_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("reports.id"), index=True, nullable=False)
    run_at: Mapped[datetime] = created_at()
    trigger: Mapped[str] = mapped_column(RUN_TRIGGER, nullable=False)
    weight_profile: Mapped[str] = mapped_column(PROFILE, nullable=False)
    alpha: Mapped[float] = mapped_column(Float, nullable=False)
    beta: Mapped[float] = mapped_column(Float, nullable=False)
    credibility: Mapped[float] = mapped_column(Float, nullable=False)
    uncertainty: Mapped[float] = mapped_column(Float, nullable=False)
    conflict: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(JUDGING, nullable=False)
    judging_status: Mapped[str] = mapped_column(JUDGING, nullable=False)
    flags = mapped_column(ARRAY(Text), server_default=text("'{}'"), nullable=False)
    gates = mapped_column(JSONB, nullable=False)      # deciding rule, corroboration count, gate result, judging view
    config_hash: Mapped[str] = mapped_column(Text, nullable=False)
    scoring_version: Mapped[str] = mapped_column(Text, nullable=False)


class TrustScore(Base):
    """One row per component per view per run (C5, C22)."""
    __tablename__ = "trust_scores"

    run_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("scoring_runs.id", ondelete="CASCADE"))
    view: Mapped[str] = mapped_column(VIEW, nullable=False)
    component: Mapped[str] = mapped_column(COMPONENT, nullable=False)
    availability: Mapped[str] = mapped_column(AVAILABILITY, nullable=False)
    score: Mapped[float | None] = mapped_column(Float)    # null when unavailable, never 0 (R6)
    weight: Mapped[float] = mapped_column(Float, nullable=False)
    pos_ev: Mapped[float] = mapped_column(Float, nullable=False)
    neg_ev: Mapped[float] = mapped_column(Float, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    model_version: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (PrimaryKeyConstraint("run_id", "component", "view"),)


class ReputationEvent(Base):
    __tablename__ = "reputation_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(REP_KIND, nullable=False)
    d_alpha: Mapped[float] = mapped_column(Float, nullable=False)
    d_beta: Mapped[float] = mapped_column(Float, nullable=False)
    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("reports.id"), nullable=False)
    vote_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("votes.id"))
    occurred_at: Mapped[datetime] = ts(False)     # report or vote time; decay counts from here (N2)
    recorded_at: Mapped[datetime] = created_at()
    superseded_at: Mapped[datetime | None] = ts()

    __table_args__ = (
        Index("ix_rep_current", "user_id", postgresql_where=text("superseded_at IS NULL")),
        Index("ix_rep_source", "report_id", "vote_id", "user_id"),
    )
