"""
Database initialization and seed data
"""
from sqlalchemy.orm import Session
from app.database import SessionLocal, init_db
from app.models import User, Role, Permission, Client, role_permissions
from app.utils.security import get_password_hash, generate_random_string, hash_token
import json


def create_roles_and_permissions(db: Session):
    """Create default roles and permissions"""

    # Create permissions
    permissions_data = [
        ("admin.*", "Admin All", "Full administrative access"),
        ("user.read", "Read User", "View user information"),
        ("user.write", "Write User", "Edit user information"),
        ("client.read", "Read Client", "View OAuth clients"),
        ("client.write", "Write Client", "Create/edit OAuth clients"),
        ("client.delete", "Delete Client", "Delete OAuth clients"),
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
            "admin.*"
        ]),
        ("user", "User", 10, [
            "user.read", "user.write", "client.read", "client.write", "client.delete"
        ]),
        ("guest", "Guest", 1, [
            "user.read"
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
            status="active"
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)

        # Assign admin role
        admin_role = db.query(Role).filter(Role.name == "admin").first()
        if admin_role:
            admin.roles.append(admin_role)
            db.commit()

        print(f"  ✓ Created admin user (username: admin, password: admin123)")
    else:
        print(f"  ℹ Admin user already exists")


def create_internal_client(db: Session):
    """Create internal client for direct login"""
    client = db.query(Client).filter(Client.client_id == "internal").first()

    if not client:
        # Get admin user as owner
        admin = db.query(User).filter(User.username == "admin").first()

        client_secret = "internal_secret_change_this"
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

        print(f"  ✓ Created internal client")
    else:
        print(f"  ℹ Internal client already exists")


def seed_database():
    """Initialize database with seed data"""
    print("🌱 Seeding database...")

    # Initialize database tables
    init_db()

    db = SessionLocal()
    try:
        print("\n📋 Creating roles and permissions...")
        create_roles_and_permissions(db)

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
