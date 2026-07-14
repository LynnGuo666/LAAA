"""add token_version to users for access token revocation

Revision ID: a1b2c3d4e5f6
Revises: 9b1c2d3e4f5a
Create Date: 2026-07-14 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '9b1c2d3e4f5a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns


def upgrade() -> None:
    # token_version: 改密/封禁时 +1,使旧 access token (含 tv claim) 立即失效
    with op.batch_alter_table('users') as batch_op:
        if not column_exists('users', 'token_version'):
            batch_op.add_column(sa.Column('token_version', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        if column_exists('users', 'token_version'):
            batch_op.drop_column('token_version')
