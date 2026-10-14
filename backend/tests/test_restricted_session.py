"""受限会话(跳过验证登录)测试。

覆盖 /api/auth/verify/skip 的受限 token 语义:
- 只签发短 TTL 受限 access token(带 restricted claim),无 refresh token;
- 不写 Token/Session/KnownDevice(受限会话不洗白设备信任度);
- 高风险(risk_level=high)登录拒绝跳过;
- 受限 token 调敏感端点(改密/TOTP/删 passkey/会话吊销)返回 403;
- 正常登录不受影响。

约定见 conftest.py 顶部:共享 DB 不隔离,唯一标识用随机后缀,
绝不 assert 全表计数,只断言自己创建的行。
"""
import secrets

import pytest

from app.config import get_settings
from app.utils.security import decode_token


@pytest.fixture(autouse=True)
def _pin_internal_client_owner(seed_admin):
    """把 internal 客户端的 owner 钉在永不删除的 admin 用户上。

    全新库里 internal.owner_id 硬编码为 1(database.py);若本文件首个
    make_user 用户恰好拿到 id=1,其 teardown 会级联删掉 internal 客户端,
    之后的登录类测试会以 "Client not found: internal" 炸掉。
    seed_admin 的 admin 用户不被任何 teardown 删除,由它占住 id=1。
    """


def _make_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# skip 签发受限 token
# ---------------------------------------------------------------------------

def test_skip_issues_restricted_token_no_refresh(client, make_user, db_session):
    """skip 返回:restricted=true、无 refresh、受限 TTL、JWT 带 restricted claim。"""
    from app.models import Token as TokenModel
    from app.models import VerificationSession

    user = make_user()  # 默认已验证邮箱;受限会话语义与账户受限状态无关
    session_token = _make_verification_session(db_session, user)

    resp = client.post("/api/auth/verify/skip", json={"session_token": session_token})
    assert resp.status_code == 200, resp.text

    data = resp.json()
    assert data["restricted"] is True
    assert data["refresh_token"] is None
    settings = get_settings()
    assert data["expires_in"] == settings.restricted_access_token_expire_minutes * 60

    # JWT 校验:type=access + restricted=true + 短 TTL(签发时刻距 exp)
    payload = decode_token(data["access_token"])
    assert payload is not None
    assert payload["type"] == "access"
    assert payload["restricted"] is True
    assert payload["sub"] == str(user.id)
    import time
    ttl_seconds = payload["exp"] - time.time()
    assert 0 < ttl_seconds <= settings.restricted_access_token_expire_minutes * 60 + 5

    # 无 refresh token 落库(该用户名下没有任何 refresh 记录是本轮 skip 产生的)
    refresh_rows = db_session.query(TokenModel).filter(
        TokenModel.user_id == user.id, TokenModel.type == "refresh"
    ).count()
    assert refresh_rows == 0

    # 验证会话已被删除
    assert db_session.query(VerificationSession).filter(
        VerificationSession.session_token == session_token
    ).first() is None


def test_skip_does_not_bless_device_or_create_session(client, make_user, db_session):
    """skip 不写 KnownDevice/Session:攻击者借 skip 洗白设备后,
    下次登录风控降级为 NONE 拿完整 token 的路径被封死。"""
    from app.models import KnownDevice
    from app.models import Session as SessionModel

    user = make_user()
    device_token = f"devtok_{secrets.token_hex(8)}"
    session_token = _make_verification_session(
        db_session, user, device_token=device_token
    )

    resp = client.post("/api/auth/verify/skip", json={"session_token": session_token})
    assert resp.status_code == 200, resp.text

    assert db_session.query(KnownDevice).filter(
        KnownDevice.user_id == user.id,
        KnownDevice.device_token == device_token,
    ).first() is None
    assert db_session.query(SessionModel).filter(
        SessionModel.user_id == user.id
    ).count() == 0


def test_skip_rejected_for_high_risk(client, make_user, db_session):
    """risk_level=high 的验证会话不允许跳过(403)。"""
    user = make_user()
    session_token = _make_verification_session(db_session, user, risk_level="high")

    resp = client.post("/api/auth/verify/skip", json={"session_token": session_token})
    assert resp.status_code == 403, resp.text
    assert "高风险" in resp.json()["detail"]


def test_skip_allowed_for_medium_risk(client, make_user, db_session):
    """medium 风险仍可跳过(只有 high 强制验证)。"""
    user = make_user()
    session_token = _make_verification_session(db_session, user, risk_level="medium")

    resp = client.post("/api/auth/verify/skip", json={"session_token": session_token})
    assert resp.status_code == 200, resp.text
    assert resp.json()["restricted"] is True


def test_normal_login_unaffected(client, make_user):
    """正常登录(无风控触发)仍发完整 token:有 refresh、无 restricted claim。"""
    resp = client.post(
        "/api/auth/login",
        json={"username": make_user().username, "password": "Passw0rd!"},
    )
    assert resp.status_code == 200, resp.text

    data = resp.json()
    assert data["refresh_token"]
    payload = decode_token(data["access_token"])
    assert payload is not None
    assert "restricted" not in payload


def _make_verification_session(db, user, *, risk_level="low", device_token=None):
    """直插验证会话(复用 conftest 的 make_verification_session)。"""
    from conftest import make_verification_session

    return make_verification_session(
        db, user, risk_level=risk_level, device_token=device_token
    )
