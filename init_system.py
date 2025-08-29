#!/usr/bin/env python3
"""
初始化脚本 - 创建默认的管理员用户和LAAA Dashboard应用
"""

import asyncio
import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy.orm import Session
from app.core.database import engine, SessionLocal
from app.models import Base, User, ClientApplication, ApplicationPermissionGroup
from app.services import UserService, ClientService
from app.services.permission_management_service import PermissionManagementService
from app.schemas import UserCreate, ClientApplicationCreate
import uuid
import json


def init_database():
    """初始化数据库表"""
    print("创建数据库表...")
    Base.metadata.create_all(bind=engine)
    print("✓ 数据库表创建完成")


def create_admin_user(db: Session):
    """创建默认管理员用户"""
    print("检查管理员用户...")
    
    # 检查是否已有管理员用户
    admin_user = db.query(User).filter(User.is_admin == True).first()
    if admin_user:
        print(f"✓ 管理员用户已存在: {admin_user.username}")
        return admin_user
    
    # 创建默认管理员用户
    admin_data = UserCreate(
        email="admin@example.com",
        username="admin",
        password="admin123",
        full_name="系统管理员"
    )
    
    print("创建管理员用户...")
    admin_user = UserService.create_user(db, admin_data)
    
    # 设置为管理员
    admin_user.is_admin = True
    db.commit()
    db.refresh(admin_user)
    
    print(f"✓ 管理员用户创建成功:")
    print(f"  用户名: {admin_user.username}")
    print(f"  邮箱: {admin_user.email}")
    print(f"  密码: admin123")
    return admin_user


def create_dashboard_app(db: Session, admin_user: User):
    """创建默认的LAAA Dashboard应用"""
    print("检查LAAA Dashboard应用...")
    
    # 检查是否已有LAAA Dashboard应用
    existing_app = db.query(ClientApplication).filter(
        ClientApplication.client_name == "LAAA Dashboard"
    ).first()
    
    if existing_app:
        print(f"✓ LAAA Dashboard应用已存在: {existing_app.client_id}")
        return existing_app
    
    # 创建默认应用
    dashboard_app_data = ClientApplicationCreate(
        client_name="LAAA Dashboard",
        client_description="LAAA OAuth服务器仪表盘 - 用户和管理员界面",
        redirect_uris=[
            "http://localhost:8000/callback",
            "http://localhost:8000/dashboard",
            "http://localhost:8000/admin/dashboard",
            "https://localhost:8000/callback",
            "https://localhost:8000/dashboard", 
            "https://localhost:8000/admin/dashboard"
        ],
        scope="openid profile email",
        client_uri="http://localhost:8000",
        logo_uri=None  # 暂时移除logo
    )
    
    print("创建LAAA Dashboard应用...")
    dashboard_app = ClientService.create_client(db, dashboard_app_data, admin_user.id)
    
    print(f"✓ LAAA Dashboard应用创建成功:")
    print(f"  应用名称: {dashboard_app.client_name}")
    print(f"  Client ID: {dashboard_app.client_id}")
    print(f"  Client Secret: {dashboard_app.client_secret}")
    
    return dashboard_app


def create_default_permission_group(db: Session, dashboard_app: ClientApplication):
    """为LAAA Dashboard创建默认权限组"""
    print("检查LAAA Dashboard权限组...")
    
    # 检查是否已有权限组
    existing_group = db.query(ApplicationPermissionGroup).filter(
        ApplicationPermissionGroup.client_id == dashboard_app.id
    ).first()
    
    if existing_group:
        print(f"✓ 权限组已存在: {existing_group.name}")
        return existing_group
    
    print("创建默认权限组...")
    
    # 创建权限组 - 默认允许所有用户访问仪表盘
    permission_group = PermissionManagementService.create_or_update_permission_group(
        db=db,
        client_id=dashboard_app.id,
        name="仪表盘默认权限组",
        description="LAAA仪表盘的默认权限设置，允许所有注册用户访问",
        default_allowed=True,  # 默认允许所有用户
        allowed_scopes=["openid", "profile", "email"]
    )
    
    print(f"✓ 权限组创建成功:")
    print(f"  权限组名称: {permission_group.name}")
    print(f"  默认允许访问: 是")
    print(f"  允许的权限范围: {json.loads(permission_group.allowed_scopes or '[]')}")
    
    return permission_group


def main():
    """主初始化函数"""
    print("🚀 开始初始化LAAA OAuth服务器...")
    print("=" * 50)
    
    # 初始化数据库
    init_database()
    
    # 创建数据库会话
    db = SessionLocal()
    
    try:
        # 创建管理员用户
        admin_user = create_admin_user(db)
        
        # 创建LAAA Dashboard应用
        dashboard_app = create_dashboard_app(db, admin_user)
        
        # 创建默认权限组
        permission_group = create_default_permission_group(db, dashboard_app)
        
        print("=" * 50)
        print("🎉 初始化完成！")
        print("\n📋 系统信息:")
        print(f"  管理员用户名: admin")
        print(f"  管理员密码: admin123")
        print(f"  Dashboard Client ID: {dashboard_app.client_id}")
        print(f"  服务器地址: http://localhost:8000")
        print(f"  仪表盘地址: http://localhost:8000/dashboard")
        print(f"  管理后台地址: http://localhost:8000/admin/dashboard")
        print(f"  API文档地址: http://localhost:8000/docs")
        print("\n🔐 OAuth测试信息:")
        print(f"  Authorization Endpoint: http://localhost:8000/oauth/authorize")
        print(f"  Token Endpoint: http://localhost:8000/oauth/token")
        print(f"  UserInfo Endpoint: http://localhost:8000/oauth/userinfo")
        print(f"  OIDC Discovery: http://localhost:8000/oauth/.well-known/openid_configuration")
        
    except Exception as e:
        print(f"❌ 初始化失败: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()