"""add_invite_codes

Revision ID: 2c9c2adf0d14
Revises: 616aa8db2890
Create Date: 2025-12-13 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "2c9c2adf0d14"
down_revision: Union[str, Sequence[str], None] = "616aa8db2890"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "invite_codes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("used_by_user_id", sa.Integer(), nullable=True),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["used_by_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_invite_codes_id", "invite_codes", ["id"])
    op.create_index("ix_invite_codes_code", "invite_codes", ["code"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_invite_codes_code", table_name="invite_codes")
    op.drop_index("ix_invite_codes_id", table_name="invite_codes")
    op.drop_table("invite_codes")

