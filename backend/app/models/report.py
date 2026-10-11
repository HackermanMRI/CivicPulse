"""Reports, evidence and community tables (spec §7; U20 capture time, A1 abuse reports)."""
from __future__ import annotations

import uuid
from datetime import date, datetime

from geoalchemy2 import Geography
from sqlalchemy import (
    Boolean, CheckConstraint, Date, Enum, Float, ForeignKey, Index, Integer, Numeric,
    PrimaryKeyConstraint, SmallInteger, String, Text, text,
)
from sqlalchemy.dialects.postgresql import ARRAY, BIT, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at, ts, uuid_pk

REPORT_TYPE = Enum("civic", "price", name="report_type")
STATUS = Enum("pending", "strongly_supported", "supported", "uncertain", "not_supported", name="report_status")
JUDGING = Enum("strongly_supported", "supported", "uncertain", "not_supported", name="judging_status")
VISIBILITY = Enum("visible", "auto_hidden", "admin_hidden", name="visibility")
WARD_METHOD = Enum("polygon", "radius", "none", name="ward_method")
TOKEN_PURPOSE = Enum("report", "verification", "price_photo", name="token_purpose")
EVIDENCE_KIND = Enum("report_photo", "verification_photo", "product_photo", "receipt", name="evidence_kind")
VOTE_DECISION = Enum("confirm", "disagree", "fixed_now", name="vote_decision")
VOTE_MODE = Enum("on_spot", "same_ward", "far_away", name="vote_mode")
ABUSE_STATE = Enum("open", "reviewed", name="abuse_state")


def _uuid_fk(target: str, nullable: bool = False, index: bool = False, **fk_kw):
    return mapped_column(UUID(as_uuid=True), ForeignKey(target, **fk_kw), nullable=nullable, index=index)


class CaptureToken(Base):
    """Single-use, 10-minute token (K3, P6). `captured_at` is set when the camera first opens and is
    copied, never reset, when the token is renewed (U20); a retake starts a new chain."""
    __tablename__ = "capture_tokens"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = _uuid_fk("users.id", index=True)
    purpose: Mapped[str] = mapped_column(TOKEN_PURPOSE, nullable=False)
    report_id: Mapped[uuid.UUID | None] = _uuid_fk("reports.id", nullable=True, use_alter=True)  # verification tokens (cycle with reports)
    captured_at: Mapped[datetime] = ts(False)
    renewed_from_id: Mapped[uuid.UUID | None] = _uuid_fk("capture_tokens.id", nullable=True)
    retake_index: Mapped[int] = mapped_column(SmallInteger, default=1, nullable=False)
    issued_at: Mapped[datetime] = created_at()
    expires_at: Mapped[datetime] = ts(False)
    used_at: Mapped[datetime | None] = ts()


class Event(Base):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = uuid_pk()
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), nullable=False)
    centroid = mapped_column(Geography("POINT", srid=4326, spatial_index=True), nullable=False)
    first_seen: Mapped[datetime] = ts(False)
    last_seen: Mapped[datetime] = ts(False)
    report_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    resolved_at: Mapped[datetime | None] = ts()

    __table_args__ = (Index("ix_events_category_last_seen", "category_id", "last_seen"),)


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID | None] = _uuid_fk("users.id", nullable=True)   # null after account deletion
    report_type: Mapped[str] = mapped_column(REPORT_TYPE, nullable=False)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"))
    description: Mapped[str | None] = mapped_column(Text)
    location = mapped_column(Geography("POINT", srid=4326, spatial_index=True), nullable=True)  # price GPS optional (P-1)
    gps_accuracy_m: Mapped[float | None] = mapped_column(Float)
    ward_id: Mapped[int | None] = mapped_column(ForeignKey("wards.id"))
    ward_method: Mapped[str] = mapped_column(WARD_METHOD, default="none", nullable=False)
    event_id: Mapped[uuid.UUID | None] = _uuid_fk("events.id", nullable=True)
    capture_token_id: Mapped[uuid.UUID | None] = _uuid_fk("capture_tokens.id", nullable=True)
    device_id: Mapped[uuid.UUID | None] = _uuid_fk("devices.id", nullable=True)
    submitted_at: Mapped[datetime] = created_at()
    alpha: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    beta: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    credibility: Mapped[float] = mapped_column(Float, default=0.5, nullable=False)
    uncertainty: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    conflict: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    status: Mapped[str] = mapped_column(STATUS, default="pending", nullable=False)
    judging_status: Mapped[str | None] = mapped_column(JUDGING)
    flags = mapped_column(ARRAY(Text), server_default=text("'{}'"), nullable=False)
    components_used: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)
    visibility: Mapped[str] = mapped_column(VISIBILITY, default="visible", nullable=False)
    visibility_reason: Mapped[str | None] = mapped_column(Text)
    visibility_changed_at: Mapped[datetime | None] = ts()
    is_seed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)  # DEMO data (N13)

    __table_args__ = (
        CheckConstraint("alpha >= 1 AND beta >= 1", name="ck_reports_beta_prior"),
        CheckConstraint("description IS NULL OR char_length(description) <= 2000", name="ck_reports_description_len"),
        CheckConstraint("report_type <> 'civic' OR (category_id IS NOT NULL AND location IS NOT NULL)",
                        name="ck_reports_civic_fields"),
        Index("ix_reports_type_cat_time", "report_type", "category_id", "submitted_at"),
        Index("ix_reports_feed", "ward_id", "visibility", text("submitted_at DESC")),
        Index("ix_reports_user_time", "user_id", "submitted_at"),
    )


class PriceDetail(Base):
    __tablename__ = "price_details"

    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("reports.id", ondelete="CASCADE"),
                                                 primary_key=True)
    commodity_id: Mapped[int] = mapped_column(ForeignKey("commodities.id"), nullable=False)
    market_id: Mapped[int] = mapped_column(ForeignKey("markets.id"), nullable=False)
    price_bdt = mapped_column(Numeric(10, 2), nullable=False)
    unit_qty = mapped_column(Numeric(8, 3), default=1, nullable=False)
    observed_at: Mapped[datetime] = ts(False)        # date and time seen, entered by the user (P-1, C6)
    observed_date: Mapped[date] = mapped_column(Date, nullable=False)  # Asia/Dhaka calendar date

    __table_args__ = (
        CheckConstraint("price_bdt > 0", name="ck_price_positive"),
        Index("ix_price_cell", "commodity_id", "market_id", "observed_date"),
    )


class Evidence(Base):
    __tablename__ = "evidence"

    id: Mapped[uuid.UUID] = uuid_pk()
    report_id: Mapped[uuid.UUID | None] = _uuid_fk("reports.id", nullable=True)
    vote_id: Mapped[uuid.UUID | None] = _uuid_fk("votes.id", nullable=True)
    kind: Mapped[str] = mapped_column(EVIDENCE_KIND, nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    mime: Mapped[str] = mapped_column(String(40), nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    phash = mapped_column(BIT(64), nullable=False)
    capture_method: Mapped[str] = mapped_column(String(20), default="getusermedia", nullable=False)
    token_id: Mapped[uuid.UUID | None] = _uuid_fk("capture_tokens.id", nullable=True)
    received_at: Mapped[datetime] = created_at()

    __table_args__ = (
        CheckConstraint("(report_id IS NOT NULL) <> (vote_id IS NOT NULL)", name="ck_evidence_owner"),
    )


class Vote(Base):
    __tablename__ = "votes"

    id: Mapped[uuid.UUID] = uuid_pk()
    report_id: Mapped[uuid.UUID] = _uuid_fk("reports.id")
    voter_id: Mapped[uuid.UUID | None] = _uuid_fk("users.id", nullable=True)
    device_id: Mapped[uuid.UUID | None] = _uuid_fk("devices.id", nullable=True)
    decision: Mapped[str] = mapped_column(VOTE_DECISION, nullable=False)
    mode_claimed: Mapped[str] = mapped_column(VOTE_MODE, nullable=False)
    mode_verified: Mapped[str] = mapped_column(VOTE_MODE, nullable=False)
    distance_m: Mapped[float | None] = mapped_column(Float)      # raw vote GPS is never stored
    gps_accuracy_m: Mapped[float | None] = mapped_column(Float)
    in_ward: Mapped[bool | None] = mapped_column(Boolean)
    weight_at_vote: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = created_at()
    replaced_at: Mapped[datetime | None] = ts()

    __table_args__ = (
        CheckConstraint("decision <> 'fixed_now' OR mode_verified = 'on_spot'", name="ck_fixed_now_on_spot"),
        Index("uq_active_vote", "report_id", "voter_id", unique=True, postgresql_where=text("replaced_at IS NULL")),
        Index("ix_votes_active_report", "report_id", postgresql_where=text("replaced_at IS NULL")),
        Index("ix_votes_voter_time", "voter_id", "created_at"),
    )


class SavedPost(Base):
    __tablename__ = "saved_posts"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("reports.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = created_at()

    __table_args__ = (PrimaryKeyConstraint("user_id", "report_id"),)


class AbuseReport(Base):
    """A1: "Report abuse" sends a report to the admin queue; it never changes scores."""
    __tablename__ = "abuse_reports"

    id: Mapped[uuid.UUID] = uuid_pk()
    report_id: Mapped[uuid.UUID] = _uuid_fk("reports.id", index=True)
    reporter_id: Mapped[uuid.UUID | None] = _uuid_fk("users.id", nullable=True)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    state: Mapped[str] = mapped_column(ABUSE_STATE, default="open", nullable=False)
    created_at: Mapped[datetime] = created_at()
