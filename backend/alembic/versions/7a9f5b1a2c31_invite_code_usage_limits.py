"""invite_code_usage_limits

Revision ID: 7a9f5b1a2c31
Revises: 2c9c2adf0d14
Create Date: 2025-12-13 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "7a9f5b1a2c31"
down_revision: Union[str, Sequence[str], None] = "2c9c2adf0d14"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # invite_codes columns may already exist if tables were created via Base.metadata.create_all
    existing_columns = {c["name"] for c in insp.get_columns("invite_codes")}
    with op.batch_alter_table("invite_codes", schema=None) as batch_op:
        if "max_uses" not in existing_columns:
            batch_op.add_column(sa.Column("max_uses", sa.Integer(), nullable=True))
        if "used_count" not in existing_columns:
            batch_op.add_column(sa.Column("used_count", sa.Integer(), nullable=True, server_default="0"))

    # Backfill: old single-use rows (only if used_count exists)
    existing_columns = {c["name"] for c in insp.get_columns("invite_codes")}
    if "used_count" in existing_columns:
        op.execute(
            "UPDATE invite_codes SET used_count = CASE WHEN used_at IS NULL THEN 0 ELSE 1 END WHERE used_count IS NULL"
        )

    # Ensure used_count is non-null for new data (best-effort; SQLite may already have it)
    if "used_count" in existing_columns:
        with op.batch_alter_table("invite_codes", schema=None) as batch_op:
            try:
                batch_op.alter_column("used_count", nullable=False, server_default="0")
            except Exception:
                # SQLite / existing schema: ignore
                pass

    # Create redemption table if missing
    if "invite_redemptions" not in insp.get_table_names():
        op.create_table(
            "invite_redemptions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("invite_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("used_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["invite_id"], ["invite_codes.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        )

    # Create indexes if missing
    existing_indexes = {ix["name"] for ix in insp.get_indexes("invite_redemptions")} if "invite_redemptions" in insp.get_table_names() else set()
    if "ix_invite_redemptions_id" not in existing_indexes:
        op.create_index("ix_invite_redemptions_id", "invite_redemptions", ["id"])
    if "ix_invite_redemptions_invite_id" not in existing_indexes:
        op.create_index("ix_invite_redemptions_invite_id", "invite_redemptions", ["invite_id"])
    if "ix_invite_redemptions_user_id" not in existing_indexes:
        op.create_index("ix_invite_redemptions_user_id", "invite_redemptions", ["user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if "invite_redemptions" in insp.get_table_names():
        existing_indexes = {ix["name"] for ix in insp.get_indexes("invite_redemptions")}
        if "ix_invite_redemptions_user_id" in existing_indexes:
            op.drop_index("ix_invite_redemptions_user_id", table_name="invite_redemptions")
        if "ix_invite_redemptions_invite_id" in existing_indexes:
            op.drop_index("ix_invite_redemptions_invite_id", table_name="invite_redemptions")
        if "ix_invite_redemptions_id" in existing_indexes:
            op.drop_index("ix_invite_redemptions_id", table_name="invite_redemptions")
        op.drop_table("invite_redemptions")

    existing_columns = {c["name"] for c in insp.get_columns("invite_codes")}
    with op.batch_alter_table("invite_codes", schema=None) as batch_op:
        if "used_count" in existing_columns:
            batch_op.drop_column("used_count")
        if "max_uses" in existing_columns:
            batch_op.drop_column("max_uses")
