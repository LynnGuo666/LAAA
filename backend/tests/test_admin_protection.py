"""管理域角色等级保护测试(批次3 修复1)。

守护 admin.py 的 _ensure_role_level_allowed:
仅持有 admin.users 的 user_manager 类角色(即使被攻破)不能对同级或更高
等级的用户改密/改状态/改邮箱/删除;持有 admin.roles(含 admin.* 通配)
的操作者可操作同级,但仍不能操作更高等级,也不能授予高于自身的角色。
"""
import secrets

from app.models import Permission, Role


def _make_role(db, *, level, perm_codes):
    """创建带权限的临时角色(名字随机化,共享 DB 无隔离)。"""
    role = Role(
        name=f"test_role_{secrets.token_hex(4)}",
        description="test role",
        level=level,
    )
    perms = db.query(Permission).filter(Permission.code.in_(perm_codes)).all()
    assert len(perms) == len(perm_codes), "seed 权限缺失,fixture 异常"
    role.permissions = perms
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


def _login(client, username):
    resp = client.post(
        "/api/auth/login",
        json={"username": username, "password": "Passw0rd!"},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _give_role(db, user, role):
    user.roles.append(role)
    db.commit()
    db.refresh(user)
    return user


def test_user_manager_cannot_reset_super_admin_password(client, db_session, make_user, seed_admin):
    """user_manager(仅 admin.users,等级 50)重置超管密码 → 403。"""
    um = _give_role(db_session, make_user(username_prefix="umgr"),
                    _make_role(db_session, level=50, perm_codes=["admin.users", "admin.groups"]))
    headers = _login(client, um.username)

    resp = client.put(
        f"/api/admin/users/{seed_admin.id}",
        headers=headers,
        json={"password": "HackedPass123!"},
    )
    assert resp.status_code == 403, resp.text
    assert "无权操作" in resp.json()["detail"]


def test_user_manager_cannot_suspend_super_admin(client, db_session, make_user, seed_admin):
    """user_manager 封禁超管(status=suspended)同样被等级保护拦下。"""
    um = _give_role(db_session, make_user(username_prefix="umgr"),
                    _make_role(db_session, level=50, perm_codes=["admin.users"]))
    headers = _login(client, um.username)

    resp = client.put(
        f"/api/admin/users/{seed_admin.id}",
        headers=headers,
        json={"status": "suspended"},
    )
    assert resp.status_code == 403, resp.text


def test_user_manager_cannot_delete_super_admin(client, db_session, make_user, seed_admin):
    """user_manager 删除超管 → 403(原先只防删自己)。"""
    um = _give_role(db_session, make_user(username_prefix="umgr"),
                    _make_role(db_session, level=50, perm_codes=["admin.users"]))
    headers = _login(client, um.username)

    resp = client.delete(f"/api/admin/users/{seed_admin.id}", headers=headers)
    assert resp.status_code == 403, resp.text


def test_user_manager_cannot_change_super_admin_email(client, db_session, make_user, seed_admin):
    """user_manager 改超管邮箱 → 403(邮箱换绑 = 账号接管链)。"""
    um = _give_role(db_session, make_user(username_prefix="umgr"),
                    _make_role(db_session, level=50, perm_codes=["admin.users"]))
    headers = _login(client, um.username)

    resp = client.put(
        f"/api/admin/users/{seed_admin.id}",
        headers=headers,
        json={"email": f"attacker_{secrets.token_hex(3)}@evil.com"},
    )
    assert resp.status_code == 403, resp.text


def test_user_manager_can_manage_regular_user(client, db_session, make_user):
    """等级保护不过度:user_manager(等级 50)仍可管理普通用户(等级 10)。"""
    um = _give_role(db_session, make_user(username_prefix="umgr"),
                    _make_role(db_session, level=50, perm_codes=["admin.users"]))
    target = make_user(username_prefix="plain")
    headers = _login(client, um.username)

    resp = client.put(
        f"/api/admin/users/{target.id}",
        headers=headers,
        json={"password": "ResetByAdmin123!"},
    )
    assert resp.status_code == 200, resp.text


def test_super_admin_can_reset_user_manager_password(client, db_session, make_user, admin_token):
    """超管(admin.* 通配,天然过 admin.roles 检查)改 user_manager 密码 → 200。"""
    um = _give_role(db_session, make_user(username_prefix="umgr"),
                    _make_role(db_session, level=50, perm_codes=["admin.users"]))

    resp = client.put(
        f"/api/admin/users/{um.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"password": "AdminReset123!"},
    )
    assert resp.status_code == 200, resp.text


def test_admin_roles_holder_can_operate_same_level(client, db_session, make_user):
    """持有 admin.roles 的同级操作 → 200(视为已授权管理角色体系)。"""
    operator = _give_role(db_session, make_user(username_prefix="op"),
                          _make_role(db_session, level=100, perm_codes=["admin.users", "admin.roles"]))
    target = _give_role(db_session, make_user(username_prefix="tgt"),
                        _make_role(db_session, level=100, perm_codes=["admin.users"]))
    headers = _login(client, operator.username)

    resp = client.put(
        f"/api/admin/users/{target.id}",
        headers=headers,
        json={"password": "SameLevelReset123!"},
    )
    assert resp.status_code == 200, resp.text


def test_admin_roles_holder_cannot_operate_higher_level(client, db_session, make_user, seed_admin):
    """admin.roles 持有者(等级 50)操作超管(等级 100)仍被拒 → 403。"""
    operator = _give_role(db_session, make_user(username_prefix="op"),
                          _make_role(db_session, level=50, perm_codes=["admin.users", "admin.roles"]))
    headers = _login(client, operator.username)

    resp = client.put(
        f"/api/admin/users/{seed_admin.id}",
        headers=headers,
        json={"status": "suspended"},
    )
    assert resp.status_code == 403, resp.text


def test_cannot_assign_role_above_operator_level(client, db_session, make_user):
    """admin.roles 持有者(等级 50)不能把 admin 角色(等级 100)授给任何人。"""
    from app.models import user_roles

    operator = _give_role(db_session, make_user(username_prefix="op"),
                          _make_role(db_session, level=50, perm_codes=["admin.roles"]))
    target = make_user(username_prefix="tgt")
    admin_role = db_session.query(Role).filter(Role.name == "admin").first()
    assert admin_role is not None
    headers = _login(client, operator.username)

    resp = client.put(
        f"/api/admin/users/{target.id}/roles",
        headers=headers,
        json={"role_ids": [admin_role.id]},
    )
    assert resp.status_code == 403, resp.text
    # 未发生部分写入
    linked = db_session.execute(
        user_roles.select().where(user_roles.c.user_id == target.id)
    ).fetchall()
    assert linked == []


def test_super_admin_can_assign_admin_role(client, db_session, make_user, admin_token):
    """超管(等级 100)授予 admin 角色(等级 100,不高于自身)→ 200。"""
    from app.models import Role

    target = make_user(username_prefix="tgt")
    admin_role = db_session.query(Role).filter(Role.name == "admin").first()

    resp = client.put(
        f"/api/admin/users/{target.id}/roles",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"role_ids": [admin_role.id]},
    )
    assert resp.status_code == 200, resp.text
    assert "admin" in resp.json()["roles"]


# ============================================================================
# 修复 2:最后一名管理员保护
# ============================================================================

def _assert_single_admin(db):
    """前置断言:当前全站只有 seed_admin 一个活跃管理员。

    本文件是字母序第一个测试文件,且 make_user 产出的用户都会被工厂
    teardown 清理,该前提在批内稳定成立;若失效则测试自身会在此报警。
    """
    from app.models import Role, User, user_roles
    from app.routes.admin import _has_active_admins

    admin_role = db.query(Role).filter(Role.name == "admin").first()
    holders = [
        row[0] for row in db.execute(
            user_roles.select().where(user_roles.c.role_id == admin_role.id)
        ).fetchall()
    ]
    active_holders = db.query(User.id).filter(
        User.id.in_(holders), User.status == "active"
    ).count()
    assert _has_active_admins(db) is True
    assert active_holders == 1, f"前置失效:活跃 admin 角色持有者 {active_holders} 个"


def test_last_admin_cannot_remove_own_admin_role(client, db_session, seed_admin, admin_token):
    """唯一管理员移除自己的 admin 角色 → 400(防系统锁死)。"""
    _assert_single_admin(db_session)

    resp = client.put(
        f"/api/admin/users/{seed_admin.id}/roles",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"role_ids": []},
    )
    assert resp.status_code == 400, resp.text
    assert "最后一名管理员" in resp.json()["detail"]
    # 回滚生效:admin 角色仍在
    db_session.expire_all()
    assert seed_admin.has_role("admin")


def test_admin_role_removal_allowed_with_second_admin(client, db_session, make_user, seed_admin):
    """存在第二个管理员时移除自己的 admin 角色 → 200。"""
    from app.models import Role

    second = make_user(username_prefix="adm2")
    admin_role = db_session.query(Role).filter(Role.name == "admin").first()
    second.roles.append(admin_role)
    db_session.commit()
    headers = _login(client, second.username)

    resp = client.put(
        f"/api/admin/users/{second.id}/roles",
        headers=headers,
        json={"role_ids": []},
    )
    assert resp.status_code == 200, resp.text
    db_session.expire_all()
    assert not second.has_role("admin")


def test_last_admin_cannot_be_suspended(client, db_session, seed_admin, admin_token):
    """把唯一活跃管理员 status 改为 suspended → 400。"""
    _assert_single_admin(db_session)

    resp = client.put(
        f"/api/admin/users/{seed_admin.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"status": "suspended"},
    )
    assert resp.status_code == 400, resp.text
    assert "最后一名" in resp.json()["detail"]
    db_session.expire_all()
    assert seed_admin.status == "active"


def test_last_admin_cannot_be_deleted(client, db_session, make_user, seed_admin):
    """删除唯一活跃管理员 → 400(操作者为持有 admin.roles 的同级自定义角色)。"""
    _assert_single_admin(db_session)

    operator = _give_role(db_session, make_user(username_prefix="op"),
                          _make_role(db_session, level=100, perm_codes=["admin.users", "admin.roles"]))
    headers = _login(client, operator.username)

    resp = client.delete(f"/api/admin/users/{seed_admin.id}", headers=headers)
    assert resp.status_code == 400, resp.text
    assert "最后一名" in resp.json()["detail"]
    db_session.expire_all()
    assert db_session.query(type(seed_admin)).filter(
        type(seed_admin).id == seed_admin.id).first() is not None

