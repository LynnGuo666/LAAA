"""add PKCE + nonce + client_type for OIDC compliance

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-14 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns


def upgrade() -> None:
    # PKCE + nonce:授权码绑定 code_challenge 与 nonce
    with op.batch_alter_table('tokens') as batch_op:
        if not column_exists('tokens', 'code_challenge'):
            batch_op.add_column(sa.Column('code_challenge', sa.String(128), nullable=True))
        if not column_exists('tokens', 'code_challenge_method'):
            batch_op.add_column(sa.Column('code_challenge_method', sa.String(10), nullable=True))
        if not column_exists('tokens', 'nonce'):
            batch_op.add_column(sa.Column('nonce', sa.String(128), nullable=True))

    # client_type:区分 confidential / public(后者免 secret 走 PKCE)
    with op.batch_alter_table('clients') as batch_op:
        if not column_exists('clients', 'client_type'):
            batch_op.add_column(sa.Column('client_type', sa.String(20), nullable=False, server_default='confidential'))


def downgrade() -> None:
    with op.batch_alter_table('tokens') as batch_op:
        if column_exists('tokens', 'code_challenge'):
            batch_op.drop_column('code_challenge')
        if column_exists('tokens', 'code_challenge_method'):
            batch_op.drop_column('code_challenge_method')
        if column_exists('tokens', 'nonce'):
            batch_op.drop_column('nonce')
    with op.batch_alter_table('clients') as batch_op:
        if column_exists('clients', 'client_type'):
            batch_op.drop_column('client_type')
