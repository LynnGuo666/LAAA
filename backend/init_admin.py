#!/usr/bin/env python3
"""
初始化管理员账号脚本
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy.orm import Session
from app.core.database import SessionLocal, engine
from app.models.user import User
from app.models import Base
from app.services.auth_service import AuthService
import uuid

def init_database():
    """初始化数据库表"""
    Base.metadata.create_all(bind=engine)

def create_admin_user():
    """创建初始管理员用户"""
    db: Session = SessionLocal()
    
    try:
        # 检查是否已存在管理员
        admin_exists = db.query(User).filter(
            User.is_superuser == True
        ).first()
        
        if admin_exists:
            print(f"管理员账号已存在: {admin_exists.username}")
            return admin_exists
        
        # 创建管理员用户
        admin_user = User(
            id=str(uuid.uuid4()),
            username="admin",
            email="admin@laaa.local",
            password_hash="$2b$12$puflr/6Hfjvh3QVSBgsW5uejuXBWLOeNpK.dhDnaytctjuhKcReQq",  # "admin123" 的哈希值
            is_active=True,
            is_superuser=True,
            security_level=4,  # 管理员级别
            email_verified=True,
            totp_enabled=False
        )
        
        db.add(admin_user)
        db.commit()
        db.refresh(admin_user)
        
        print("="*50)
        print("初始管理员账号创建成功！")
        print(f"用户名: {admin_user.username}")
        print(f"密码: admin123")
        print(f"邮箱: {admin_user.email}")
        print(f"安全等级: {admin_user.security_level} (管理员级)")
        print("="*50)
        print("请登录后立即修改默认密码！")
        
        return admin_user
        
    except Exception as e:
        db.rollback()
        print(f"创建管理员失败: {e}")
        return None
    finally:
        db.close()

if __name__ == "__main__":
    print("正在初始化数据库和管理员账号...")
    
    # 初始化数据库表
    init_database()
    print("✓ 数据库表初始化完成")
    
    # 创建管理员用户
    admin = create_admin_user()
    
    if admin:
        print("✓ 系统初始化完成")
    else:
        print("✗ 系统初始化失败")
        sys.exit(1)