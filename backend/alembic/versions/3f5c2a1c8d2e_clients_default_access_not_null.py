"""clients_default_access_not_null

Revision ID: 3f5c2a1c8d2e
Revises: 0f4e5d1b8b7d
Create Date: 2025-12-13 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "3f5c2a1c8d2e"
down_revision: Union[str, Sequence[str], None] = "0f4e5d1b8b7d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "clients" not in insp.get_table_names():
        return

    existing_columns = {c["name"] for c in insp.get_columns("clients")}
    if "default_access" not in existing_columns:
        return

    op.execute("UPDATE clients SET default_access = 0 WHERE default_access IS NULL")

    with op.batch_alter_table("clients", schema=None) as batch_op:
        try:
            batch_op.alter_column(
                "default_access",
                existing_type=sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        except Exception:
            pass


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "clients" not in insp.get_table_names():
        return

    existing_columns = {c["name"] for c in insp.get_columns("clients")}
    if "default_access" not in existing_columns:
        return

    with op.batch_alter_table("clients", schema=None) as batch_op:
        try:
            batch_op.alter_column(
                "default_access",
                existing_type=sa.Boolean(),
                nullable=True,
                server_default=None,
            )
        except Exception:
            pass
