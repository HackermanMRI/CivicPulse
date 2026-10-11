"""Identity and access tables (spec §7)."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, Enum, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at, ts, uuid_pk

ROLE = Enum("citizen", "admin", name="user_role")
USER_STATE = Enum("active", "flagged", "suspended", "deleted", name="user_state")
ADDRESS_KIND = Enum("home", "work", "other", name="address_kind")
CONSENT_PURPOSE = Enum("location", "camera", "research_use", name="consent_purpose")
OTP_PURPOSE = Enum("signup", "reset", "admin", name="otp_purpose")


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    display_name: Mapped[str | None] = mapped_column(String(80))
    phone: Mapped[str | None] = mapped_column(String(20), unique=True)  # E.164; null after deletion
    phone_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    email: Mapped[str | None] = mapped_column(String(254))              # optional (login screen note)
    pass_hash: Mapped[str | None] = mapped_column(Text)                 # argon2id encoded
    role: Mapped[str] = mapped_column(ROLE, default="citizen", nullable=False)
    state: Mapped[str] = mapped_column(USER_STATE, default="active", nullable=False)
    preferred_module: Mapped[str | None] = mapped_column(String(20))    # green_guard | price_patrol
    suspended_at: Mapped[datetime | None] = ts()
    created_at: Mapped[datetime] = created_at()
    deleted_at: Mapped[datetime | None] = ts()

    __table_args__ = (
        CheckConstraint("preferred_module IS NULL OR preferred_module IN ('green_guard','price_patrol')",
                        name="ck_users_module"),
    )


class UserAddress(Base):
    __tablename__ = "user_addresses"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    ward_id: Mapped[int | None] = mapped_column(ForeignKey("wards.id"))  # null = outside the pilot area
    kind: Mapped[str] = mapped_column(ADDRESS_KIND, nullable=False)
    created_at: Mapped[datetime] = created_at()

    __table_args__ = (UniqueConstraint("user_id", "ward_id", "kind", name="uq_address"),)


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    device_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)  # SHA-256 of the random device id
    first_seen: Mapped[datetime] = created_at()
    last_seen: Mapped[datetime | None] = ts()


class OtpCode(Base):
    __tablename__ = "otp_codes"

    id: Mapped[uuid.UUID] = uuid_pk()
    phone: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    purpose: Mapped[str] = mapped_column(OTP_PURPOSE, nullable=False)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = ts(False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    used_at: Mapped[datetime | None] = ts()
    created_at: Mapped[datetime] = created_at()


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    family_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    issued_at: Mapped[datetime] = created_at()
    expires_at: Mapped[datetime] = ts(False)
    revoked_at: Mapped[datetime | None] = ts()
    replaced_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))


class Consent(Base):
    __tablename__ = "consents"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(CONSENT_PURPOSE, nullable=False)
    granted: Mapped[bool] = mapped_column(Boolean, nullable=False)
    version: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = created_at()
