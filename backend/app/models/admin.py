"""Admin, collusion, audit and evaluation tables (spec §7)."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, Enum, Float, ForeignKey, Index, Integer, PrimaryKeyConstraint, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at, ts, uuid_pk
from app.models.report import JUDGING

ALERT_KIND = Enum("pair_agreement", "device_violation", name="collusion_kind")
ALERT_STATE = Enum("open", "solved", name="collusion_state")
OUTCOME = Enum("collusion_confirmed", "false_alarm", name="collusion_outcome")
ANNOTATOR = Enum("member_b", "independent", name="annotator")
ISSUE = Enum("yes", "no", "cant_tell", name="issue_present")


class VoterPair(Base):
    __tablename__ = "voter_pairs"

    user_a: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    user_b: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    co_votes: Mapped[int] = mapped_column(Integer, nullable=False)
    disputed_co_votes: Mapped[int] = mapped_column(Integer, nullable=False)
    disputed_agreements: Mapped[int] = mapped_column(Integer, nullable=False)
    median_gap_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    updated_at: Mapped[datetime] = created_at()

    __table_args__ = (PrimaryKeyConstraint("user_a", "user_b"), CheckConstraint("user_a < user_b", name="ck_pair_order"))


class CollusionAlert(Base):
    __tablename__ = "collusion_alerts"

    id: Mapped[uuid.UUID] = uuid_pk()
    kind: Mapped[str] = mapped_column(ALERT_KIND, nullable=False)
    user_ids = mapped_column(ARRAY(UUID(as_uuid=True)), nullable=False)
    report_ids = mapped_column(ARRAY(UUID(as_uuid=True)), nullable=False)
    signals = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(ALERT_STATE, default="open", nullable=False)
    outcome: Mapped[str | None] = mapped_column(OUTCOME)
    note: Mapped[str | None] = mapped_column(Text)
    solved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = created_at()
    solved_at: Mapped[datetime | None] = ts()

    __table_args__ = (
        CheckConstraint("status = 'open' OR (outcome IS NOT NULL AND note IS NOT NULL AND length(note) > 0)",
                        name="ck_alert_solved_needs_note"),
    )


class AuditLog(Base):
    """Append-only: the app role gets INSERT/SELECT only and a trigger rejects UPDATE/DELETE (migration 0001)."""
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))  # null = system
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    entity: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(64))
    before = mapped_column(JSONB)
    after = mapped_column(JSONB)
    reason: Mapped[str | None] = mapped_column(Text)
    ip_hash: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = created_at()

    __table_args__ = (
        Index("ix_audit_entity", "entity", "entity_id"),
        Index("ix_audit_actor_time", "actor_id", "created_at"),
    )


class LabelImportBatch(Base):
    __tablename__ = "label_import_batches"

    id: Mapped[uuid.UUID] = uuid_pk()
    annotator: Mapped[str] = mapped_column(ANNOTATOR, nullable=False)
    file_sha256: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False)
    imported_by: Mapped[str] = mapped_column(Text, nullable=False)
    imported_at: Mapped[datetime] = created_at()


class Label(Base):
    __tablename__ = "labels"

    id: Mapped[uuid.UUID] = uuid_pk()
    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("reports.id"), nullable=False)
    annotator: Mapped[str] = mapped_column(ANNOTATOR, nullable=False)
    batch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("label_import_batches.id"), nullable=False)
    label: Mapped[str] = mapped_column(JUDGING, nullable=False)
    issue_present: Mapped[str] = mapped_column(ISSUE, nullable=False)
    created_at: Mapped[datetime] = created_at()

    __table_args__ = (UniqueConstraint("report_id", "annotator", name="uq_label_per_annotator"),)


class LabelFinal(Base):
    __tablename__ = "label_final"

    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("reports.id"), primary_key=True)
    label: Mapped[str] = mapped_column(JUDGING, nullable=False)
    issue_present: Mapped[str] = mapped_column(ISSUE, nullable=False)
    adjudicated: Mapped[bool] = mapped_column(nullable=False)
    decided_at: Mapped[datetime] = created_at()
