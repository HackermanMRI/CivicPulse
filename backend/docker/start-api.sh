#!/bin/sh
# Apply migrations as the schema owner, load the category config, then start the API as the app role.
set -eu
alembic upgrade head
python -m app.cli seed-config
# Several worker processes share the port, and the kernel spreads new connections across them (load balancing on
# one machine). Safe because the API keeps no state in memory between requests: sessions, rate limits and live
# updates (SSE) are in Redis and the database. Default: one per CPU core, at most 4 (see DB_POOL_SIZE in app/config.py).
CORES=$(nproc 2>/dev/null || echo 1)
DEFAULT_WORKERS=$(( CORES < 4 ? CORES : 4 ))
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips="*" \
  --workers "${API_WORKERS:-$DEFAULT_WORKERS}"
