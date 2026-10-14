"""高频查询列加索引(性能批次)

- sessions.refresh_token_hash:refresh 轮换/登出/会话识别的高频反查
- tokens.expires_at:maintenance 每小时按过期时间扫描清理(原全表扫描)
- verification_codes.expires_at:同上,过期清理扫描
- webauthn_challenges.expires_at:同上,过期清理扫描

Revision ID: 3f6f78ca03b9
Revises: b8d9e0f1a2b3
Create Date: 2026-10-14 15:33:28.787281

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3f6f78ca03b9'
down_revision: Union[str, None] = 'b8d9e0f1a2b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def index_exists(table: str, name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return name in [i['name'] for i in inspector.get_indexes(table)]


# (索引名, 表名, 列名)
_INDEXES = [
    ('ix_sessions_refresh_token_hash', 'sessions', ['refresh_token_hash']),
    ('ix_tokens_expires_at', 'tokens', ['expires_at']),
    ('ix_verification_codes_expires_at', 'verification_codes', ['expires_at']),
    ('ix_webauthn_challenges_expires_at', 'webauthn_challenges', ['expires_at']),
]


def upgrade() -> None:
    # 注意:初始迁移是空壳,fresh DB 由 create_all 建全量 schema(含这些索引,
    # 模型列已带 index=True);本迁移只对 alembic 管理的存量库生效,
    # index_exists 幂等保护(参照 b8d9e0f1a2b3 写法)。
    for name, table, columns in _INDEXES:
        if not index_exists(table, name):
            op.create_index(name, table, columns)


def downgrade() -> None:
    for name, table, _columns in _INDEXES:
        if index_exists(table, name):
            op.drop_index(name, table_name=table)
