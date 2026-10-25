"""管理员操作审计 + 2FA 重置通知邮件测试。"""
import json

from app.services.email_service import EmailService


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _login(client, username: str) -> str:
    resp = client.post(
        "/api/auth/login",
        json={"username": username, "password": "Passw0rd!"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _audit_rows(client, admin_token, target_user_id: int) -> list[dict]:
    resp = client.get(
        "/api/admin/audit-logs",
        headers=_auth(admin_token),
        params={"target_user_id": target_user_id, "limit": 200},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["items"]


def _find_action(rows: list[dict], action: str) -> dict:
    matches = [row for row in rows if row["action"] == action]
    assert matches, f"未找到 {action} 审计记录: {rows}"
    return matches[0]


def test_reset_2fa_writes_audit_log(client, db_session, make_user, admin_token):
    """重置二次验证会留下结构化的管理员审计记录。"""
    user, _secret = make_user(totp=True, passkeys=True)

    resp = client.post(
        f"/api/admin/users/{user.id}/reset-2fa",
        headers=_auth(admin_token),
        json={},
    )
    assert resp.status_code == 200, resp.text

    rows = _audit_rows(client, admin_token, user.id)
    row = _find_action(rows, "user.2fa.reset")
    assert row["actor_username"] == "admin"
    assert row["target_username"] == user.username
    detail = json.loads(row["detail"])
    assert detail["totp_reset"] is True
    assert detail["passkeys_removed"] == 1
    assert detail["force_relogin"] is True
    assert detail["sessions_revoked"] >= 0
    assert row["ip_address"] is not None


def test_delete_user_keeps_audit_snapshot(client, db_session, make_user, admin_token):
    """用户被删除后,审计记录仍保留目标用户名快照。"""
    user = make_user()
    user_id = user.id
    username = user.username

    resp = client.delete(
        f"/api/admin/users/{user_id}", headers=_auth(admin_token)
    )
    assert resp.status_code == 204, resp.text

    rows = _audit_rows(client, admin_token, user_id)
    row = _find_action(rows, "user.delete")
    assert row["target_username"] == username


def test_password_reset_audit_never_stores_password(
    client, db_session, make_user, admin_token
):
    """改密审计只记录"重置过密码",不落明文密码。"""
    user = make_user()
    new_password = "NewStrongPass123!"

    resp = client.put(
        f"/api/admin/users/{user.id}",
        headers=_auth(admin_token),
        json={"password": new_password},
    )
    assert resp.status_code == 200, resp.text

    rows = _audit_rows(client, admin_token, user.id)
    row = _find_action(rows, "user.update")
    detail = json.loads(row["detail"])
    assert detail["password_reset"] is True
    assert "password" in detail["fields"]
    assert new_password not in row["detail"]
    assert new_password not in json.dumps(rows, ensure_ascii=False)


def test_reset_2fa_sends_security_notification(
    client, db_session, make_user, admin_token, monkeypatch
):
    """重置二次验证会异步通知用户(内容含操作者与受影响因子)。"""
    user, _secret = make_user(totp=True, passkeys=True)
    calls: list[dict] = []

    async def fake_notify(**kwargs):
        calls.append(kwargs)
        return True

    monkeypatch.setattr(
        EmailService, "send_2fa_reset_notification", staticmethod(fake_notify)
    )

    resp = client.post(
        f"/api/admin/users/{user.id}/reset-2fa",
        headers=_auth(admin_token),
        json={},
    )
    assert resp.status_code == 200, resp.text

    assert len(calls) == 1
    call = calls[0]
    assert call["to_email"] == user.email
    assert call["username"] == user.username
    assert call["admin_name"] == "admin"
    assert call["totp_reset"] is True
    assert call["passkeys_removed"] == 1
    assert call["force_relogin"] is True


def test_audit_logs_require_admin_permission(client, make_user):
    """普通用户不能读取管理员审计。"""
    user = make_user()
    token = _login(client, user.username)

    resp = client.get("/api/admin/audit-logs", headers=_auth(token))
    assert resp.status_code == 403, resp.text


def test_force_relogin_writes_audit_and_notifies(
    client, db_session, make_user, admin_token, monkeypatch
):
    """强制重新登录同时写审计并发通知。"""
    user = make_user()
    calls: list[dict] = []

    async def fake_notify(**kwargs):
        calls.append(kwargs)
        return True

    monkeypatch.setattr(
        EmailService, "send_2fa_reset_notification", staticmethod(fake_notify)
    )

    resp = client.post(
        f"/api/admin/users/{user.id}/force-relogin",
        headers=_auth(admin_token),
    )
    assert resp.status_code == 200, resp.text

    rows = _audit_rows(client, admin_token, user.id)
    row = _find_action(rows, "user.force_relogin")
    assert json.loads(row["detail"])["sessions_revoked"] >= 0
    assert calls and calls[0]["force_relogin"] is True
