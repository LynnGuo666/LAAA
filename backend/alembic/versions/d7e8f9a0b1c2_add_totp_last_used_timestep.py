"""user_totp 加 last_used_timestep(TOTP 验证码重放防护)

验证通过时记录本次验证码对应的时间步(int(time // 30)),后续验证要求
时间步严格大于已记录值——同一 6 位码在 valid_window 窗口(~90 秒)内
不可重复消费。NULL(存量数据)视为无记录。

Revision ID: d7e8f9a0b1c2
Revises: 3f6f78ca03b9
Create Date: 2026-10-14 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd7e8f9a0b1c2'
down_revision: Union[str, None] = '3f6f78ca03b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column in [c['name'] for c in inspector.get_columns(table)]


def upgrade() -> None:
    # 注意:初始迁移是空壳,fresh DB 由 create_all 建全量 schema(含本列);
    # 本迁移只对 alembic 管理的存量库生效,故需 column_exists 幂等保护。
    if not column_exists('user_totp', 'last_used_timestep'):
        with op.batch_alter_table('user_totp') as batch_op:
            batch_op.add_column(sa.Column('last_used_timestep', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('user_totp') as batch_op:
        if column_exists('user_totp', 'last_used_timestep'):
            batch_op.drop_column('last_used_timestep')
