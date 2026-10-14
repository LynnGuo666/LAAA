"""Pytest 配置:测试用独立临时 SQLite + 强 SECRET_KEY + 临时 RSA 密钥对,不碰开发库。

================================================================================
新测试编写约定(重要!)
================================================================================
1. **共享 session 级 DB,无隔离**:所有测试共享同一个 session 级数据库(app fixture
   整个 session 只建一次 schema)。因此:
   - 用户名/邮箱/client_id 等唯一标识符必须用随机后缀(`secrets.token_hex`),
     推荐直接用 `make_user` / `second_client` / `public_client` 工厂;
   - **绝不 assert 全表计数**(如 `db.query(User).count() == 1`)——其他测试会往
     同一张表写数据,断言必炸;只断言自己创建的行的状态。
2. **限流**:slowapi IP 限流计数只在测试之间清空(`_reset_rate_limiter`),单个
   测试内的登录类请求请保持 <10 次,否则会撞 `/api/auth/login` 的 IP 限流。
3. **async service 方法**:一律 `asyncio.run(...)` 包裹调用,不引入 pytest-asyncio。
4. **风控**:默认 `ENABLE_LOGIN_ANOMALY_DETECTION` / `BLOCK_SUSPICIOUS_LOGIN` 均为
   false(便于直接测登录);需要开启时在测试中声明 `risk_enabled` fixture,它用
   monkeypatch 翻转两个开关并在测试结束自动还原。
5. **静态目录**:模块级已准备 STATIC_DIR(含 index.html / page.html / dir/index.html /
   _next/chunk.js),`static_dir` fixture 返回 (static_dir, sentinel_path):
   sentinel 是位于静态目录**外**的机密文件,静态目录内有 symlink 指向它,供路径
   穿越测试断言"绝不能读到该内容"。
================================================================================
"""
import asyncio
import base64
import json
import os
import secrets
import sys
import tempfile
from datetime import timedelta

# 在导入 app 之前设定环境:强密钥 + 临时库 + 关闭风控便于直接测登录
# (STATIC_DIR 用直接赋值而非 setdefault,保证静态路由注册的确定性)
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-pytest-only-32chars-min!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_oauth.db")
os.environ.setdefault("ENABLE_LOGIN_ANOMALY_DETECTION", "false")
os.environ.setdefault("BLOCK_SUSPICIOUS_LOGIN", "false")
os.environ.setdefault("SMTP_ENABLED", "false")

# ---------------------------------------------------------------------------
# STATIC_DIR 引导:必须在任何 app import 之前完成(main.py 模块级读取并挂载路由)
# 目录结构:
#   <static>/
#     index.html          (内容含 "LAAA test index")
#     page.html
#     dir/index.html
#     _next/chunk.js      (main.py mount /_next 需要该目录存在)
#     link-to-sentinel    (symlink → 静态目录外的哨兵机密文件,供穿越测试)
#   <outside>/
#     sentinel-secret     (内容 "SECRET_KEY=leaked-if-you-see-this")
# ---------------------------------------------------------------------------
_STATIC_DIR = tempfile.mkdtemp(prefix="laaa-test-static-")
_OUTSIDE_DIR = tempfile.mkdtemp(prefix="laaa-test-outside-")

with open(os.path.join(_STATIC_DIR, "index.html"), "w") as f:
    f.write("<!DOCTYPE html><html><head><title>LAAA test index</title></head>"
            "<body><h1>LAAA test index</h1></body></html>")
with open(os.path.join(_STATIC_DIR, "page.html"), "w") as f:
    f.write("<!DOCTYPE html><html><body>test page.html</body></html>")
os.makedirs(os.path.join(_STATIC_DIR, "dir"), exist_ok=True)
with open(os.path.join(_STATIC_DIR, "dir", "index.html"), "w") as f:
    f.write("<!DOCTYPE html><html><body>test dir/index</body></html>")
os.makedirs(os.path.join(_STATIC_DIR, "_next"), exist_ok=True)
with open(os.path.join(_STATIC_DIR, "_next", "chunk.js"), "w") as f:
    f.write("console.log('LAAA test chunk');")

_SENTINEL_PATH = os.path.join(_OUTSIDE_DIR, "sentinel-secret")
with open(_SENTINEL_PATH, "w") as f:
    f.write("SECRET_KEY=leaked-if-you-see-this")
# 静态目录内的 symlink → 外部机密(测 realpath 防穿越:symlink 应被消解后拒绝)
os.symlink(_SENTINEL_PATH, os.path.join(_STATIC_DIR, "link-to-sentinel"))

os.environ["STATIC_DIR"] = _STATIC_DIR

# 生成临时 RSA 密钥对供 RS256 测试(测试结束自动清理)
_KEYDIR = tempfile.mkdtemp(prefix="laaa-test-keys-")
_PRIV = os.path.join(_KEYDIR, "jwt.pem")
_PUB = os.path.join(_KEYDIR, "jwt.pub")
os.environ.setdefault("JWT_PRIVATE_KEY_PATH", _PRIV)
os.environ.setdefault("JWT_PUBLIC_KEY_PATH", _PUB)

import pytest
from fastapi.testclient import TestClient

# 让 backend/ 在 sys.path(运行时 cwd = backend/)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ---------------------------------------------------------------------------
# 造数 helpers:模块级普通函数,测试可直接 `from conftest import ...`
# ---------------------------------------------------------------------------

def seed_login_history(db, user, *, ip, country=None, city=None, lat=None, lon=None,
                       minutes_ago=0, success=True):
    """造一条 LoginLog(直插,不走服务层),返回该 LoginLog 对象。

    lat/lon 为十进制数值或字符串,会按模型要求存为字符串。
    minutes_ago>0 时 created_at 回拨,模拟历史登录。
    """
    from datetime import datetime, timezone

    from app.models import LoginLog

    created_at = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    log = LoginLog(
        user_id=user.id,
        username=user.username,
        success=success,
        ip_address=ip,
        country=country,
        city=city,
        latitude=str(lat) if lat is not None else None,
        longitude=str(lon) if lon is not None else None,
        created_at=created_at,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def make_session(db, user, device_id, *, last_active=None, refresh_token_hash=None,
                 kicked=False, expires_days=7, device_token=None):
    """造一条 Session 行(直插),返回该 Session 对象。

    device_id 必须(测试内)唯一——表上有 unique 约束。
    kicked=True 时设置 kicked_at;expires_days 控制过期时间(负数可造已过期会话)。
    """
    from app.models import Session as DbSession
    from app.utils.security import hash_token

    from datetime import datetime, timezone

    kwargs = {}
    if kicked:
        kwargs["kicked_at"] = datetime.now(timezone.utc)
        kwargs["kicked_reason"] = "test"
    sess = DbSession(
        user_id=user.id,
        device_id=device_id,
        refresh_token_hash=refresh_token_hash or hash_token(secrets.token_hex(16)),
        expires_at=datetime.now(timezone.utc) + timedelta(days=expires_days),
        last_active=last_active,
        device_token=device_token,
        **kwargs,
    )
    db.add(sess)
    db.commit()
    db.refresh(sess)
    return sess


def known_device(db, user, token, *, device_name=None):
    """造一条 KnownDevice 行(直插),返回该 KnownDevice 对象。"""
    from app.models import KnownDevice

    kd = KnownDevice(
        user_id=user.id,
        device_token=token,
        device_name=device_name,
    )
    db.add(kd)
    db.commit()
    db.refresh(kd)
    return kd


def make_verification_session(db, user, *, risk_level="low", required=1,
                              ip="1.2.3.4", device_token=None, remember_me=False):
    """直插一条 VerificationSession(绕过登录 202 流程),返回 session_token 字符串。

    required 按 risk_level 对应 RiskService 的映射(low→1,medium/high→2),
    但可显式覆盖。expires_at 取 settings.verification_session_expire_minutes。
    """
    from datetime import datetime, timezone

    from app.config import get_settings
    from app.models import VerificationSession

    risk_score = {"low": 1, "medium": 3, "high": 6, "none": 0}.get(risk_level, 1)
    if required is None:
        required = 2 if risk_level in ("medium", "high") else 1

    session_token = secrets.token_urlsafe(32)
    vs = VerificationSession(
        user_id=user.id,
        session_token=session_token,
        risk_level=risk_level,
        risk_score=risk_score,
        required_verifications=required,
        completed_verifications=0,
        completed_methods=json.dumps([]),
        ip_address=ip,
        device_token=device_token,
        remember_me=remember_me,
        is_completed=False,
        expires_at=datetime.now(timezone.utc)
        + timedelta(minutes=get_settings().verification_session_expire_minutes),
    )
    db.add(vs)
    db.commit()
    db.refresh(vs)
    return session_token


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """每个测试前清空 slowapi 限流计数,避免测试间触发 IP 限流(同 IP=testclient)。"""
    yield
    try:
        from app.middleware.ratelimit import limiter
        limiter.reset()
    except Exception:
        pass


@pytest.fixture(scope="session")
def static_dir():
    """返回 (static_dir, sentinel_path)。

    static_dir:模块级创建、已注入 STATIC_DIR 的临时静态目录(含 index.html 等);
    sentinel_path:位于静态目录外的机密文件,静态目录内 link-to-sentinel 指向它。
    路径穿越测试断言 GET /link-to-sentinel(及各种 .. 编码变体)绝不返回其内容。
    """
    return _STATIC_DIR, _SENTINEL_PATH


@pytest.fixture
def risk_enabled(monkeypatch):
    """打开风控双开关(异常检测 + 可疑登录阻断),测试结束自动还原。

    settings 来自 get_settings() 的 lru_cache 单例,所有模块共享同一实例,
    monkeypatch.setattr 全局生效。
    """
    from app.config import get_settings
    settings = get_settings()
    monkeypatch.setattr(settings, "enable_login_anomaly_detection", True)
    monkeypatch.setattr(settings, "block_suspicious_login", True)
    return settings


@pytest.fixture(scope="session")
def app():
    """创建一次应用 + 初始化 schema + 生成 RSA 密钥,session 内复用。"""
    # 生成测试用 RSA 密钥对(若未由外部提供)
    from app.utils.security import generate_rsa_keypair, keystore
    if not os.path.exists(_PRIV):
        generate_rsa_keypair(_PRIV, _PUB)
    keystore.load(_PRIV, _PUB)

    from app.database import engine, init_db
    from app.models import Base

    Base.metadata.create_all(bind=engine)
    init_db()  # 幂等:创建 admin 角色/权限,但不会创建 admin 用户(那是 seed.py)

    from app.main import app as _app
    yield _app

    # 清理测试库
    Base.metadata.drop_all(bind=engine)
    # 清理临时密钥
    import shutil
    shutil.rmtree(_KEYDIR, ignore_errors=True)
    # 清理静态目录与外部哨兵目录
    shutil.rmtree(_STATIC_DIR, ignore_errors=True)
    shutil.rmtree(_OUTSIDE_DIR, ignore_errors=True)


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


def _encrypt_totp_secret(secret: str) -> str:
    """用 TOTPService 的 Fernet(从 SECRET_KEY sha256 衍生)加密 TOTP secret。

    TOTPService.encrypt_secret 当前为同步 classmethod;若未来变为 async,
    这里用 asyncio.run 兜底(不引入 pytest-asyncio)。
    """
    import inspect

    from app.services.totp_service import TOTPService

    result = TOTPService.encrypt_secret(secret)
    if inspect.isawaitable(result):
        result = asyncio.run(result)
    return result


@pytest.fixture
def make_user(db_session):
    """用户工厂。返回 callable,每次调用创建一个新用户。

    用法:
        user = make_user()                          # 普通 active + 已验证邮箱
        user, totp_secret = make_user(totp=True)    # 启用 TOTP,返回明文 secret
        user = make_user(passkeys=True)             # 附带一条 Passkey 记录
        user = make_user(username_prefix="alice")   # 用户名 alice_<hex>

    参数:
        username_prefix: 用户名前缀(默认 "user");用户名/邮箱自动附加
            secrets.token_hex(6) 后缀保证唯一(共享 DB 无隔离,硬约束)。
        email_verified / status / max_sessions: 直写 User 字段。
        totp: True 时写真实 Fernet 密文(TOTPService.encrypt_secret),
            返回 (user, totp_secret) 二元组;否则只返回 user。
        passkeys: True 时附带一条 Passkey 记录(credential_id 唯一化)。

    工厂内部每次调用都会 commit,调用方拿到的是已持久化的对象。
    """
    from app.models import Passkey, User, UserTOTP
    from app.utils.security import get_password_hash

    created: list = []

    def _make(*, username_prefix: str = "user", email_verified: bool = True,
              status: str = "active", totp: bool = False, passkeys: bool = False,
              max_sessions=None):
        suffix = secrets.token_hex(6)
        username = f"{username_prefix}_{suffix}"
        user = User(
            username=username,
            email=f"{username}@example.com",
            password_hash=get_password_hash("Passw0rd!"),
            status=status,
            email_verified=email_verified,
        )
        if max_sessions is not None:
            user.max_sessions = max_sessions
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)

        totp_secret = None
        if totp:
            import pyotp
            totp_secret = pyotp.random_base32()
            db_session.add(UserTOTP(
                user_id=user.id,
                secret_encrypted=_encrypt_totp_secret(totp_secret),
                name="test",
                is_enabled=True,
            ))
            db_session.commit()
            db_session.refresh(user)

        if passkeys:
            db_session.add(Passkey(
                user_id=user.id,
                credential_id=f"test-cred-{secrets.token_hex(16)}",
                public_key=base64.b64encode(secrets.token_bytes(64)).decode(),
                name="test-passkey",
                sign_count=0,
            ))
            db_session.commit()
            db_session.refresh(user)

        created.append(user)
        if totp:
            return user, totp_secret
        return user

    yield _make
    # 工厂产出的用户连同级联数据一并清理,降低共享 DB 的交叉污染
    for user in created:
        try:
            fresh = db_session.query(User).filter(User.id == user.id).first()
            if fresh:
                db_session.delete(fresh)
                db_session.commit()
        except Exception:
            db_session.rollback()


# seed_admin 的 TOTP 明文 secret(固定值便于测试自行生成有效验证码)
_ADMIN_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"


@pytest.fixture
def seed_admin(db_session):
    """创建一个测试 admin 用户(密码 admin123),返回 User。
    邮箱已验证 + 启用 TOTP(真实密文),使其不处于受限模式(否则 authorize 会 403)。"""
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
        # 启用 TOTP(真实 Fernet 密文,可被 TOTPService.decrypt_secret 解密),
        # 避免受限模式阻断 authorize
        if not user.totp:
            db_session.add(UserTOTP(
                user_id=user.id,
                secret_encrypted=_encrypt_totp_secret(_ADMIN_TOTP_SECRET),
                name="test",
                is_enabled=True,
            ))
        db_session.commit()
        db_session.refresh(user)
    return user


@pytest.fixture
def admin_token(client, seed_admin):  # seed_admin: 确保用户已存在
    """登录 admin 拿 access_token。"""
    resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


@pytest.fixture
def internal_client(db_session, seed_admin):
    """创建 trusted internal OAuth client,返回 (client_id, client_secret)。

    init_db/seed 也会创建 internal(默认 secret 为 internal_secret_change_this);
    测试需要确定的 secret,因此已存在时重置 secret 与字段,保证幂等。
    """
    from app.models import Client
    from app.utils.security import hash_token

    client = db_session.query(Client).filter(Client.client_id == "internal").first()
    if client:
        # init_db 已建:重置为测试期望值,避免 secret 不确定
        client.client_secret_hash = hash_token("internal_secret")
        client.redirect_uris = json.dumps(["http://localhost:3000/callback"])
        client.allowed_scopes = json.dumps(["profile", "email", "openid"])
        client.trusted = True
        client.default_access = True
        db_session.commit()
    else:
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


@pytest.fixture
def second_client(db_session, seed_admin):
    """创建第二个(非 trusted)机密 OAuth client B,返回 (client_id, client_secret)。

    client_id 唯一化(testb_<hex>),default_access=True(无需逐用户授权即可访问)。
    """
    from app.models import Client
    from app.utils.security import hash_token

    client_id = f"testb_{secrets.token_hex(4)}"
    client_secret = secrets.token_hex(16)
    client = Client(
        client_id=client_id,
        client_secret_hash=hash_token(client_secret),
        name="Second Test Client",
        description="non-trusted confidential client for tests",
        redirect_uris=json.dumps(["http://localhost:3000/callback"]),
        allowed_scopes=json.dumps(["profile", "email", "openid"]),
        trusted=False,
        default_access=True,
        owner_id=seed_admin.id,
    )
    db_session.add(client)
    db_session.commit()
    return client_id, client_secret


@pytest.fixture
def public_client(db_session, seed_admin):
    """创建 public 类型 OAuth client(SPA/移动端,免 secret),返回 client_id。

    client_secret_hash 随便哈希一个占位(public 客户端不走 secret 校验)。
    """
    from app.models import Client
    from app.utils.security import hash_token

    client_id = f"testp_{secrets.token_hex(4)}"
    client = Client(
        client_id=client_id,
        client_secret_hash=hash_token("public-client-no-secret"),
        name="Public Test Client",
        description="public client (PKCE) for tests",
        redirect_uris=json.dumps(["http://localhost:3000/callback"]),
        allowed_scopes=json.dumps(["profile", "email", "openid"]),
        trusted=False,
        client_type="public",
        default_access=True,
        owner_id=seed_admin.id,
    )
    db_session.add(client)
    db_session.commit()
    return client_id
