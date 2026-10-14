"""
Database initialization and seed data
"""
import json
import os
import secrets

from sqlalchemy.orm import Session

from app.database import SessionLocal, init_db
from app.models import Client, Group, Permission, Role, User
from app.utils.security import get_password_hash, hash_token


def create_roles_and_permissions(db: Session):
    """Create default roles and permissions"""

    # Create permissions
    permissions_data = [
        # Admin permissions (hierarchical)
        ("admin.*", "Admin All", "Full administrative access"),
        ("admin.users", "Manage Users", "View and manage all users"),
        ("admin.roles", "Manage Roles", "View and manage roles"),
        ("admin.groups", "Manage Groups", "View and manage user groups"),
        ("admin.clients", "Manage Clients", "View and manage all OAuth clients"),
        # User permissions (for own profile)
        ("user.read", "Read Profile", "View own profile"),
        ("user.write", "Write Profile", "Edit own profile"),
    ]

    permissions = {}
    for code, name, description in permissions_data:
        perm = db.query(Permission).filter(Permission.code == code).first()
        if not perm:
            perm = Permission(code=code, name=name, description=description)
            db.add(perm)
            print(f"  ✓ Created permission: {code}")
        permissions[code] = perm

    db.commit()

    # Create roles
    roles_data = [
        ("admin", "Administrator", 100, [
            "admin.*"  # Full admin access (includes admin.users, admin.roles, etc.)
        ]),
        ("user", "User", 10, [
            "user.read", "user.write"  # Own profile only
        ]),
        ("guest", "Guest", 1, [
            "user.read"  # Read-only access to own profile
        ])
    ]

    for name, description, level, perm_codes in roles_data:
        role = db.query(Role).filter(Role.name == name).first()
        if not role:
            role = Role(name=name, description=description, level=level)
            db.add(role)
            print(f"  ✓ Created role: {name}")

        # Assign permissions
        for code in perm_codes:
            if code in permissions and permissions[code] not in role.permissions:
                role.permissions.append(permissions[code])

    db.commit()


def create_default_admin(db: Session):
    """Create default admin user"""
    admin = db.query(User).filter(User.username == "admin").first()

    if not admin:
        admin = User(
            username="admin",
            email="admin@example.com",
            password_hash=get_password_hash("admin123"),
            status="active",
            # 默认口令是公开知识:首登强制改密(前端强引导,改密成功后清除)
            must_change_password=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)

        # Assign admin role
        admin_role = db.query(Role).filter(Role.name == "admin").first()
        if admin_role:
            admin.roles.append(admin_role)

        # Assign to default group
        default_group = db.query(Group).filter(Group.is_default == True).first()
        if default_group:
            admin.groups.append(default_group)

        db.commit()

        print("  ✓ Created admin user (username: admin, password: admin123)")
    else:
        print("  ℹ Admin user already exists")


def create_internal_client(db: Session):
    """Create internal client for direct login.

    secret 来源优先级:
    1. 环境变量 INTERNAL_CLIENT_SECRET(docker-compose 注入用);
    2. 随机生成 secrets.token_urlsafe(32),首次创建时打印一次。
    不再使用硬编码默认值——它在公开仓库里等于没有 secret。
    """
    client = db.query(Client).filter(Client.client_id == "internal").first()

    if not client:
        # Get admin user as owner
        admin = db.query(User).filter(User.username == "admin").first()

        client_secret = os.environ.get("INTERNAL_CLIENT_SECRET") or secrets.token_urlsafe(32)
        client = Client(
            client_id="internal",
            client_secret_hash=hash_token(client_secret),
            name="Internal Client",
            description="Default client for direct authentication",
            redirect_uris=json.dumps(["http://localhost:8000/callback"]),
            allowed_scopes=json.dumps(["profile", "email", "openid"]),
            trusted=True,
            owner_id=admin.id if admin else 1
        )
        db.add(client)
        db.commit()

        print("  ✓ Created internal client")
        if os.environ.get("INTERNAL_CLIENT_SECRET"):
            print("  ℹ internal client secret 来自环境变量 INTERNAL_CLIENT_SECRET")
        else:
            print("  ⚠️  internal client secret(仅此一次展示,请立即妥善保存):")
            print(f"     {client_secret}")
            print("     也可用环境变量 INTERNAL_CLIENT_SECRET 显式指定以固定该值")
    else:
        print("  ℹ Internal client already exists")


def create_default_groups(db: Session):
    """Create default user groups"""
    groups_data = [
        ("所有用户", "默认用户组，所有新用户自动加入", True),
        ("开发者", "应用开发者组", False),
        ("测试用户", "用于测试的用户组", False),
    ]

    for name, description, is_default in groups_data:
        group = db.query(Group).filter(Group.name == name).first()
        if not group:
            # If this should be default, unset other defaults first
            if is_default:
                db.query(Group).filter(Group.is_default == True).update({'is_default': False})

            group = Group(
                name=name,
                description=description,
                is_default=is_default
            )
            db.add(group)
            print(f"  ✓ Created group: {name}")
        else:
            print(f"  ℹ Group already exists: {name}")

    db.commit()



def seed_database():
    """Initialize database with seed data"""
    print("🌱 Seeding database...")

    # Initialize database tables
    init_db()

    db = SessionLocal()
    try:
        print("\n📋 Creating roles and permissions...")
        create_roles_and_permissions(db)

        print("\n👥 Creating default groups...")
        create_default_groups(db)

        print("\n👤 Creating default admin user...")
        create_default_admin(db)

        print("\n🔑 Creating internal client...")
        create_internal_client(db)

        print("\n✅ Database seeding completed!")
        print("\n📝 Default credentials:")
        print("   Username: admin")
        print("   Password: admin123")
        print("\n⚠️  Please change the default password after first login!")

    except Exception as e:
        print(f"\n❌ Error seeding database: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
