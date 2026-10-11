"""Reference lists: pilot wards, markets, categories and commodities (spec §2 geo module)."""
from fastapi import APIRouter, Depends, Query
from geoalchemy2 import Geography
from sqlalchemy import cast, func
from sqlalchemy.orm import Session

from app.core.deps import current_user, get_db
from app.models import Category, Commodity, Market, User, Ward

router = APIRouter(prefix="/api", tags=["Reference"])


@router.get("/wards")
def wards(db: Session = Depends(get_db)):
    rows = db.query(Ward, func.ST_Y(func.ST_GeomFromWKB(func.ST_AsBinary(Ward.ref_point))),
                    func.ST_X(func.ST_GeomFromWKB(func.ST_AsBinary(Ward.ref_point)))).order_by(Ward.name_en).all()
    return [{"id": w.id, "name_en": w.name_en, "name_bn": w.name_bn, "city_corp": w.city_corp, "district": w.district,
             "has_polygon": w.geom is not None, "lat": lat, "lon": lon, "is_demo": w.is_demo} for w, lat, lon in rows]


@router.get("/wards/locate")
def locate_ward(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The ward a point falls in, with the same rule as reports (R34): polygon first, else the nearest ward
    reference point within its fallback radius. Shown on the report form as "Detected ward"; the server
    assigns the real ward again when the report is posted."""
    wkt = func.ST_SetSRID(func.ST_MakePoint(lon, lat), 4326)
    same_kind = Ward.is_demo.is_(bool(user.is_seed))
    w = db.query(Ward).filter(same_kind, Ward.geom.isnot(None), func.ST_Covers(Ward.geom, wkt)).first()
    if w is None:
        loc = cast(wkt, Geography)
        w = (db.query(Ward).filter(same_kind, Ward.geom.is_(None), func.ST_DWithin(Ward.ref_point, loc, Ward.fallback_radius_m))
             .order_by(func.ST_Distance(Ward.ref_point, loc)).first())
    return {"ward": None if w is None else {"id": w.id, "name_en": w.name_en, "name_bn": w.name_bn}}


@router.get("/markets")
def markets(db: Session = Depends(get_db)):
    rows = (db.query(Market, Ward.name_en, func.ST_Y(func.ST_GeomFromWKB(func.ST_AsBinary(Market.location))),
                     func.ST_X(func.ST_GeomFromWKB(func.ST_AsBinary(Market.location))))
            .outerjoin(Ward, Ward.id == Market.ward_id).order_by(Market.name_en).all())
    return [{"id": m.id, "name_en": m.name_en, "name_bn": m.name_bn, "ward_id": m.ward_id, "ward_name_en": ward_name,
             "radius_m": m.radius_m, "lat": lat, "lon": lon, "verified": m.verified, "is_demo": m.is_demo}
            for m, ward_name, lat, lon in rows]


@router.get("/categories")
def categories(db: Session = Depends(get_db)):
    return [{"id": c.id, "code": c.code, "name_en": c.name_en, "name_bn": c.name_bn}
            for c in db.query(Category).filter_by(active=True).order_by(Category.id).all()]


@router.get("/commodities")
def commodities(db: Session = Depends(get_db)):
    return [{"id": c.id, "name_en": c.name_en, "name_bn": c.name_bn, "variant": c.variant, "unit": c.unit,
             "is_demo": c.is_demo}
            for c in db.query(Commodity).filter_by(active=True).order_by(Commodity.name_en, Commodity.variant).all()]
