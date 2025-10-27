"""
Database migration script to add Groups and access control tables
"""
from app.database import Base, engine
from app.models import Group, user_groups, client_allowed_groups, client_denied_groups
from sqlalchemy import inspect


def migrate():
    """Add new tables for group-based access control"""
    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()

    print("🔄 开始数据库迁移...")

    # Create only the new tables
    tables_to_create = ['groups', 'user_groups', 'client_allowed_groups', 'client_denied_groups']

    for table_name in tables_to_create:
        if table_name not in existing_tables:
            print(f"  ✓ 创建表: {table_name}")
        else:
            print(f"  ⚠ 表已存在，跳过: {table_name}")

    # Create all tables (will skip existing ones)
    Base.metadata.create_all(bind=engine)

    print("✅ 数据库迁移完成!")


if __name__ == "__main__":
    migrate()
