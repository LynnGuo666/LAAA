"""drop_legacy_client_group_tables

删除 client_allowed_groups / client_denied_groups 两张遗留表。
它们的执法在 2025-12 被移除(User.can_access_client() 不再读取),
但管理端点仍在写——配置后 UI 显示成功实际不生效,故彻底删除。

数据兜底(对可能非空的部署):
- client_allowed_groups 每行 (client_id, group_id):若对应 client 的
  default_access 为 True 则改为 False(恢复原"白名单外不可见"语义),
  并 INSERT OR IGNORE INTO group_allowed_apps (group_id, client_id)
- client_denied_groups 每行:INSERT OR IGNORE INTO group_denied_apps (group_id, client_id)

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-10-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def table_exists(table: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table in inspector.get_table_names()


def upgrade() -> None:
    if table_exists('client_allowed_groups'):
        # 1) 数据转换:白名单组 → group_allowed_apps;
        #    若 client 原为 default_access=True(白名单同时全开,语义矛盾),
        #    收紧为 False,恢复"白名单外不可见"的原始语义
        op.execute(sa.text("""
            INSERT OR IGNORE INTO group_allowed_apps (group_id, client_id)
            SELECT group_id, client_id FROM client_allowed_groups
        """))
        op.execute(sa.text("""
            UPDATE clients SET default_access = 0
            WHERE default_access = 1
              AND id IN (SELECT DISTINCT client_id FROM client_allowed_groups)
        """))
        op.drop_table('client_allowed_groups')

    if table_exists('client_denied_groups'):
        # 2) 数据转换:黑名单组 → group_denied_apps
        op.execute(sa.text("""
            INSERT OR IGNORE INTO group_denied_apps (group_id, client_id)
            SELECT group_id, client_id FROM client_denied_groups
        """))
        op.drop_table('client_denied_groups')


def downgrade() -> None:
    if not table_exists('client_allowed_groups'):
        op.create_table(
            'client_allowed_groups',
            sa.Column('client_id', sa.Integer(), sa.ForeignKey('clients.id', ondelete='CASCADE'), nullable=True),
            sa.Column('group_id', sa.Integer(), sa.ForeignKey('groups.id', ondelete='CASCADE'), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
        )
    if not table_exists('client_denied_groups'):
        op.create_table(
            'client_denied_groups',
            sa.Column('client_id', sa.Integer(), sa.ForeignKey('clients.id', ondelete='CASCADE'), nullable=True),
            sa.Column('group_id', sa.Integer(), sa.ForeignKey('groups.id', ondelete='CASCADE'), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
        )
    # 注:downgrade 不回灌 group_allowed_apps / group_denied_apps 中转换来的数据,
    # 也不回滚 default_access 的收紧(原始行已随 DROP 丢失,无法精确还原)
