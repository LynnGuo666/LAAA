"""magic link 回归测试(守护 76a8317:purpose 校验封死登录后门)。

背景:verify_magic_link 此前按纯 token 查询命中任意 VerificationCode,
导致 email_verification / change_email 的验证链接可以直接免密登录(后门)。
修复:只接受 purpose in ("magic_link", "magic_link_login")。

覆盖:
1. email_verification / change_email 的 token 不能用于 magic-link 登录(400)
2. 独立 magic-link 登录全流程(申请 → DB 取 token + device cookie → 验证 → access_token)
3. 设备不匹配 → 403;单次使用;封禁用户 → 403

注:SMTP_ENABLED=false 时 EmailService 只打 warning 不发信,不影响流程。
"""
import secrets
from datetime import timedelta

from app.models import VerificationCode
from app.utils.time import utcnow


def _insert_verification_code(db, user, *, purpose, token=None, device_token=None,
                              expires_minutes=60, is_used=False, new_email=None):
    """直插一条 VerificationCode,返回 token 字符串。"""
    token = token or secrets.token_urlsafe(32)
    vc = VerificationCode(
        user_id=user.id,
        token=token,
        purpose=purpose,
        device_token=device_token,
        expires_at=utcnow() + timedelta(minutes=expires_minutes),
        max_attempts=1,
        is_used=is_used,
        new_email=new_email,
    )
    db.add(vc)
    db.commit()
    return token


def _latest_magic_link_login_code(db, user):
    """取该用户最新一条未使用的 magic_link_login 记录。"""
    return (
        db.query(VerificationCode)
        .filter(
            VerificationCode.user_id == user.id,
            VerificationCode.purpose == "magic_link_login",
            VerificationCode.is_used == False,
        )
        .order_by(VerificationCode.created_at.desc())
        .first()
    )


def test_email_verification_token_cannot_magic_login(client, db_session, make_user):
    """email_verification 用途的 token 打 magic-link 登录 → 400(后门封死)。"""
    user = make_user()
    token = _insert_verification_code(db_session, user, purpose="email_verification")

    resp = client.get(f"/api/auth/magic-link/login/{token}")
    assert resp.status_code == 400, resp.text


def test_change_email_token_cannot_magic_login(client, db_session, make_user):
    """change_email 用途的 token 打 magic-link 登录 → 400(后门封死)。"""
    user = make_user()
    token = _insert_verification_code(
        db_session, user, purpose="change_email", new_email="new@example.com"
    )

    resp = client.get(f"/api/auth/magic-link/login/{token}")
    assert resp.status_code == 400, resp.text


def test_magic_link_full_flow(client, db_session, make_user):
    """独立 magic-link 登录全流程。

    POST /api/auth/magic-link/login {email} → 从 DB 按 user+purpose=magic_link_login
    查最新明文 token 与 device_token → GET 验证(带 cookie)→ 200 拿 access_token。
    """
    user = make_user()  # email_verified 无所谓,SMTP 关闭不真发信

    resp = client.post("/api/auth/magic-link/login", json={"email": user.email})
    assert resp.status_code == 200, resp.text
    assert resp.json()["message"] == "如果该邮箱已注册，我们已发送登录链接"

    vc = _latest_magic_link_login_code(db_session, user)
    assert vc is not None, "magic_link_login code not created"
    token = vc.token
    device_token = vc.device_token
    assert token and device_token

    # cookie_secure=True → jar 不自动回传,显式按请求传 cookie
    verify = client.get(
        f"/api/auth/magic-link/login/{token}",
        cookies={"magic_link_device": device_token},
    )
    assert verify.status_code == 200, verify.text
    data = verify.json()
    assert data["verification_complete"] is True
    assert data["access_token"]

    # 登录态可用:userinfo 正常
    me = client.get(
        "/api/oauth/userinfo", headers={"Authorization": f"Bearer {data['access_token']}"}
    )
    assert me.status_code == 200, me.text
    assert me.json()["sub"] == str(user.id)


def test_magic_link_device_mismatch_403(client, db_session, make_user):
    """申请后不带 device cookie 验证 → 403(设备绑定校验)。"""
    user = make_user()

    resp = client.post("/api/auth/magic-link/login", json={"email": user.email})
    assert resp.status_code == 200, resp.text

    vc = _latest_magic_link_login_code(db_session, user)
    assert vc is not None

    verify = client.get(f"/api/auth/magic-link/login/{vc.token}")
    assert verify.status_code == 403, verify.text
    assert "同一设备" in verify.json()["detail"]


def test_magic_link_single_use(client, db_session, make_user):
    """成功验证后同 token 再来 → 400(单次使用)。"""
    user = make_user()

    resp = client.post("/api/auth/magic-link/login", json={"email": user.email})
    assert resp.status_code == 200, resp.text

    vc = _latest_magic_link_login_code(db_session, user)
    assert vc is not None

    first = client.get(
        f"/api/auth/magic-link/login/{vc.token}",
        cookies={"magic_link_device": vc.device_token},
    )
    assert first.status_code == 200, first.text

    second = client.get(
        f"/api/auth/magic-link/login/{vc.token}",
        cookies={"magic_link_device": vc.device_token},
    )
    assert second.status_code == 400, second.text


def test_magic_link_suspended_user_rejected(client, db_session, make_user):
    """status=suspended 用户的 magic-link 验证 → 403(与密码/passkey 路径一致)。

    注意:申请阶段(magic_link_login_send)对非 active 用户静默返回同消息,
    因此 token 需直插 DB 模拟"申请后账户被停用"的场景。
    """
    user = make_user(status="suspended")
    token = _insert_verification_code(
        db_session, user, purpose="magic_link_login", device_token="dev-xyz"
    )

    resp = client.get(
        f"/api/auth/magic-link/login/{token}", cookies={"magic_link_device": "dev-xyz"}
    )
    assert resp.status_code == 403, resp.text
    assert "停用" in resp.json()["detail"]
