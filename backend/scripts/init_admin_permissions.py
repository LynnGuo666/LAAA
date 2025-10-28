"""
初始化管理员角色和权限

运行方式: python -m backend.scripts.init_admin_permissions
"""

from app.database import SessionLocal
from app.models import Role, Permission, User, user_roles, role_permissions
from sqlalchemy.exc import IntegrityError


def init_permissions():
    """初始化权限"""
    db = SessionLocal()

    permissions_data = [
        {
            'code': 'admin.*',
            'name': '全部管理员权限',
            'description': '拥有所有管理员权限，包括用户管理、角色管理等'
        },
        {
            'code': 'admin.users',
            'name': '用户管理',
            'description': '管理系统用户，包括创建、编辑、删除用户'
        },
        {
            'code': 'admin.roles',
            'name': '角色管理',
            'description': '管理系统角色和权限'
        },
        {
            'code': 'admin.groups',
            'name': '用户组管理',
            'description': '���理用户组'
        },
        {
            'code': 'admin.clients',
            'name': '客户端管理',
            'description': '管理 OAuth 客户端应用'
        },
    ]

    created_permissions = []

    for perm_data in permissions_data:
        try:
            # 检查权限是否已存在
            existing = db.query(Permission).filter(
                Permission.code == perm_data['code']
            ).first()

            if existing:
                print(f"权限 {perm_data['code']} 已存在，跳过")
                created_permissions.append(existing)
            else:
                permission = Permission(**perm_data)
                db.add(permission)
                db.commit()
                db.refresh(permission)
                created_permissions.append(permission)
                print(f"✅ 创建权限: {perm_data['code']} - {perm_data['name']}")
        except IntegrityError:
            db.rollback()
            print(f"❌ 创建权限失败: {perm_data['code']}")

    db.close()
    return created_permissions


def init_roles(permissions):
    """初始化角色"""
    db = SessionLocal()

    roles_data = [
        {
            'name': 'admin',
            'description': '系统管理员，拥有所有权限',
            'level': 100,
            'permission_codes': ['admin.*']
        },
        {
            'name': 'user_manager',
            'description': '用户管理员，可以管理用户和用户组',
            'level': 50,
            'permission_codes': ['admin.users', 'admin.groups']
        },
    ]

    created_roles = []

    for role_data in roles_data:
        try:
            # 检查角色是否已存在
            existing = db.query(Role).filter(
                Role.name == role_data['name']
            ).first()

            if existing:
                print(f"角色 {role_data['name']} 已存在，跳过")
                created_roles.append(existing)
                continue

            # 创建角色
            permission_codes = role_data.pop('permission_codes')
            role = Role(**role_data)
            db.add(role)
            db.flush()

            # 关联权限
            for perm in permissions:
                if perm.code in permission_codes:
                    db.execute(
                        role_permissions.insert().values(role_id=role.id, permission_id=perm.id)
                    )

            db.commit()
            db.refresh(role)
            created_roles.append(role)
            print(f"✅ 创建角色: {role_data['name']} - {role_data['description']}")
        except IntegrityError:
            db.rollback()
            print(f"❌ 创建角色失败: {role_data['name']}")

    db.close()
    return created_roles


def assign_admin_role_to_first_user():
    """将管理员角色分配给第一个用户（ID=1）"""
    db = SessionLocal()

    try:
        # 获取第一个用户
        first_user = db.query(User).filter(User.id == 1).first()
        if not first_user:
            print("❌ 未找到 ID 为 1 的用户")
            db.close()
            return

        # 获取管理员角色
        admin_role = db.query(Role).filter(Role.name == 'admin').first()
        if not admin_role:
            print("❌ 未找到管理员角色")
            db.close()
            return

        # 检查用户是否已有该角色
        if admin_role in first_user.roles:
            print(f"用户 {first_user.username} 已拥有管理员角色")
        else:
            # 分配角色
            db.execute(
                user_roles.insert().values(user_id=first_user.id, role_id=admin_role.id)
            )
            db.commit()
            print(f"✅ 已将管理员角色分配给用户: {first_user.username}")

    except Exception as e:
        db.rollback()
        print(f"❌ 分配管理员角色失败: {e}")
    finally:
        db.close()


def main():
    """主函数"""
    print("=" * 50)
    print("初始化管理员角色和权限")
    print("=" * 50)

    print("\n1. 创建权限...")
    permissions = init_permissions()

    print("\n2. 创建角色...")
    roles = init_roles(permissions)

    print("\n3. 分配管理员角色给第一个用户...")
    assign_admin_role_to_first_user()

    print("\n" + "=" * 50)
    print("✅ 初始化完成！")
    print("=" * 50)


if __name__ == "__main__":
    main()
