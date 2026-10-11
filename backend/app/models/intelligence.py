"""Prices, analytics and notification tables (spec §7; A2 price watch list)."""
from __future__ import annotations

import uuid
from datetime import date, datetime

from geoalchemy2 import Geography, Geometry
from sqlalchemy import (
    ARRAY, Boolean, Date, Enum, Float, ForeignKey, Index, Integer, Numeric, PrimaryKeyConstraint, Text,
    UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at, ts, uuid_pk

VERIFIED_STATUS = Enum("Verified", "Insufficient Evidence", name="verified_status")
REF_SOURCE = Enum("TCB", "DAM", "field", name="reference_source")
ALERT_TEST = Enum("c_test", "negative_binomial", name="alert_test")
NOTIFY_KIND = Enum("new_report_in_ward", "own_report_status", "pinned_report_status", "emerging_issue",
                   "price_alert", name="notification_kind")


class VerifiedPrice(Base):
    __tablename__ = "verified_prices"

    id: Mapped[uuid.UUID] = uuid_pk()
    commodity_id: Mapped[int] = mapped_column(ForeignKey("commodities.id"), nullable=False)
    market_id: Mapped[int] = mapped_column(ForeignKey("markets.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    verified_price = mapped_column(Numeric(10, 2))
    report_count: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(VERIFIED_STATUS, nullable=False)
    report_ids = mapped_column(ARRAY(UUID(as_uuid=True)), nullable=False)
    computed_at: Mapped[datetime] = created_at()

    __table_args__ = (UniqueConstraint("commodity_id", "market_id", "date", name="uq_verified_cell"),)


class ReferencePrice(Base):
    __tablename__ = "reference_prices"

    id: Mapped[uuid.UUID] = uuid_pk()
    source: Mapped[str] = mapped_column(REF_SOURCE, nullable=False)
    commodity_id: Mapped[int] = mapped_column(ForeignKey("commodities.id"), nullable=False)
    market_id: Mapped[int | None] = mapped_column(ForeignKey("markets.id"))
    date: Mapped[date] = mapped_column(Date, nullable=False)
    min_bdt = mapped_column(Numeric(10, 2), nullable=False)
    max_bdt = mapped_column(Numeric(10, 2), nullable=False)


class PriceWatch(Base):
    """A2: price rise/drop alerts only for products the user chose to watch."""
    __tablename__ = "price_alert_watch"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    commodity_id: Mapped[int] = mapped_column(ForeignKey("commodities.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = created_at()

    __table_args__ = (PrimaryKeyConstraint("user_id", "commodity_id"),)


class Hotspot(Base):
    __tablename__ = "hotspots"

    id: Mapped[uuid.UUID] = uuid_pk()
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), nullable=False)
    centroid = mapped_column(Geography("POINT", srid=4326), nullable=False)
    hull = mapped_column(Geometry("POLYGON", srid=4326), nullable=True)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    s_severity: Mapped[float] = mapped_column(Float, nullable=False)
    v_volume: Mapped[float] = mapped_column(Float, nullable=False)
    c_compact: Mapped[float] = mapped_column(Float, nullable=False)
    t_trust: Mapped[float] = mapped_column(Float, nullable=False)
    n_reports: Mapped[int] = mapped_column(Integer, nullable=False)
    n_users: Mapped[int] = mapped_column(Integer, nullable=False)
    report_ids = mapped_column(ARRAY(UUID(as_uuid=True)), nullable=False)
    window_start: Mapped[datetime] = ts(False)
    window_end: Mapped[datetime] = ts(False)
    eps_m: Mapped[float] = mapped_column(Float, nullable=False)
    min_samples: Mapped[int] = mapped_column(Integer, nullable=False)
    config_hash: Mapped[str] = mapped_column(Text, nullable=False)
    computed_at: Mapped[datetime] = created_at()


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[uuid.UUID] = uuid_pk()
    kind: Mapped[str] = mapped_column(Text, default="emerging_issue", nullable=False)
    ward_id: Mapped[int] = mapped_column(ForeignKey("wards.id"), nullable=False)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), nullable=False)
    test_date: Mapped[date] = mapped_column(Date, nullable=False)
    observed: Mapped[int] = mapped_column(Integer, nullable=False)
    baseline_n: Mapped[int] = mapped_column(Integer, nullable=False)
    baseline_days: Mapped[int] = mapped_column(Integer, nullable=False)
    p_value: Mapped[float] = mapped_column(Float, nullable=False)
    test: Mapped[str] = mapped_column(ALERT_TEST, nullable=False)
    mean_credibility: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = created_at()

    __table_args__ = (UniqueConstraint("ward_id", "category_id", "test_date", name="uq_alert_cell_day"),)


class LiveDay(Base):
    __tablename__ = "live_days"

    date: Mapped[date] = mapped_column(Date, primary_key=True)
    live: Mapped[bool] = mapped_column(Boolean, nullable=False)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(NOTIFY_KIND, nullable=False)
    report_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("reports.id"))
    payload = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = created_at()
    read_at: Mapped[datetime | None] = ts()

    __table_args__ = (
        Index("ix_notifications_unread", "user_id", text("created_at DESC"), postgresql_where=text("read_at IS NULL")),
        Index("ix_notifications_user_time", "user_id", text("created_at DESC")),
    )
