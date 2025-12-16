"""add verification and totp tables

Revision ID: 6c7d8e9f0a1b
Revises: 5b6c7d8e9f0a
Create Date: 2024-12-16 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = '6c7d8e9f0a1b'
down_revision: Union[str, None] = '5b6c7d8e9f0a'
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
    # Add device_token to sessions table
    with op.batch_alter_table('sessions') as batch_op:
        if not column_exists('sessions', 'device_token'):
            batch_op.add_column(sa.Column('device_token', sa.String(64), nullable=True))
            batch_op.create_index('ix_sessions_device_token', ['device_token'])

    # Add session_id to login_logs table
    with op.batch_alter_table('login_logs') as batch_op:
        if not column_exists('login_logs', 'session_id'):
            batch_op.add_column(sa.Column('session_id', sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                'fk_login_logs_session_id',
                'sessions',
                ['session_id'],
                ['id'],
                ondelete='SET NULL'
            )

    # Create verification_sessions table
    if not table_exists('verification_sessions'):
        op.create_table(
            'verification_sessions',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('session_token', sa.String(64), nullable=False),
            sa.Column('risk_level', sa.String(20), nullable=False),
            sa.Column('risk_score', sa.Integer(), nullable=False),
            sa.Column('anomalies', sa.Text(), nullable=True),
            sa.Column('required_verifications', sa.Integer(), default=1),
            sa.Column('completed_verifications', sa.Integer(), default=0),
            sa.Column('completed_methods', sa.Text(), nullable=True),
            sa.Column('ip_address', sa.String(50), nullable=True),
            sa.Column('user_agent', sa.Text(), nullable=True),
            sa.Column('device_name', sa.String(100), nullable=True),
            sa.Column('device_token', sa.String(64), nullable=True),
            sa.Column('remember_me', sa.Boolean(), default=False),
            sa.Column('is_completed', sa.Boolean(), default=False),
            sa.Column('expires_at', sa.DateTime(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('completed_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index('ix_verification_sessions_id', 'verification_sessions', ['id'])
        op.create_index('ix_verification_sessions_user_id', 'verification_sessions', ['user_id'])
        op.create_index('ix_verification_sessions_session_token', 'verification_sessions', ['session_token'], unique=True)

    # Create verification_codes table
    if not table_exists('verification_codes'):
        op.create_table(
            'verification_codes',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('session_id', sa.Integer(), nullable=True),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('code_hash', sa.String(255), nullable=True),
            sa.Column('token', sa.String(64), nullable=True),
            sa.Column('purpose', sa.String(30), nullable=False),
            sa.Column('device_token', sa.String(64), nullable=True),
            sa.Column('attempts', sa.Integer(), default=0),
            sa.Column('max_attempts', sa.Integer(), default=5),
            sa.Column('is_used', sa.Boolean(), default=False),
            sa.Column('expires_at', sa.DateTime(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('used_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['session_id'], ['verification_sessions.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index('ix_verification_codes_id', 'verification_codes', ['id'])
        op.create_index('ix_verification_codes_session_id', 'verification_codes', ['session_id'])
        op.create_index('ix_verification_codes_user_id', 'verification_codes', ['user_id'])
        op.create_index('ix_verification_codes_token', 'verification_codes', ['token'], unique=True)

    # Create user_totp table
    if not table_exists('user_totp'):
        op.create_table(
            'user_totp',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('secret_encrypted', sa.String(255), nullable=False),
            sa.Column('name', sa.String(100), default='Authenticator'),
            sa.Column('backup_codes_hash', sa.Text(), nullable=True),
            sa.Column('is_enabled', sa.Boolean(), default=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('last_used_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('user_id')
        )
        op.create_index('ix_user_totp_id', 'user_totp', ['id'])
        op.create_index('ix_user_totp_user_id', 'user_totp', ['user_id'])


def downgrade() -> None:
    # Drop user_totp table
    if table_exists('user_totp'):
        op.drop_index('ix_user_totp_user_id', 'user_totp')
        op.drop_index('ix_user_totp_id', 'user_totp')
        op.drop_table('user_totp')

    # Drop verification_codes table
    if table_exists('verification_codes'):
        op.drop_index('ix_verification_codes_token', 'verification_codes')
        op.drop_index('ix_verification_codes_user_id', 'verification_codes')
        op.drop_index('ix_verification_codes_session_id', 'verification_codes')
        op.drop_index('ix_verification_codes_id', 'verification_codes')
        op.drop_table('verification_codes')

    # Drop verification_sessions table
    if table_exists('verification_sessions'):
        op.drop_index('ix_verification_sessions_session_token', 'verification_sessions')
        op.drop_index('ix_verification_sessions_user_id', 'verification_sessions')
        op.drop_index('ix_verification_sessions_id', 'verification_sessions')
        op.drop_table('verification_sessions')

    # Remove session_id from login_logs
    with op.batch_alter_table('login_logs') as batch_op:
        if column_exists('login_logs', 'session_id'):
            batch_op.drop_constraint('fk_login_logs_session_id', type_='foreignkey')
            batch_op.drop_column('session_id')

    # Remove device_token from sessions
    with op.batch_alter_table('sessions') as batch_op:
        if column_exists('sessions', 'device_token'):
            batch_op.drop_index('ix_sessions_device_token')
            batch_op.drop_column('device_token')
