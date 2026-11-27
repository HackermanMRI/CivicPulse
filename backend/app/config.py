"""Environment settings (secrets and connection strings). Tunable rules live in config/civicpulse.yaml."""
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str
    REDIS_URL: str = "redis://redis:6379/0"
    SECRET_KEY: str = Field(min_length=32)          # no default: the app refuses to start without a real secret
    JWT_ISSUER: str = "civicpulse"
    JWT_AUDIENCE: str = "civicpulse-app"
    DEV_MODE: bool = False                          # shows the mock OTP on screen (Q32); never on in production
    OTP_TO_CONSOLE: bool = False                    # print each OTP in the api log so the host can read it out
    FRONTEND_ORIGIN: str = "https://localhost"     # comma-separated list, e.g. "https://localhost,https://192.168.0.105"
    UPLOAD_DIR: str = "/data/uploads"
    CONFIG_PATH: str | None = None                  # defaults to config/civicpulse.yaml
    IP_HASH_SALT: str = Field(min_length=16)
    JOBS_INLINE: bool = False                       # run worker jobs inside the request (tests, or no worker running)
    COOKIE_SECURE: bool = True                      # refresh cookie only over HTTPS (localhost counts as secure in browsers)
    MODELS_DIR: str = "/models"
    STATIC_DIR: str | None = None                   # serve the built frontend from the API (local runs without nginx)
    # Database connections per API worker process. Total = API_WORKERS × (DB_POOL_SIZE + DB_MAX_OVERFLOW) and must
    # stay under Postgres max_connections (100 by default) together with the worker and scheduler.
    DB_POOL_SIZE: int = Field(5, ge=1, le=50)
    DB_MAX_OVERFLOW: int = Field(10, ge=0, le=50)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
