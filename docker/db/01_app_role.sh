#!/bin/sh
# Runs once when the database volume is first created.
# Creates the limited role the API uses; Alembic grants it table rights (audit_log: INSERT/SELECT only).
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'civicpulse_app') THEN
    CREATE ROLE civicpulse_app LOGIN PASSWORD '${APP_DB_PASSWORD}';
  END IF;
END
\$\$;
GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO civicpulse_app;
SQL
