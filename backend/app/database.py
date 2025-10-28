from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.config import get_settings

settings = get_settings()

# Create SQLAlchemy engine
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False}  # For SQLite
)

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
    from app.models import Role, Permission, role_permissions
    from sqlalchemy.exc import IntegrityError

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

