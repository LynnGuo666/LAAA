"""known_devices 回归测试(守护 ed0f434:设备信任与 session 存活解耦)。

背景:sessions 行会因登出/过期/踢除被删除,若"已知设备"判定只查 sessions,
单设备用户每次登出后都会被风控当成新设备、强制两步验证。
设计:登录成功时 upsert known_devices;
- 普通登出/并发超限踢人 → 保留记忆(本文件前半段守护);
- 主动撤销会话/管理员强退/改密/refresh 重放 → 立即遗忘(本文件后半段守护);
- 超过 KNOWN_DEVICE_RETENTION_DAYS 未活跃 → maintenance 清理。

测试约定(conftest):共享 session 级 DB,不断言全表计数,只断言自己创建的行;
单测试内登录类请求 <10 次(IP 限流)。
"""
import secrets
from datetime import timedelta

from conftest import known_device, make_session

from app.models import KnownDevice
from app.services.risk_service import RiskService
from app.utils.time import utcnow


def _login(client, user, device_token):
    resp = client.post(
        "/api/auth/login",
        json={
            "username": user.username,
            "password": "Passw0rd!",
            "device_token": device_token,
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_login_upserts_known_device(client, db_session, make_user):
    """带 device_token 登录 → known_devices 有行;再登一次 → 仍 1 行且 last_seen 更新。"""
    user = make_user()
    device_token = f"devtok_{secrets.token_hex(16)}"

    _login(client, user, device_token)

    rows = db_session.query(KnownDevice).filter(
        KnownDevice.user_id == user.id,
        KnownDevice.device_token == device_token,
    ).all()
    assert len(rows) == 1, f"expected 1 known_device row, got {len(rows)}"
    first_seen = rows[0].last_seen

    # 第二次登录:upsert 而非新增
    _login(client, user, device_token)
    db_session.expire_all()
    rows = db_session.query(KnownDevice).filter(
        KnownDevice.user_id == user.id,
        KnownDevice.device_token == device_token,
    ).all()
    assert len(rows) == 1, f"second login must not duplicate known_device, got {len(rows)}"
    assert rows[0].last_seen >= first_seen


def test_known_device_survives_logout(client, db_session, make_user):
    """登录 → logout(带 refresh token)→ is_known_device_token 仍 True(回归本质)。

    logout 会删 session 行;若设备信任仍绑定 session 存活,
    is_known_device_token 将返回 False——这正是 ed0f434 修复的行为。
    """
    user = make_user()
    device_token = f"devtok_{secrets.token_hex(16)}"
    data = _login(client, user, device_token)

    resp = client.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {data['access_token']}"},
        json={"refresh_token": data["refresh_token"]},
    )
    assert resp.status_code == 200, resp.text

    assert RiskService.is_known_device_token(db_session, user.id, device_token) is True


def test_known_device_endpoint_level(client, risk_enabled, monkeypatch, make_user):
    """端到端:风控开启时首登(新设备)→ 202;完成真实验证(邮箱验证码)后登出;
    同 device_token 再登 → 200(不再强制验证)。

    依赖 risk_enabled fixture(打开风控双开关)。
    单测试内 3 次登录请求,远低于 /api/auth/login 的 10/minute 限流;
    high_velocity 判定需 5 次/5min,也不会触发。

    注:受限模式 skip 自 b1c014c 起只签发受限 token 且不落任何设备/会话
    记录(防借 skip 洗白设备),因此本测试改走邮箱验证码完成登录——
    只有真实验证完成的登录才会 upsert known_devices。
    """
    from app.services.verification_service import VerificationService

    user = make_user()  # 默认已验证邮箱,可用邮箱验证码完成 step-up
    device_token = f"devtok_{secrets.token_hex(16)}"

    # 首次登录:新设备 → 202 要求验证(新设备 score 1 → LOW → 需 1 次验证)
    r1 = client.post(
        "/api/auth/login",
        json={
            "username": user.username,
            "password": "Passw0rd!",
            "device_token": device_token,
        },
    )
    assert r1.status_code == 202, r1.text
    session_token = r1.json()["session_token"]

    # 桩住验证码生成器(SMTP 关闭,邮件不外发),走真实发送 + 验证端点
    monkeypatch.setattr(
        VerificationService, "generate_verification_code",
        staticmethod(lambda: "654321"),
    )
    r_send = client.post(
        "/api/auth/verify/email-code/send",
        json={"session_token": session_token},
    )
    assert r_send.status_code == 200, r_send.text

    # 完成验证 → 签发完整 token,known_device 在 create_tokens 中落库
    r2 = client.post(
        "/api/auth/verify/email-code",
        json={"session_token": session_token, "code": "654321"},
    )
    assert r2.status_code == 200, r2.text
    refresh_token = r2.json()["refresh_token"]
    access_token = r2.json()["access_token"]

    # 登出(session 被删)
    r3 = client.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {access_token}"},
        json={"refresh_token": refresh_token},
    )
    assert r3.status_code == 200, r3.text

    # 同 device_token 再登:已知设备,无新设备异常 → 200 直接发 token
    r4 = client.post(
        "/api/auth/login",
        json={
            "username": user.username,
            "password": "Passw0rd!",
            "device_token": device_token,
        },
    )
    assert r4.status_code == 200, r4.text
    assert "access_token" in r4.json()


def test_is_known_device_fallback_to_sessions(db_session, make_user):
    """存量兼容:不写 KnownDevice,只有 session 行带 device_token → 判定 True。"""
    user = make_user()
    device_token = f"devtok_{secrets.token_hex(16)}"
    make_session(db_session, user, device_id=f"sdev_{secrets.token_hex(8)}",
                 device_token=device_token)

    assert RiskService.is_known_device_token(db_session, user.id, device_token) is True


# ---------------------------------------------------------------------------
# 设备遗忘:主动下线/安全事件立即生效,普通登出与并发踢人保留
# ---------------------------------------------------------------------------

def _auth_headers(data, *, with_refresh: bool = False):
    headers = {"Authorization": f"Bearer {data['access_token']}"}
    if with_refresh:
        # laaa_refresh cookie 的 Path=/api/auth,/api/user/* 收不到,
        # 必须显式带 X-Refresh-Token 才能反查到当前 session。
        headers["X-Refresh-Token"] = data["refresh_token"]
    return headers


def _known_row(db, user, device_token):
    db.expire_all()
    return db.query(KnownDevice).filter(
        KnownDevice.user_id == user.id,
        KnownDevice.device_token == device_token,
    ).first()


def test_revoke_session_forgets_device(client, db_session, make_user):
    """主动撤销会话 → 该设备的 known_devices 立即删除。"""
    user = make_user()
    device_token = f"devtok_{secrets.token_hex(16)}"
    data = _login(client, user, device_token)

    sessions = client.get(
        "/api/user/sessions", headers=_auth_headers(data, with_refresh=True)
    ).json()
    assert sessions, "login should create a session"

    resp = client.delete(
        f"/api/user/sessions/{sessions[0]['id']}",
        headers=_auth_headers(data),
    )
    assert resp.status_code == 200, resp.text
    assert _known_row(db_session, user, device_token) is None


def test_revoke_other_sessions_forgets_their_devices(client, db_session, make_user):
    """"登出其他设备"→ 只遗忘被踢的设备,当前设备保留。"""
    user = make_user()
    current_token = f"devtok_{secrets.token_hex(16)}"
    data = _login(client, user, current_token)

    other_token = f"devtok_{secrets.token_hex(16)}"
    make_session(
        db_session, user,
        device_id=f"sdev_{secrets.token_hex(8)}",
        device_token=other_token,
    )
    known_device(db_session, user, other_token, device_name="other-device")

    resp = client.post(
        "/api/user/sessions/revoke-others",
        headers=_auth_headers(data, with_refresh=True),
        json={},
    )
    assert resp.status_code == 200, resp.text

    assert _known_row(db_session, user, other_token) is None
    assert _known_row(db_session, user, current_token) is not None


def test_forget_device_endpoint(client, db_session, make_user):
    """忘记设备接口:删除记忆 + 吊销该设备会话,并标记 was_current。"""
    user = make_user()
    device_token = f"devtok_{secrets.token_hex(16)}"
    data = _login(client, user, device_token)
    headers = _auth_headers(data, with_refresh=True)

    devices = client.get("/api/user/devices", headers=headers).json()
    current = [d for d in devices if d["is_current"]]
    assert current, f"current device should be listed, got {devices}"

    resp = client.delete(f"/api/user/devices/{current[0]['id']}", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["was_current"] is True
    assert body["kicked_count"] >= 1

    assert _known_row(db_session, user, device_token) is None

    # 会话已被吊销:活跃会话列表里不应再有该设备
    remaining = client.get(
        "/api/user/sessions", headers=_auth_headers(data, with_refresh=True)
    ).json()
    assert all(s["id"] != current[0]["id"] for s in remaining)


def test_forget_device_requires_ownership(client, db_session, make_user):
    """只能忘记自己的设备:别人的设备返回 404。"""
    owner = make_user()
    other_token = f"devtok_{secrets.token_hex(16)}"
    foreign = known_device(db_session, owner, other_token)

    intruder = make_user()
    intruder_token = f"devtok_{secrets.token_hex(16)}"
    data = _login(client, intruder, intruder_token)

    resp = client.delete(
        f"/api/user/devices/{foreign.id}",
        headers=_auth_headers(data),
    )
    assert resp.status_code == 404, resp.text
    assert _known_row(db_session, owner, other_token) is not None


def test_session_limit_kick_keeps_known_device(db_session, make_user):
    """并发超限自动踢人只腾名额,不遗忘设备(否则每次踢人都触发验证)。"""
    from app.services.session_limit_service import SessionLimitService

    user = make_user()
    device_token = f"devtok_{secrets.token_hex(16)}"
    session = make_session(
        db_session, user,
        device_id=f"sdev_{secrets.token_hex(8)}",
        device_token=device_token,
    )
    known_device(db_session, user, device_token)

    SessionLimitService.kick_session(db_session, session, reason='session_limit')

    assert _known_row(db_session, user, device_token) is not None


def test_password_change_keeps_current_device_forgets_others(client, db_session, make_user):
    """改密:清掉其他设备的信任记忆,但保留当前设备,避免改完密码被锁在验证页。"""
    user = make_user()
    current_token = f"devtok_{secrets.token_hex(16)}"
    data = _login(client, user, current_token)
    headers = _auth_headers(data, with_refresh=True)

    other_token = f"devtok_{secrets.token_hex(16)}"
    known_device(db_session, user, other_token, device_name="other-device")

    resp = client.put(
        "/api/user/password",
        headers=headers,
        json={"current_password": "Passw0rd!", "new_password": "NewPassw0rd!"},
    )
    assert resp.status_code == 200, resp.text

    assert _known_row(db_session, user, other_token) is None
    assert _known_row(db_session, user, current_token) is not None


def test_maintenance_purges_stale_known_devices(db_session, make_user):
    """超过保留期未活跃的设备由 maintenance 清理。"""
    from app.services.maintenance_service import cleanup_expired_data

    user = make_user()
    stale_token = f"devtok_{secrets.token_hex(16)}"
    fresh_token = f"devtok_{secrets.token_hex(16)}"

    stale = known_device(db_session, user, stale_token)
    stale.last_seen = utcnow() - timedelta(days=181)
    known_device(db_session, user, fresh_token)
    db_session.commit()

    cleanup_expired_data(db_session)

    assert _known_row(db_session, user, stale_token) is None
    assert _known_row(db_session, user, fresh_token) is not None
