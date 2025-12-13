"""site_settings_and_client_website

Revision ID: 0f4e5d1b8b7d
Revises: 7a9f5b1a2c31
Create Date: 2025-12-13 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0f4e5d1b8b7d"
down_revision: Union[str, Sequence[str], None] = "7a9f5b1a2c31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if "system_settings" not in insp.get_table_names():
        op.create_table(
            "system_settings",
            sa.Column("key", sa.String(length=100), primary_key=True),
            sa.Column("value", sa.Text(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )

    existing_client_columns = {c["name"] for c in insp.get_columns("clients")}
    with op.batch_alter_table("clients", schema=None) as batch_op:
        if "website_url" not in existing_client_columns:
            batch_op.add_column(sa.Column("website_url", sa.String(length=500), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    existing_client_columns = {c["name"] for c in insp.get_columns("clients")}
    with op.batch_alter_table("clients", schema=None) as batch_op:
        if "website_url" in existing_client_columns:
            batch_op.drop_column("website_url")

    if "system_settings" in insp.get_table_names():
        op.drop_table("system_settings")

