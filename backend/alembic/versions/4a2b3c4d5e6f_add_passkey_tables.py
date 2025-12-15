"""add_passkey_tables

Revision ID: 4a2b3c4d5e6f
Revises: 3f5c2a1c8d2e
Create Date: 2025-12-16 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4a2b3c4d5e6f"
down_revision: Union[str, Sequence[str], None] = "3f5c2a1c8d2e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create passkeys table
    op.create_table(
        'passkeys',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('credential_id', sa.String(512), nullable=False),
        sa.Column('public_key', sa.Text(), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('sign_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('transports', sa.Text(), nullable=True),
        sa.Column('backup_eligible', sa.Boolean(), nullable=True, server_default='0'),
        sa.Column('backup_state', sa.Boolean(), nullable=True, server_default='0'),
        sa.Column('aaguid', sa.String(36), nullable=True),
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_passkeys_id'), 'passkeys', ['id'], unique=False)
    op.create_index(op.f('ix_passkeys_user_id'), 'passkeys', ['user_id'], unique=False)
    op.create_index(op.f('ix_passkeys_credential_id'), 'passkeys', ['credential_id'], unique=True)

    # Create webauthn_challenges table
    op.create_table(
        'webauthn_challenges',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('challenge', sa.String(128), nullable=False),
        sa.Column('type', sa.String(20), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_webauthn_challenges_id'), 'webauthn_challenges', ['id'], unique=False)
    op.create_index(op.f('ix_webauthn_challenges_challenge'), 'webauthn_challenges', ['challenge'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_webauthn_challenges_challenge'), table_name='webauthn_challenges')
    op.drop_index(op.f('ix_webauthn_challenges_id'), table_name='webauthn_challenges')
    op.drop_table('webauthn_challenges')

    op.drop_index(op.f('ix_passkeys_credential_id'), table_name='passkeys')
    op.drop_index(op.f('ix_passkeys_user_id'), table_name='passkeys')
    op.drop_index(op.f('ix_passkeys_id'), table_name='passkeys')
    op.drop_table('passkeys')
