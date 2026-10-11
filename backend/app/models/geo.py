"""Geography and catalogue tables (spec §7)."""
from __future__ import annotations

from geoalchemy2 import Geography, Geometry
from sqlalchemy import ARRAY, Boolean, CheckConstraint, Enum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

MARKET_SOURCE = Enum("osm", "field", name="market_source")
UNIT = Enum("kg", "litre", "piece", "hali", "dozen", name="commodity_unit")


class Ward(Base):
    __tablename__ = "wards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name_en: Mapped[str] = mapped_column(Text, nullable=False)
    name_bn: Mapped[str] = mapped_column(Text, nullable=False)
    city_corp: Mapped[str | None] = mapped_column(Text)
    district: Mapped[str | None] = mapped_column(Text)
    geom = mapped_column(Geometry("MULTIPOLYGON", srid=4326, spatial_index=True), nullable=True)
    ref_point = mapped_column(Geography("POINT", srid=4326), nullable=False)
    fallback_radius_m: Mapped[int] = mapped_column(Integer, default=300, nullable=False)
    source: Mapped[str | None] = mapped_column(Text)
    verified_by: Mapped[str | None] = mapped_column(Text)


class Market(Base):
    __tablename__ = "markets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name_en: Mapped[str] = mapped_column(Text, nullable=False)
    name_bn: Mapped[str] = mapped_column(Text, nullable=False)
    ward_id: Mapped[int | None] = mapped_column(ForeignKey("wards.id"))
    location = mapped_column(Geography("POINT", srid=4326, spatial_index=True), nullable=False)
    radius_m: Mapped[int] = mapped_column(Integer, default=150, nullable=False)
    source: Mapped[str] = mapped_column(MARKET_SOURCE, nullable=False)
    verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    name_en: Mapped[str] = mapped_column(Text, nullable=False)
    name_bn: Mapped[str] = mapped_column(Text, nullable=False)
    impact = mapped_column(Numeric(3, 2), nullable=False)
    extent = mapped_column(Numeric(3, 2), nullable=False)
    urgency = mapped_column(Numeric(3, 2), nullable=False)
    text_prototypes = mapped_column(ARRAY(Text), nullable=False)
    clip_prompts = mapped_column(ARRAY(Text), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    __table_args__ = tuple(
        CheckConstraint(f"{c} >= 0 AND {c} <= 1", name=f"ck_categories_{c}") for c in ("impact", "extent", "urgency")
    )


class Commodity(Base):
    __tablename__ = "commodities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name_en: Mapped[str] = mapped_column(Text, nullable=False)
    name_bn: Mapped[str] = mapped_column(Text, nullable=False)
    variant: Mapped[str] = mapped_column(Text, nullable=False)
    unit: Mapped[str] = mapped_column(UNIT, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    __table_args__ = (UniqueConstraint("name_en", "variant", "unit", name="uq_commodity"),)
