from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from geoalchemy2 import Geometry

from app.database import Base


class Commodity(Base):
    __tablename__ = "commodities"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(80), unique=True, nullable=False)
    unit = Column(String(20), nullable=False)
    category = Column(String(50))
    is_active = Column(Boolean, default=True, nullable=False)


class Market(Base):
    __tablename__ = "markets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    area = Column(String(120))
    city = Column(String(80))
    location = Column(Geometry(geometry_type="POINT", srid=4326))
    created_at = Column(DateTime(timezone=True), server_default=func.now())