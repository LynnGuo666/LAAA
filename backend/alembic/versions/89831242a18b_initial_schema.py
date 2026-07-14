"""initial_schema

Revision ID: 89831242a18b
Revises:
Create Date: 2025-12-13 20:51:05.620627

注:此迁移 upgrade() 为空。表实际由 init_db() 的 Base.metadata.create_all 建立。
后续增量迁移(ALTER TABLE 加列)假定表已存在——故部署链路须先运行 init_db/create_all
再执行 alembic upgrade head(或对已有库 stamp head 标记基线)。
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '89831242a18b'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
