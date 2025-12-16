"""add email_verified to users

Revision ID: 7d8e9f0a1b2c
Revises: 6c7d8e9f0a1b
Create Date: 2024-12-16 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = '7d8e9f0a1b2c'
down_revision: Union[str, None] = '6c7d8e9f0a1b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table."""
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns


def upgrade() -> None:
    # Add email_verified and email_verified_at to users table
    with op.batch_alter_table('users') as batch_op:
        if not column_exists('users', 'email_verified'):
            batch_op.add_column(sa.Column('email_verified', sa.Boolean(), nullable=False, server_default='0'))
        if not column_exists('users', 'email_verified_at'):
            batch_op.add_column(sa.Column('email_verified_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        if column_exists('users', 'email_verified'):
            batch_op.drop_column('email_verified')
        if column_exists('users', 'email_verified_at'):
            batch_op.drop_column('email_verified_at')
