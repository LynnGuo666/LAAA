"""tokens 表加 code_hash(RFC 6749 §4.1.2 授权码重放响应)

授权码首次兑换签发的 refresh token 记录其来源 code 的 hash;
检测到已消耗 code 再次兑换时,按 code_hash 定位派生 token 走家族吊销。

Revision ID: b8d9e0f1a2b3
Revises: a7b8c9d0e1f2
Create Date: 2026-10-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8d9e0f1a2b3'
down_revision: Union[str, None] = 'a7b8c9d0e1f2'
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
    # 注意:初始迁移是空壳,fresh DB 由 create_all 建全量 schema(含本列);
    # 本迁移只对 alembic 管理的存量库生效,故需 column_exists 幂等保护。
    if not column_exists('tokens', 'code_hash'):
        with op.batch_alter_table('tokens') as batch_op:
            batch_op.add_column(sa.Column('code_hash', sa.String(255), nullable=True))
    if not index_exists('tokens', 'ix_tokens_code_hash'):
        op.create_index('ix_tokens_code_hash', 'tokens', ['code_hash'])


def downgrade() -> None:
    if index_exists('tokens', 'ix_tokens_code_hash'):
        op.drop_index('ix_tokens_code_hash', table_name='tokens')
    with op.batch_alter_table('tokens') as batch_op:
        if column_exists('tokens', 'code_hash'):
            batch_op.drop_column('code_hash')
