from sqlalchemy import Column, Integer, String, Float, DateTime, Text, ForeignKey
from sqlalchemy.sql import func
from geoalchemy2 import Geometry

from app.database import Base


class TrustScore(Base):
    __tablename__ = "trust_scores"

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("reports.id"), nullable=False, index=True)

    reporter_reliability = Column(Float, default=0.0)
    evidence_consistency = Column(Float, default=0.0)
    location_consistency = Column(Float, default=0.0)
    community_agreement = Column(Float, default=0.0)
    historical_verification = Column(Float, default=0.0)

    final_score = Column(Float, default=0.0, index=True)
    explanation = Column(Text)
    calculated_at = Column(DateTime(timezone=True), server_default=func.now())


class DuplicateLink(Base):
    __tablename__ = "duplicates"

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("reports.id"), nullable=False, index=True)
    matched_report_id = Column(Integer, ForeignKey("reports.id"), nullable=False)

    geo_score = Column(Float)
    time_score = Column(Float)
    text_score = Column(Float)
    image_score = Column(Float)
    combined_score = Column(Float, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Hotspot(Base):
    __tablename__ = "hotspots"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String(60), nullable=False, index=True)

    center_lat = Column(Float, nullable=False)
    center_lng = Column(Float, nullable=False)
    center = Column(Geometry(geometry_type="POINT", srid=4326))

    report_count = Column(Integer, default=0)
    trust_weighted_strength = Column(Float, default=0.0)
    growth_percent = Column(Float, default=0.0)
    risk_level = Column(String(20), default="low")
    detected_at = Column(DateTime(timezone=True), server_default=func.now())