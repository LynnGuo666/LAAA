#!/usr/bin/env python3
"""
初始化OAuth服务器的测试数据
创建测试用户和OAuth客户端应用
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy.orm import Session
from app.core.database import SessionLocal, engine
from app.models import Base, User, ClientApplication
from app.services import UserService, ClientService
from app.schemas import UserCreate, ClientApplicationCreate
import json

def init_database():
    """初始化数据库表"""
    print("🔧 创建数据库表...")
    Base.metadata.create_all(bind=engine)
    print("✅ 数据库表创建完成")

def create_test_user(db: Session):
    """创建测试用户"""
    print("👤 创建测试用户...")
    
    # 检查是否已存在测试用户
    existing_user = db.query(User).filter(User.username == "testuser").first()
    if existing_user:
        print("ℹ️  测试用户已存在，跳过创建")
        return existing_user
    
    try:
        user_data = UserCreate(
            email="test@example.com",
            username="testuser", 
            password="password123",
            full_name="Test User"
        )
        
        user = UserService.create_user(db, user_data)
        print(f"✅ 测试用户创建成功: {user.username} (ID: {user.id})")
        return user
    except Exception as e:
        print(f"❌ 创建测试用户失败: {e}")
        return None

def create_test_client(db: Session, user_id: str):
    """创建测试OAuth客户端"""
    print("🔑 创建测试OAuth客户端...")
    
    # 检查是否已存在测试客户端
    existing_client = db.query(ClientApplication).filter(
        ClientApplication.client_name == "Test OAuth Client"
    ).first()
    if existing_client:
        print(f"ℹ️  测试客户端已存在: {existing_client.client_id}")
        return existing_client
    
    try:
        client_data = ClientApplicationCreate(
            client_name="Test OAuth Client",
            client_description="A test OAuth 2.0 client for development",
            redirect_uris=[
                "http://localhost:3000/callback",
                "http://localhost:8080/callback",
                "http://127.0.0.1:3000/callback"
            ],
            response_types="code",
            grant_types="authorization_code,refresh_token",
            scope="openid profile email",
            client_uri="http://localhost:3000",
            logo_uri="https://via.placeholder.com/64x64.png?text=TEST",
            tos_uri="http://localhost:3000/terms",
            policy_uri="http://localhost:3000/privacy"
        )
        
        client = ClientService.create_client(db, client_data, user_id)
        print(f"✅ 测试客户端创建成功:")
        print(f"   Client ID: {client.client_id}")
        print(f"   Client Secret: {client.client_secret}")
        return client
    except Exception as e:
        print(f"❌ 创建测试客户端失败: {e}")
        return None

def main():
    print("🚀 初始化OAuth 2.0服务器测试数据...\n")
    
    # 初始化数据库
    init_database()
    
    # 创建数据库会话
    db = SessionLocal()
    
    try:
        # 创建测试用户
        user = create_test_user(db)
        if not user:
            print("❌ 无法创建测试用户，退出")
            return
        
        # 创建测试客户端
        client = create_test_client(db, user.id)
        if not client:
            print("❌ 无法创建测试客户端，退出")
            return
        
        print("\n🎉 初始化完成！")
        print("\n📋 测试信息:")
        print(f"   用户名: {user.username}")
        print(f"   密码: password123")
        print(f"   邮箱: {user.email}")
        print(f"   Client ID: {client.client_id}")
        print(f"   Client Secret: {client.client_secret}")
        
        print("\n🔗 测试OAuth流程:")
        print(f"   访问: http://localhost:8000/oauth/authorize?response_type=code&client_id={client.client_id}&redirect_uri=http://localhost:3000/callback&scope=openid+profile+email&state=test")
        
    except Exception as e:
        print(f"❌ 初始化过程中出错: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    main()