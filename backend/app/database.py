import os
import secrets

from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import get_settings

settings = get_settings()

# Create SQLAlchemy engine
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False}  # For SQLite
)


# SQLite 并发与耐久性调优:WAL 模式允许读写并发,busy_timeout 避免写锁竞争立即报错,
# synchronous=NORMAL 在 WAL 下兼顾性能与崩溃安全。
@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


# Create SessionLocal class
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create Base class
Base = declarative_base()


# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Create all tables
def init_db():
    """初始化数据库 schema + 种子权限/角色。

    schema 演进说明:生产应优先用 `alembic upgrade head`(见 DEPLOY.md)。
    此处在无 alembic 的部署(如开发快速启动)兜底用 create_all 建缺失表,
    但不会修改既有表结构(加列需走迁移)。权限/角色种子是幂等的。
    """
    from sqlalchemy.exc import IntegrityError

    from app.models import Permission, Role, role_permissions

    Base.metadata.create_all(bind=engine)

    # 初始化管理员权限和角色
    db = SessionLocal()
    try:
        # 检查是否已经初始化过
        existing_admin_role = db.query(Role).filter(Role.name == 'admin').first()
        if existing_admin_role:
            return  # 已经初始化过，跳过

        print("🔧 初始化管理员权限和角色...")

        # 创建权限
        permissions_data = [
            {'code': 'admin.*', 'name': '全部管理员权限', 'description': '拥有所有管理员权限'},
            {'code': 'admin.users', 'name': '用户管理', 'description': '管理系统用户'},
            {'code': 'admin.roles', 'name': '角色管理', 'description': '管理系统角色和权限'},
            {'code': 'admin.groups', 'name': '用户组管理', 'description': '管理用户组'},
            {'code': 'admin.clients', 'name': '客户端管理', 'description': '管理 OAuth 客户端应用'},
        ]

        created_permissions = []
        for perm_data in permissions_data:
            perm = Permission(**perm_data)
            db.add(perm)
            db.flush()
            created_permissions.append(perm)

        # 创建管理员角色
        admin_role = Role(
            name='admin',
            description='系统管理员，拥有所有权限',
            level=100
        )
        db.add(admin_role)
        db.flush()

        # 关联 admin.* 权限到管理员角色
        admin_permission = next(p for p in created_permissions if p.code == 'admin.*')
        db.execute(
            role_permissions.insert().values(
                role_id=admin_role.id,
                permission_id=admin_permission.id
            )
        )

        # 创建用户管理员角色
        user_manager_role = Role(
            name='user_manager',
            description='用户管理员，可以管理用户和用户组',
            level=50
        )
        db.add(user_manager_role)
        db.flush()

        # 关联权限到用户管理员角色
        for perm in created_permissions:
            if perm.code in ['admin.users', 'admin.groups']:
                db.execute(
                    role_permissions.insert().values(
                        role_id=user_manager_role.id,
                        permission_id=perm.id
                    )
                )

        db.commit()
        print("✅ 管理员权限和角色初始化完成")

        # 将管理员角色分配给第一个用户
        from app.models import User, user_roles
        first_user = db.query(User).filter(User.id == 1).first()
        if first_user:
            db.execute(
                user_roles.insert().values(
                    user_id=first_user.id,
                    role_id=admin_role.id
                )
            )
            db.commit()
            print(f"✅ 已将管理员角色分配给用户: {first_user.username}")

    except IntegrityError:
        db.rollback()
    except Exception as e:
        db.rollback()
        print(f"⚠️  初始化管理员权限时出错: {e}")
    finally:
        db.close()

    _ensure_internal_client()


# 历史版本的硬编码 internal client secret(公开仓库可见,视为已泄露)。
# 存量库若仍用它,非 DEBUG 模式下启动时自动轮换(见 _ensure_internal_client)。
_LEGACY_INTERNAL_CLIENT_SECRET = "internal_secret_change_this"


def _ensure_internal_client():
    """确保 internal OAuth 客户端存在(幂等),并处理默认 secret 的轮换。

    seed.py 也会创建,但测试环境/精简部署可能不跑 seed;
    登录链路依赖它,缺失会让所有登录 500。

    secret 策略:
    - 新建:优先 INTERNAL_CLIENT_SECRET 环境变量,否则随机生成并打印一次;
    - 存量:若 secret_hash 仍是历史硬编码默认值的哈希且非 DEBUG 模式,
      启动时自动轮换为随机值并打日志警告——避免存量库带着公开仓库里的
      secret 跑生产(internal 客户端自身的登录链路不用 secret,轮换
      不影响 LAAA 自身运行,只断了外部拿默认值冒用的路径)。
    - DEBUG 模式不轮换(开发便利),但每次启动都警告。
    """
    import json as _json

    from app.models import Client
    from app.utils.security import hash_token

    db = SessionLocal()
    try:
        existing = db.query(Client).filter(Client.client_id == 'internal').first()
        if existing:
            _maybe_rotate_legacy_internal_secret(db, existing)
            return

        print("🔧 创建 internal OAuth 客户端...")
        client_secret = os.environ.get("INTERNAL_CLIENT_SECRET") or secrets.token_urlsafe(32)
        db.add(Client(
            client_id='internal',
            name='内部客户端',
            description='LAAA 自身登录流程使用的内置客户端',
            client_secret_hash=hash_token(client_secret),
            redirect_uris=_json.dumps(['http://localhost:3000/callback']),
            allowed_scopes=_json.dumps(['profile', 'email', 'openid']),
            trusted=True,
            default_access=True,
            owner_id=1,  # 首个用户(admin);owner_id 非空约束的最小满足
        ))
        db.commit()
        print("✅ internal 客户端已就绪")
        if not os.environ.get("INTERNAL_CLIENT_SECRET"):
            print("⚠️  internal client secret(仅此一次展示,请立即妥善保存):")
            print(f"    {client_secret}")
            print("    也可用环境变量 INTERNAL_CLIENT_SECRET 显式指定以固定该值")
    except Exception as e:
        db.rollback()
        print(f"⚠️  创建 internal 客户端失败: {e}")
    finally:
        db.close()


def _maybe_rotate_legacy_internal_secret(db, client) -> None:
    """存量 internal 客户端仍用硬编码默认 secret 时,按需轮换。"""
    from app.config import get_settings
    from app.utils.security import hash_token, verify_client_secret

    try:
        if not verify_client_secret(_LEGACY_INTERNAL_CLIENT_SECRET, client.client_secret_hash):
            return  # 已是自定义/随机值,无需处理

        if get_settings().debug:
            print(
                "⚠️  internal 客户端仍在使用公开仓库中的默认 secret,"
                "DEBUG 模式下未自动轮换——生产环境启动时会强制轮换,"
                "或用环境变量 INTERNAL_CLIENT_SECRET 显式指定"
            )
            return

        new_secret = os.environ.get("INTERNAL_CLIENT_SECRET") or secrets.token_urlsafe(32)
        client.client_secret_hash = hash_token(new_secret)
        db.commit()
        print(
            "⚠️  安全警告:internal 客户端的 secret 为历史硬编码默认值(已公开),"
            "已自动轮换为随机值。该 secret 不用于 LAAA 自身登录,"
            "如有外部依赖方使用旧值,请通过管理界面重新下发。"
        )
    except Exception as e:
        db.rollback()
        print(f"⚠️  检查/轮换 internal 客户端 secret 失败: {e}")

