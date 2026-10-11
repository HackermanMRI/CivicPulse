#!/bin/sh
# Apply migrations as the schema owner, load the category config, then start the API as the app role.
set -eu
alembic upgrade head
python -m app.cli seed-config
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers
