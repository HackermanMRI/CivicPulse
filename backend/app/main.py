from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import health

app = FastAPI(
    title="CivicPulse API",
    description="Trust-aware credibility and uncertainty for crowdsourced civic and price reports",
    version="0.2.0",
    docs_url="/api/docs" if settings.DEV_MODE else None,   # no public API docs outside development
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.DEV_MODE else None,
)

# In production the app and API share one origin through nginx, so CORS stays closed (spec §8).
# During development the Vite server runs on another port, so allow only that origin.
if settings.DEV_MODE:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.FRONTEND_ORIGIN, "http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Device-Id"],
    )

app.include_router(health.router)
