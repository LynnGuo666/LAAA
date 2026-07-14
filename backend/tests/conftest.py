"""Pytest 配置:测试用独立临时 SQLite + 强 SECRET_KEY,不碰开发库。"""
import os
import sys

# 在导入 app 之前设定环境:强密钥 + 临时库 + 关闭风控便于直接测登录
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-pytest-only-32chars-min!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_oauth.db")
os.environ.setdefault("ENABLE_LOGIN_ANOMALY_DETECTION", "false")
os.environ.setdefault("BLOCK_SUSPICIOUS_LOGIN", "false")
os.environ.setdefault("SMTP_ENABLED", "false")

import pytest
from fastapi.testclient import TestClient

# 让 backend/ 在 sys.path(运行时 cwd = backend/)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture(scope="session")
def app():
    """创建一次应用 + 初始化 schema,session 内复用。"""
    from app.database import engine, init_db
    from app.models import Base

    Base.metadata.create_all(bind=engine)
    init_db()  # 幂等:创建 admin 角色/权限,但不会创建 admin 用户(那是 seed.py)

    from app.main import app as _app
    yield _app

    # 清理测试库
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="session")
def client(app):
    """TestClient,跟随 app 生命周期。"""
    return TestClient(app)


@pytest.fixture
def db_session():
    """每个测试函数独立的 DB session,函数结束回滚。"""
    from app.database import SessionLocal
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def seed_admin(db_session):
    """创建一个测试 admin 用户(密码 admin123),返回 User。
    邮箱已验证 + 启用 TOTP,使其不处于受限模式(否则 authorize 会 403)。"""
    from app.models import Group, Role, User, UserTOTP
    from app.utils.security import get_password_hash

    user = db_session.query(User).filter(User.username == "admin").first()
    if not user:
        user = User(
            username="admin",
            email="admin@example.com",
            password_hash=get_password_hash("admin123"),
            status="active",
            email_verified=True,
        )
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
        admin_role = db_session.query(Role).filter(Role.name == "admin").first()
        if admin_role and admin_role not in user.roles:
            user.roles.append(admin_role)
        # 加入默认组(若存在)
        default_group = db_session.query(Group).filter(Group.is_default == True).first()
        if default_group and default_group not in user.groups:
            user.groups.append(default_group)
        # 启用 TOTP,避免受限模式阻断 authorize
        if not user.totp:
            totp = UserTOTP(
                user_id=user.id,
                secret_encrypted="dummy-encrypted-for-test-only",
                name="test",
                is_enabled=True,
            )
            db_session.add(totp)
        db_session.commit()
        db_session.refresh(user)
    return user


@pytest.fixture
def admin_token(client, seed_admin):
    """登录 admin 拿 access_token。"""
    resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


@pytest.fixture
def internal_client(db_session, seed_admin):
    """创建 trusted internal OAuth client,返回 (client_id, client_secret)。"""
    import json

    from app.models import Client
    from app.utils.security import hash_token

    client = db_session.query(Client).filter(Client.client_id == "internal").first()
    if not client:
        client = Client(
            client_id="internal",
            client_secret_hash=hash_token("internal_secret"),
            name="Internal Test Client",
            description="test",
            redirect_uris=json.dumps(["http://localhost:3000/callback"]),
            allowed_scopes=json.dumps(["profile", "email", "openid"]),
            trusted=True,
            default_access=True,
            owner_id=seed_admin.id,
        )
        db_session.add(client)
        db_session.commit()
    return "internal", "internal_secret"
