"""add session security features

Revision ID: 5b6c7d8e9f0a
Revises: 4a2b3c4d5e6f
Create Date: 2024-12-16 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = '5b6c7d8e9f0a'
down_revision: Union[str, None] = '4a2b3c4d5e6f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def table_exists(table_name: str) -> bool:
    """Check if a table exists."""
    bind = op.get_bind()
    inspector = inspect(bind)
    return table_name in inspector.get_table_names()


def column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table."""
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns


def upgrade() -> None:
    # Create login_logs table if not exists
    if not table_exists('login_logs'):
        op.create_table(
            'login_logs',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=True),
            sa.Column('username', sa.String(50), nullable=False),
            sa.Column('success', sa.Boolean(), default=False),
            sa.Column('failure_reason', sa.String(100), nullable=True),
            sa.Column('ip_address', sa.String(50), nullable=True),
            sa.Column('user_agent', sa.Text(), nullable=True),
            sa.Column('device_type', sa.String(50), nullable=True),
            sa.Column('device_name', sa.String(100), nullable=True),
            sa.Column('country', sa.String(100), nullable=True),
            sa.Column('city', sa.String(100), nullable=True),
            sa.Column('latitude', sa.String(20), nullable=True),
            sa.Column('longitude', sa.String(20), nullable=True),
            sa.Column('is_suspicious', sa.Boolean(), default=False),
            sa.Column('suspicious_reasons', sa.Text(), nullable=True),
            sa.Column('kicked_session_id', sa.Integer(), nullable=True),
            sa.Column('login_method', sa.String(20), default='password'),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index('ix_login_logs_user_id', 'login_logs', ['user_id'])
        op.create_index('ix_login_logs_ip_address', 'login_logs', ['ip_address'])
        op.create_index('ix_login_logs_created_at', 'login_logs', ['created_at'])

    # Add columns to users table
    with op.batch_alter_table('users') as batch_op:
        if not column_exists('users', 'max_sessions'):
            batch_op.add_column(sa.Column('max_sessions', sa.Integer(), nullable=True, default=3))
        if not column_exists('users', 'notify_new_login'):
            batch_op.add_column(sa.Column('notify_new_login', sa.Boolean(), nullable=True, default=True))

    # Add columns to sessions table
    with op.batch_alter_table('sessions') as batch_op:
        if not column_exists('sessions', 'country'):
            batch_op.add_column(sa.Column('country', sa.String(100), nullable=True))
        if not column_exists('sessions', 'city'):
            batch_op.add_column(sa.Column('city', sa.String(100), nullable=True))
        if not column_exists('sessions', 'is_trusted'):
            batch_op.add_column(sa.Column('is_trusted', sa.Boolean(), nullable=True, default=False))
        if not column_exists('sessions', 'kicked_at'):
            batch_op.add_column(sa.Column('kicked_at', sa.DateTime(), nullable=True))
        if not column_exists('sessions', 'kicked_reason'):
            batch_op.add_column(sa.Column('kicked_reason', sa.String(100), nullable=True))

    # Set default values for existing rows
    op.execute("UPDATE users SET max_sessions = 3 WHERE max_sessions IS NULL")
    op.execute("UPDATE users SET notify_new_login = 1 WHERE notify_new_login IS NULL")
    op.execute("UPDATE sessions SET is_trusted = 0 WHERE is_trusted IS NULL")


def downgrade() -> None:
    # Remove columns from sessions table
    with op.batch_alter_table('sessions') as batch_op:
        if column_exists('sessions', 'kicked_reason'):
            batch_op.drop_column('kicked_reason')
        if column_exists('sessions', 'kicked_at'):
            batch_op.drop_column('kicked_at')
        if column_exists('sessions', 'is_trusted'):
            batch_op.drop_column('is_trusted')
        if column_exists('sessions', 'city'):
            batch_op.drop_column('city')
        if column_exists('sessions', 'country'):
            batch_op.drop_column('country')

    # Remove columns from users table
    with op.batch_alter_table('users') as batch_op:
        if column_exists('users', 'notify_new_login'):
            batch_op.drop_column('notify_new_login')
        if column_exists('users', 'max_sessions'):
            batch_op.drop_column('max_sessions')

    # Drop login_logs table
    if table_exists('login_logs'):
        op.drop_index('ix_login_logs_created_at', 'login_logs')
        op.drop_index('ix_login_logs_ip_address', 'login_logs')
        op.drop_index('ix_login_logs_user_id', 'login_logs')
        op.drop_table('login_logs')
