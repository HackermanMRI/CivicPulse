from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.scoring.params import load_params

router = APIRouter(prefix="/api/health", tags=["Health"])


@router.get("")
def health_check(db: Session = Depends(get_db)):
    try:
        postgis = db.execute(text("SELECT PostGIS_Version()")).scalar()
        tables = db.execute(text(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
        )).scalar()
        migration = db.execute(text("SELECT version_num FROM alembic_version")).scalar()
        categories = db.execute(text("SELECT count(*) FROM categories")).scalar()
        database_ok = True
    except Exception:  # noqa: BLE001 - health must answer even when the DB is down
        postgis = tables = migration = categories = None
        database_ok = False
    return {
        "status": "ok" if database_ok else "degraded",
        "database": database_ok,
        "postgis": postgis,
        "migration": migration,
        "tables": tables,
        "categories": categories,
        "config_hash": load_params().config_hash[:12],
    }
