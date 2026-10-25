"""add admin_audit_logs

管理域敏感操作审计表。历史上有一张 audit_logs 死表(从未写入)已被删除;
本表由 admin 路由真实写入,用于追溯"谁在何时对谁做了什么"。

Revision ID: a1c2d3e4f5b6
Revises: e8a9f0b1c2d3
Create Date: 2026-10-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c2d3e4f5b6'
down_revision: Union[str, None] = 'e8a9f0b1c2d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    if table_exists('admin_audit_logs'):
        return
    op.create_table(
        'admin_audit_logs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'actor_id', sa.Integer(),
            sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True,
        ),
        sa.Column('actor_username', sa.String(50), nullable=True),
        sa.Column('action', sa.String(64), nullable=False),
        sa.Column('target_type', sa.String(32), nullable=True),
        sa.Column('target_id', sa.Integer(), nullable=True),
        sa.Column('target_username', sa.String(50), nullable=True),
        sa.Column('detail', sa.Text(), nullable=True),
        sa.Column('ip_address', sa.String(50), nullable=True),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_admin_audit_logs_actor_id', 'admin_audit_logs', ['actor_id'])
    op.create_index('ix_admin_audit_logs_action', 'admin_audit_logs', ['action'])
    op.create_index('ix_admin_audit_logs_target_id', 'admin_audit_logs', ['target_id'])
    op.create_index('ix_admin_audit_logs_created_at', 'admin_audit_logs', ['created_at'])


def downgrade() -> None:
    if table_exists('admin_audit_logs'):
        op.drop_index('ix_admin_audit_logs_created_at', table_name='admin_audit_logs')
        op.drop_index('ix_admin_audit_logs_target_id', table_name='admin_audit_logs')
        op.drop_index('ix_admin_audit_logs_action', table_name='admin_audit_logs')
        op.drop_index('ix_admin_audit_logs_actor_id', table_name='admin_audit_logs')
        op.drop_table('admin_audit_logs')
