"""add known_devices table (device trust decoupled from sessions)

已知设备记忆表:解决"登出后 session 被删 → 同一设备再登录被判为新设备
→ 每次都被强制两步验证"的问题。登录成功时 upsert,用户主动忘记才删除。

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-10-13 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    if table_exists('known_devices'):
        return
    op.create_table(
        'known_devices',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(),
                  sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('device_token', sa.String(64), nullable=False),
        sa.Column('device_name', sa.String(100), nullable=True),
        sa.Column('device_type', sa.String(50), nullable=True),
        sa.Column('first_seen', sa.DateTime(), nullable=False),
        sa.Column('last_seen', sa.DateTime(), nullable=False),
        sa.Column('ip_address', sa.String(50), nullable=True),
        sa.Column('country', sa.String(100), nullable=True),
        sa.Column('city', sa.String(100), nullable=True),
        sa.UniqueConstraint('user_id', 'device_token',
                            name='uq_known_device_user_token'),
    )
    op.create_index('ix_known_devices_user_id', 'known_devices', ['user_id'])
    op.create_index('ix_known_devices_device_token', 'known_devices', ['device_token'])

    # 回填:把现存 session 中的 device_token 迁入 known_devices,
    # 让既有用户登出一次后设备即被记住
    bind = op.get_bind()
    bind.execute(sa.text("""
        INSERT OR IGNORE INTO known_devices
            (user_id, device_token, device_name, device_type,
             first_seen, last_seen, ip_address, country, city)
        SELECT s.user_id, s.device_token, s.device_name, s.device_type,
               COALESCE(s.created_at, CURRENT_TIMESTAMP),
               COALESCE(s.last_active, CURRENT_TIMESTAMP),
               s.ip_address, s.country, s.city
        FROM sessions s
        WHERE s.device_token IS NOT NULL AND s.device_token != ''
    """))


def downgrade() -> None:
    if table_exists('known_devices'):
        op.drop_index('ix_known_devices_device_token', table_name='known_devices')
        op.drop_index('ix_known_devices_user_id', table_name='known_devices')
        op.drop_table('known_devices')
