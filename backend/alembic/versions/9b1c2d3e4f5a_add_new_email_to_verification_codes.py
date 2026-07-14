"""add new_email to verification_codes for change-email flow

Revision ID: 9b1c2d3e4f5a
Revises: 7d8e9f0a1b2c
Create Date: 2026-07-14 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = '9b1c2d3e4f5a'
down_revision: Union[str, None] = '7d8e9f0a1b2c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table."""
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns


def upgrade() -> None:
    # change-email 流程:待验证的新邮箱暂存于此,验证通过后才写入 users.email
    with op.batch_alter_table('verification_codes') as batch_op:
        if not column_exists('verification_codes', 'new_email'):
            batch_op.add_column(sa.Column('new_email', sa.String(100), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('verification_codes') as batch_op:
        if column_exists('verification_codes', 'new_email'):
            batch_op.drop_column('new_email')
