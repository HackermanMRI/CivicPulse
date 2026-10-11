"""Reference lists: pilot wards, markets, categories and commodities (spec §2 geo module)."""
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models import Category, Commodity, Market, Ward

router = APIRouter(prefix="/api", tags=["Reference"])


@router.get("/wards")
def wards(db: Session = Depends(get_db)):
    rows = db.query(Ward, func.ST_Y(func.ST_GeomFromWKB(func.ST_AsBinary(Ward.ref_point))),
                    func.ST_X(func.ST_GeomFromWKB(func.ST_AsBinary(Ward.ref_point)))).order_by(Ward.name_en).all()
    return [{"id": w.id, "name_en": w.name_en, "name_bn": w.name_bn, "city_corp": w.city_corp, "district": w.district,
             "has_polygon": w.geom is not None, "lat": lat, "lon": lon, "is_demo": w.is_demo} for w, lat, lon in rows]


@router.get("/markets")
def markets(db: Session = Depends(get_db)):
    rows = db.query(Market, func.ST_Y(func.ST_GeomFromWKB(func.ST_AsBinary(Market.location))),
                    func.ST_X(func.ST_GeomFromWKB(func.ST_AsBinary(Market.location)))).order_by(Market.name_en).all()
    return [{"id": m.id, "name_en": m.name_en, "name_bn": m.name_bn, "ward_id": m.ward_id, "radius_m": m.radius_m,
             "lat": lat, "lon": lon, "verified": m.verified, "is_demo": m.is_demo} for m, lat, lon in rows]


@router.get("/categories")
def categories(db: Session = Depends(get_db)):
    return [{"id": c.id, "code": c.code, "name_en": c.name_en, "name_bn": c.name_bn}
            for c in db.query(Category).filter_by(active=True).order_by(Category.id).all()]


@router.get("/commodities")
def commodities(db: Session = Depends(get_db)):
    return [{"id": c.id, "name_en": c.name_en, "name_bn": c.name_bn, "variant": c.variant, "unit": c.unit,
             "is_demo": c.is_demo}
            for c in db.query(Commodity).filter_by(active=True).order_by(Commodity.name_en, Commodity.variant).all()]
