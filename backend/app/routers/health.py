from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db

router = APIRouter(prefix="/api/health", tags=["Health"])


@router.get("")
def health_check(db: Session = Depends(get_db)):
    database_ok = True
    postgis_version = None

    try:
        postgis_version = db.execute(text("SELECT PostGIS_Version()")).scalar()
    except Exception:
        database_ok = False

    return {
        "status": "ok",
        "database": database_ok,
        "postgis": postgis_version,
    }