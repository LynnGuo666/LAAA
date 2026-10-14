"""passkey 登录 cookie 契约测试。

守护点：/api/passkeys/authenticate/verify 成功（200）时必须像密码登录
（auth.py /login）一样 Set-Cookie：
- laaa_refresh：HttpOnly + Path=/api/auth + SameSite=strict
- authorize_token：Path=/api/oauth + Max-Age=900

修复前该端点只返回 TokenResponse 不设 cookie → 用户按 F5 即被登出。

注：
- 测试库 cookie_secure=True → Set-Cookie 带 Secure 属性，TestClient(http)
  的 cookie jar 不会自动回传，因此断言显式解析 Set-Cookie 头、用请求级
  cookies= 参数传递（与 test_auth_regression.py 的做法一致）。
- WebAuthn 完整仪式（软件 ECDSA 签名）超出本测试关注点——此处守护的是
  路由层的 cookie 行为，verify_authentication 用 monkeypatch 桩掉。
"""
import pytest


@pytest.fixture
def stubbed_passkey_user(make_user, monkeypatch, seed_admin):
    """造一个带 passkey 的用户，并把路由里的 WebAuthn 验证桩成查库返回。

    桩函数在路由自己的 db session 里重新查询，避免跨 session 的
    detached 对象问题。

    seed_admin：全新库里 internal 客户端的 owner_id 硬编码为 1，需要
    admin 用户占住 id=1，否则本文件首个 make_user 用户拿到 id=1 时
    teardown 会级联删掉 internal 客户端（同 test_restricted_session.py
    的 _pin_internal_client_owner 说明）。
    """
    from app.models import Passkey, User
    from app.routes import passkey as passkey_route

    user = make_user(passkeys=True)

    def _fake_verify(db, credential_data):
        u = db.query(User).filter(User.id == user.id).first()
        p = db.query(Passkey).filter(Passkey.user_id == user.id).first()
        assert u is not None and p is not None, "stub: user/passkey must exist"
        return u, p

    monkeypatch.setattr(passkey_route.PasskeyService, "verify_authentication", _fake_verify)
    return user


def _verify_payload(credential_id: str) -> dict:
    return {
        "id": credential_id,
        "rawId": credential_id,
        "response": {
            "clientDataJSON": "",
            "authenticatorData": "",
            "signature": "",
            "userHandle": None,
        },
        "type": "public-key",
    }


def test_passkey_login_sets_auth_cookies(client, stubbed_passkey_user, db_session):
    """passkey 登录 200 响应设置 laaa_refresh / authorize_token，属性与密码登录一致。"""
    from app.models import Passkey

    passkey = db_session.query(Passkey).filter(
        Passkey.user_id == stubbed_passkey_user.id
    ).first()

    resp = client.post("/api/passkeys/authenticate/verify", json=_verify_payload(passkey.credential_id))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["access_token"] and body["refresh_token"]

    cookies = resp.headers.get_list("set-cookie")
    refresh_cookie = next((c for c in cookies if c.startswith("laaa_refresh=")), None)
    authorize_cookie = next((c for c in cookies if c.startswith("authorize_token=")), None)
    assert refresh_cookie, f"laaa_refresh cookie missing: {cookies}"
    assert authorize_cookie, f"authorize_token cookie missing: {cookies}"

    for attr in ("HttpOnly", "Path=/api/auth", "SameSite=strict"):
        assert attr in refresh_cookie, f"{attr} missing in: {refresh_cookie}"
    for attr in ("Path=/api/oauth", "Max-Age=900"):
        assert attr in authorize_cookie, f"{attr} missing in: {authorize_cookie}"


def test_passkey_cookie_survives_refresh(client, stubbed_passkey_user, db_session):
    """端到端：passkey 登录下发的 laaa_refresh cookie 可直接走 /api/auth/refresh。

    这是「按 F5 不被登出」的实际依赖路径：页面刷新后内存 token 丢失，
    bootstrap 用 cookie 静默换新 token。
    """
    from app.models import Passkey

    passkey = db_session.query(Passkey).filter(
        Passkey.user_id == stubbed_passkey_user.id
    ).first()

    resp = client.post("/api/passkeys/authenticate/verify", json=_verify_payload(passkey.credential_id))
    assert resp.status_code == 200, resp.text

    cookie_header = next(
        c for c in resp.headers.get_list("set-cookie") if c.startswith("laaa_refresh=")
    )
    refresh_value = cookie_header.split(";", 1)[0].split("=", 1)[1]

    r = client.post(
        "/api/auth/refresh",
        json={"refresh_token": ""},
        cookies={"laaa_refresh": refresh_value},
    )
    assert r.status_code == 200, r.text
    assert "access_token" in r.json()
