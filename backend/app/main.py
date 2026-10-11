import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from app.config import settings
from app.routers import admin, auth, capture, feed, geo, health, insights, notifications, prices, reports, users, votes

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

app = FastAPI(
    title="CivicPulse API",
    description="Trust-aware credibility and uncertainty for crowdsourced civic and price reports",
    version="0.3.0",
    docs_url="/api/docs" if settings.DEV_MODE else None,   # no public API docs outside development
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.DEV_MODE else None,
)

# In production the app and API share one origin through nginx, so CORS stays closed (spec §8).
# During development the Vite server runs on another port, so allow only that origin.
if settings.DEV_MODE:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.FRONTEND_ORIGIN.split(",") if o.strip()] + ["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Device-Id"],
    )


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Same headers nginx sets, so a direct run of the API (no nginx) is not weaker."""
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


for r in (health, auth, users, geo, capture, reports, feed, votes, notifications, insights, prices, admin):
    app.include_router(r.router)


# Optional: serve the built React app from the API for a laptop run without nginx (STATIC_DIR=frontend/dist).
if settings.STATIC_DIR:
    static_root = Path(settings.STATIC_DIR).resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        target = (static_root / path).resolve()
        if path and static_root in target.parents and target.is_file():
            return FileResponse(target)
        return FileResponse(static_root / "index.html", headers={"Cache-Control": "no-cache"})
