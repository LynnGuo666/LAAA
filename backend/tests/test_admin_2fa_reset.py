"""管理员二次验证(2FA)恢复与强制重新登录测试。

覆盖用户丢失验证器/通行密钥后的后台自救路径:
- 单独解绑 TOTP(不影响其他会话);
- 单独移除某个通行密钥;
- 一键重置二次验证:解绑 TOTP + 清空通行密钥 + 踢会话 + 删 refresh token
  + 清设备信任 + token_version 递增;
- 强制重新登录:旧 access token 立即失效;
- 角色等级保护:低权管理员不能重置更高等级管理员的 2FA。
"""
import secrets
from datetime import timedelta

from conftest import known_device, make_session

from app.models import (
    Client,
    KnownDevice,
    Passkey,
    Role,
    Token,
    User,
    UserTOTP,
)
from app.models import (
    Session as DbSession,
)
from app.utils.time import utcnow


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _login(client, username: str) -> str:
    resp = client.post(
        "/api/auth/login",
        json={"username": username, "password": "Passw0rd!"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _make_role(db, *, level: int, perm_codes: list[str]) -> Role:
    from app.models import Permission

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


def test_admin_reset_totp_keeps_other_sessions(client, db_session, make_user, admin_token):
    """单独解绑 TOTP:删除 TOTP/备用码,但保留现有会话。"""
    user, _secret = make_user(totp=True)
    session = make_session(
        db_session, user, device_id=f"totp-{secrets.token_hex(6)}"
    )

    user_id = user.id
    session_id = session.id
    resp = client.delete(
        f"/api/admin/users/{user_id}/totp", headers=_auth(admin_token)
    )
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    assert db_session.query(UserTOTP).filter(UserTOTP.user_id == user_id).first() is None
    refreshed_session = db_session.query(DbSession).filter(DbSession.id == session_id).first()
    assert refreshed_session is not None
    assert refreshed_session.kicked_at is None


def test_admin_reset_totp_when_not_enabled_returns_400(client, db_session, make_user, admin_token):
    """用户未启用 TOTP 时单独解绑 → 400,便于前端给出准确提示。"""
    user = make_user()
    resp = client.delete(
        f"/api/admin/users/{user.id}/totp", headers=_auth(admin_token)
    )
    assert resp.status_code == 400, resp.text


def test_admin_can_delete_single_passkey(client, db_session, make_user, admin_token):
    """管理员可移除用户指定的通行密钥,其他密钥不受影响。"""
    user = make_user(passkeys=True)
    # 再补一条,验证只删指定的
    second = Passkey(
        user_id=user.id,
        credential_id=f"test-cred-{secrets.token_hex(16)}",
        public_key="pk",
        name="second",
        sign_count=0,
    )
    db_session.add(second)
    db_session.commit()
    db_session.refresh(second)
    second_id = second.id

    resp = client.delete(
        f"/api/admin/users/{user.id}/passkeys/{second_id}",
        headers=_auth(admin_token),
    )
    assert resp.status_code == 204, resp.text

    db_session.expire_all()
    remaining = db_session.query(Passkey).filter(Passkey.user_id == user.id).count()
    assert remaining == 1
    assert db_session.query(Passkey).filter(Passkey.id == second_id).first() is None


def test_admin_reset_2fa_revokes_everything(client, db_session, make_user, admin_token):
    """一键重置二次验证:解绑因子、踢会话、删 refresh token、清设备信任、tv+1。"""
    user, _secret = make_user(totp=True, passkeys=True)
    session = make_session(
        db_session, user, device_id=f"reset-{secrets.token_hex(6)}"
    )
    # 与会话关联的 refresh token(强退时必须一并删除)
    token = Token(
        token_hash=session.refresh_token_hash,
        type="refresh",
        user_id=user.id,
        client_id=db_session.query(Client).first().id,
        scope="openid",
        expires_at=utcnow() + timedelta(days=7),
    )
    db_session.add(token)
    db_session.commit()
    db_session.refresh(token)
    device = known_device(db_session, user, secrets.token_hex(16))
    old_version = user.token_version
    token_id = token.id
    device_id = device.id
    session_id = session.id

    resp = client.post(
        f"/api/admin/users/{user.id}/reset-2fa",
        headers=_auth(admin_token),
        json={},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["totp_reset"] is True
    assert body["passkeys_removed"] == 1
    assert body["sessions_revoked"] >= 1

    db_session.expire_all()
    fresh = db_session.query(User).filter(User.id == user.id).first()
    assert fresh.token_version == old_version + 1
    assert db_session.query(UserTOTP).filter(UserTOTP.user_id == user.id).first() is None
    assert db_session.query(Passkey).filter(Passkey.user_id == user.id).count() == 0
    assert db_session.query(Token).filter(Token.id == token_id).first() is None
    assert db_session.query(KnownDevice).filter(KnownDevice.id == device_id).first() is None
    kicked = db_session.query(DbSession).filter(DbSession.id == session_id).first()
    assert kicked.kicked_at is not None
    assert kicked.expires_at <= utcnow()


def test_force_relogin_invalidates_existing_access_token(
    client, db_session, make_user, admin_token
):
    """强制重新登录后,用户手里的旧 access token 立即被拒绝。"""
    user = make_user()
    user_token = _login(client, user.username)

    before = client.get("/api/user/me", headers=_auth(user_token))
    assert before.status_code == 200, before.text

    resp = client.post(
        f"/api/admin/users/{user.id}/force-relogin",
        headers=_auth(admin_token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["sessions_revoked"] >= 1

    after = client.get("/api/user/me", headers=_auth(user_token))
    assert after.status_code == 401, after.text
    # 确认是 token_version 失效路径(而不是 token 被篡改/格式错误)
    assert "revoked" in after.text.lower()


def test_low_level_manager_cannot_reset_super_admin_2fa(
    client, db_session, make_user, seed_admin
):
    """仅持 admin.users 的等级 50 管理员不能重置超管(等级 100)的 2FA。"""
    role = _make_role(db_session, level=50, perm_codes=["admin.users"])
    operator = make_user(username_prefix="umgr")
    operator.roles.append(role)
    db_session.commit()
    headers = _auth(_login(client, operator.username))

    resp = client.post(
        f"/api/admin/users/{seed_admin.id}/reset-2fa",
        headers=headers,
        json={},
    )
    assert resp.status_code == 403, resp.text
    assert "无权操作" in resp.json()["detail"]
