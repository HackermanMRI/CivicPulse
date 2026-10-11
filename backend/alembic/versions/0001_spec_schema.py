"""Baseline: replace the Day 1 tables with the full spec schema (§7).

The Day 1 tables held no real data, so they are dropped. The schema itself is frozen
SQL (0001_schema.sql, made once with pg_dump from the models), so this migration gives
the same database forever, whatever the models look like later. Every later change gets
its own migration (`alembic revision --autogenerate -m "..."`, then review it).

Revision ID: 0001
Revises:
"""
from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

DAY1_TABLES = ["trust_scores", "duplicates", "hotspots", "evidence", "civic_reports", "price_reports",
               "reports", "markets", "commodities", "users"]

AUDIT_GUARD = """
CREATE OR REPLACE FUNCTION audit_log_block_changes() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_block_changes();
"""


GRANTS = """
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'civicpulse_app') THEN
        GRANT USAGE ON SCHEMA public TO civicpulse_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO civicpulse_app;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO civicpulse_app;
        REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM civicpulse_app;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO civicpulse_app;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO civicpulse_app;
    END IF;
END $$;
"""


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    for table in DAY1_TABLES:
        op.execute(f'DROP TABLE IF EXISTS "{table}" CASCADE')
    op.get_bind().exec_driver_sql((Path(__file__).with_name("0001_schema.sql")).read_text(encoding="utf-8"))
    op.execute(AUDIT_GUARD)
    op.execute(GRANTS)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log")
    op.execute("DROP FUNCTION IF EXISTS audit_log_block_changes()")
    import re

    sql = Path(__file__).with_name("0001_schema.sql").read_text(encoding="utf-8")
    for table in re.findall(r"CREATE TABLE public\.(\w+)", sql):
        op.execute(f'DROP TABLE IF EXISTS public."{table}" CASCADE')
    for enum in re.findall(r"CREATE TYPE public\.(\w+)", sql):
        op.execute(f'DROP TYPE IF EXISTS public."{enum}"')
