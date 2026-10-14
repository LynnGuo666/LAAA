"""users 加 must_change_password(首登/重置后强制改密标志)

seed 默认管理员(admin/admin123)、BOOTSTRAP_ALLOW_FIRST_USER 的首个
自注册超管、管理员重置他人密码时置 True;用户自己改密成功后置 False。
前端据 /api/auth/me 的该标志强引导跳转改密页(非死锁拦截)。

Revision ID: e8a9f0b1c2d3
Revises: d7e8f9a0b1c2
Create Date: 2026-10-14 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e8a9f0b1c2d3'
down_revision: Union[str, None] = 'd7e8f9a0b1c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column in [c['name'] for c in inspector.get_columns(table)]


def upgrade() -> None:
    # 注意:初始迁移是空壳,fresh DB 由 create_all 建全量 schema(含本列);
    # 本迁移只对 alembic 管理的存量库生效,故需 column_exists 幂等保护。
    if not column_exists('users', 'must_change_password'):
        with op.batch_alter_table('users') as batch_op:
            batch_op.add_column(
                sa.Column('must_change_password', sa.Boolean(),
                          nullable=False, server_default='0')
            )


def downgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        if column_exists('users', 'must_change_password'):
            batch_op.drop_column('must_change_password')
