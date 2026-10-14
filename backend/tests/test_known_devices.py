"""known_devices 回归测试(守护 ed0f434:设备信任与 session 存活解耦)。

背景:sessions 行会因登出/过期/踢除被删除,若"已知设备"判定只查 sessions,
单设备用户每次登出后都会被风控当成新设备、强制两步验证。
修复:登录成功时 upsert known_devices(只有"忘记此设备"才删),
RiskService.is_known_device_token 优先查 known_devices,回落 sessions 兼容存量。

测试约定(conftest):共享 session 级 DB,不断言全表计数,只断言自己创建的行;
单测试内登录类请求 <10 次(IP 限流)。
"""
import secrets

from conftest import make_session

from app.models import KnownDevice
from app.services.risk_service import RiskService


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
