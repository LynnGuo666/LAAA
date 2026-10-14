"""refresh token 家族(OAuth 2.1 BCP 重用检测)

tokens 表加 family_id + revoked_at 两列:
- 同一条登录链路的所有 refresh token 共享 family_id
- 轮换改「标记旧 token revoked_at」而非删行,检测到已吊销 token 的
  重放即灭族(吊销整个 family + 联动过期 session),被盗场景止损。

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-10-14 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column in [c['name'] for c in inspector.get_columns(table)]


def index_exists(table: str, name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return name in [i['name'] for i in inspector.get_indexes(table)]


def upgrade() -> None:
    if not column_exists('tokens', 'family_id'):
        with op.batch_alter_table('tokens') as batch_op:
            batch_op.add_column(sa.Column('family_id', sa.String(36), nullable=True))
    if not column_exists('tokens', 'revoked_at'):
        with op.batch_alter_table('tokens') as batch_op:
            batch_op.add_column(sa.Column('revoked_at', sa.DateTime(), nullable=True))
    if not index_exists('tokens', 'ix_tokens_family_id'):
        op.create_index('ix_tokens_family_id', 'tokens', ['family_id'])


def downgrade() -> None:
    if index_exists('tokens', 'ix_tokens_family_id'):
        op.drop_index('ix_tokens_family_id', table_name='tokens')
    with op.batch_alter_table('tokens') as batch_op:
        if column_exists('tokens', 'family_id'):
            batch_op.drop_column('family_id')
        if column_exists('tokens', 'revoked_at'):
            batch_op.drop_column('revoked_at')
