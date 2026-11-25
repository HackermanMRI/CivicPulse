"""Public profile fields on users (UI v2, 26 Nov 2026): bio, occupation, website, public-email switch,
interests, avatar and the time of the last name change (for the name-change limit).

All columns are optional or have defaults, so existing rows need no backfill.

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("bio", sa.String(160)))
    op.add_column("users", sa.Column("occupation", sa.String(60)))
    op.add_column("users", sa.Column("website", sa.String(200)))
    op.add_column("users", sa.Column("email_public", sa.Boolean(), server_default=sa.text("false"), nullable=False))
    op.add_column("users", sa.Column("interests", postgresql.ARRAY(sa.String(40)), server_default="{}", nullable=False))
    op.add_column("users", sa.Column("avatar_path", sa.Text()))
    op.add_column("users", sa.Column("avatar_updated_at", sa.DateTime(timezone=True)))
    op.add_column("users", sa.Column("name_changed_at", sa.DateTime(timezone=True)))
    op.create_check_constraint("users_website_scheme", "users", "website IS NULL OR website ~ '^https?://'")


def downgrade() -> None:
    op.drop_constraint("users_website_scheme", "users", type_="check")
    for col in ("name_changed_at", "avatar_updated_at", "avatar_path", "interests", "email_public", "website", "occupation", "bio"):
        op.drop_column("users", col)
