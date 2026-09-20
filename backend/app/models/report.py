from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from geoalchemy2 import Geometry

from app.database import Base


class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    report_type = Column(String(20), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    description = Column(Text)

    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    location = Column(Geometry(geometry_type="POINT", srid=4326))
    accuracy_meters = Column(Float)

    status = Column(String(30), default="pending", nullable=False, index=True)
    trust_score = Column(Float, default=0.0)
    consistency_score = Column(Float)
    duplicate_of_id = Column(Integer, ForeignKey("reports.id"), nullable=True)

    reported_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")


class PriceReport(Base):
    __tablename__ = "price_reports"

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("reports.id"), unique=True, nullable=False)
    commodity_id = Column(Integer, ForeignKey("commodities.id"), nullable=False)
    market_id = Column(Integer, ForeignKey("markets.id"), nullable=True)

    price = Column(Float, nullable=False)
    unit = Column(String(20), nullable=False)
    deviation_percent = Column(Float)
    is_anomaly = Column(Boolean, default=False)


class CivicReport(Base):
    __tablename__ = "civic_reports"

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("reports.id"), unique=True, nullable=False)
    category = Column(String(60), nullable=False, index=True)
    severity = Column(Integer, default=1, nullable=False)


class Evidence(Base):
    __tablename__ = "evidence"

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("reports.id"), nullable=False, index=True)
    file_path = Column(String(300), nullable=False)
    file_type = Column(String(30), default="image")
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())