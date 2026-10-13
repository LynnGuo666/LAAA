"""user_authorizations 唯一约束 + LoginLog.city 索引

- (user_id, client_id) 唯一:防并发查-插产生重复授权行
- login_logs.city 加索引:is_known_city 风控查询按 city 过滤,表大后变慢

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-10-13 19:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def constraint_exists(table: str, name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for uc in inspector.get_unique_constraints(table):
        if uc['name'] == name:
            return True
    return False


def index_exists(table: str, name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return name in [i['name'] for i in inspector.get_indexes(table)]


def upgrade() -> None:
    # 先清理可能的重复行(保留最早一条),否则唯一约束建不起来
    bind = op.get_bind()
    bind.execute(sa.text("""
        DELETE FROM user_authorizations
        WHERE id NOT IN (
            SELECT MIN(id) FROM user_authorizations
            GROUP BY user_id, client_id
        )
    """))

    if not constraint_exists('user_authorizations', 'uq_user_client_authorization'):
        # SQLite 不支持直接 ALTER 加约束,用 batch mode(建新表-拷数据-换名)
        with op.batch_alter_table('user_authorizations') as batch_op:
            batch_op.create_unique_constraint(
                'uq_user_client_authorization', ['user_id', 'client_id'],
            )

    if not index_exists('login_logs', 'ix_login_logs_city'):
        op.create_index('ix_login_logs_city', 'login_logs', ['city'])


def downgrade() -> None:
    with op.batch_alter_table('user_authorizations') as batch_op:
        batch_op.drop_constraint('uq_user_client_authorization')
    if index_exists('login_logs', 'ix_login_logs_city'):
        op.drop_index('ix_login_logs_city', table_name='login_logs')
