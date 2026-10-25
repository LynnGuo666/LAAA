"""auth 回归测试(P0 后半):tv 吊销旁路、PUT me 邮箱旁路、refresh remember_me 语义、
认证 cookie 化(A2)与 refresh 双读。

守护点:
1. get_optional_user(authorize)与 OAuthService.get_user_from_token(userinfo/introspect)
   必须校验 token_version(tv)——改密后旧 access token 不得再换 code / 拉 userinfo,
   防止 OAuth 端点成为已吊销 token 的旁路。
2. PUT /api/user/me 不接受 email 字段:UserUpdate schema 无 email,
   邮箱变更必须走 /api/auth/change-email(密码确认 + 双向验证邮件)。
3. refresh 旋转保持 remember_me 的 30 天时限(不被降级为 7 天);
   未勾选 remember_me 时为 7 天;旧 refresh token 旋转后立即失效。
4. 登录响应设置 laaa_refresh(HttpOnly; Path=/api/auth; SameSite=strict)与
   authorize_token(Path=/api/oauth; Max-Age=access TTL)cookie;
   /api/auth/refresh 支持从 cookie 读 laaa_refresh(body 为空时,双读兼容)。

注:测试库 cookie_secure=True → Set-Cookie 带 Secure 属性,TestClient(http)的
cookie jar 不会自动回传,因此所有 cookie 断言都显式解析 Set-Cookie 头或用
请求级 cookies= 参数传递。
"""
import time
from urllib.parse import parse_qs, urlparse

from jose import jwt

from app.config import get_settings
from app.schemas import UserUpdate

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _login(client, username, password="Passw0rd!", **extra):
    resp = client.post(
        "/api/auth/login",
        json={"username": username, "password": password, **extra},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _change_password(client, access_token, current="Passw0rd!", new="NewPassw0rd!2024"):
    """改密(token_version+1 并吊销全部 refresh token / session)。"""
    resp = client.put(
        "/api/user/password",
        headers={"Authorization": f"Bearer {access_token}"},
        json={"current_password": current, "new_password": new},
    )
    assert resp.status_code == 200, resp.text


def _oauth_code_flow_token(client, internal_client, bearer_token):
    """完整 code 流:authorize(trusted 自动批准)→ code → access token。

    参考 tests/test_oauth.py 的既有模式:Bearer + Accept: application/json
    → 200 JSON 带 redirect_url(内含 code)→ POST /api/oauth/token 兑换。
    """
    cid, secret = internal_client
    resp = client.get(
        "/api/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": cid,
            "redirect_uri": "http://localhost:3000/callback",
            "scope": "profile email",
        },
        headers={"Authorization": f"Bearer {bearer_token}", "Accept": "application/json"},
    )
    assert resp.status_code == 200, resp.text
    redirect_url = resp.json().get("redirect_url", "")
    assert "code=" in redirect_url, redirect_url
    code = parse_qs(urlparse(redirect_url).query)["code"][0]

    resp = client.post(
        "/api/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": "http://localhost:3000/callback",
            "client_id": cid,
            "client_secret": secret,
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _decode_refresh_exp(token):
    """解码 HS256 refresh token 的 exp(timestamp 秒)。"""
    payload = jwt.decode(token, get_settings().secret_key, algorithms=["HS256"])
    assert payload.get("type") == "refresh"
    return payload["exp"]


# ---------------------------------------------------------------------------
# 1-3: token_version(tv)吊销旁路守护
# ---------------------------------------------------------------------------

def test_authorize_rejects_revoked_token(client, make_user, internal_client):
    """改密后旧 access token 打 authorize → 302 到 /login,不得发 code。

    守护 get_optional_user 的 tv 校验。passkeys=True 使用户不处于受限模式:
    若 tv 校验失效(回归),该用户将在 authorize 直接拿到 code(200 JSON),
    测试随之失败。
    """
    user = make_user(passkeys=True)
    tokens = _login(client, user.username)
    cid, _ = internal_client

    _change_password(client, tokens["access_token"])

    resp = client.get(
        "/api/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": cid,
            "redirect_uri": "http://localhost:3000/callback",
            "scope": "profile email",
        },
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
        follow_redirects=False,
    )
    assert resp.status_code == 302, resp.text
    location = resp.headers.get("location", "")
    assert "/login" in location, location
    assert "code=" not in location, "revoked token must not be issued an authorization code"


def test_userinfo_rejects_revoked_token(client, make_user, internal_client):
    """经完整 OAuth code 流拿到的 access token,改密后打 userinfo → 401。

    守护 OAuthService.get_user_from_token 的 tv 校验(userinfo 端点)。
    """
    user = make_user(passkeys=True)
    login_token = _login(client, user.username)["access_token"]
    access_token = _oauth_code_flow_token(client, internal_client, login_token)

    # 改密前先确认 token 有效(排除"token 本来就无效"的假阳性)
    ok = client.get(
        "/api/oauth/userinfo", headers={"Authorization": f"Bearer {access_token}"}
    )
    assert ok.status_code == 200, ok.text

    _change_password(client, login_token)

    resp = client.get(
        "/api/oauth/userinfo", headers={"Authorization": f"Bearer {access_token}"}
    )
    assert resp.status_code == 401, resp.text


def test_introspect_revoked_token_inactive(client, make_user, internal_client):
    """改密后 introspect 该 access token → active=false。

    守护 OAuthService.get_user_from_token 的 tv 校验(introspect 端点)。
    改密前先断言 active=true 作对照,证明 token 本身有效。
    """
    user = make_user(passkeys=True)
    login_token = _login(client, user.username)["access_token"]
    access_token = _oauth_code_flow_token(client, internal_client, login_token)
    cid, secret = internal_client

    def _introspect():
        r = client.post(
            "/api/oauth/introspect",
            data={"token": access_token, "client_id": cid, "client_secret": secret},
        )
        assert r.status_code == 200, r.text
        return r.json()

    assert _introspect()["active"] is True

    _change_password(client, login_token)

    assert _introspect()["active"] is False


# ---------------------------------------------------------------------------
# 4: PUT /me 邮箱旁路守护
# ---------------------------------------------------------------------------

def test_put_me_email_field_ignored(client, make_user):
    """PUT /api/user/me 带 email 字段 → 200 且 email 不变。

    UserUpdate 无 email 字段(Pydantic 默认忽略额外字段),响应中的 email
    仍为当前用户的真实邮箱——无法通过该端点改邮箱。
    """
    user = make_user()
    token = _login(client, user.username)["access_token"]

    resp = client.put(
        "/api/user/me",
        headers={"Authorization": f"Bearer {token}"},
        json={"email": "evil@x.com"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["email"] == user.email


def test_userupdate_schema_has_no_email():
    """UserUpdate schema 不得重新引入 email 字段(编译期守护)。"""
    assert "email" not in UserUpdate.model_fields


# ---------------------------------------------------------------------------
# 5-7: refresh token 时限语义与旋转
# ---------------------------------------------------------------------------

def test_refresh_preserves_remember_me(client, make_user):
    """remember_me=true → 登录与旋转后的 refresh token 均 > 20 天(30 天语义)。

    守护 AuthService.refresh_access_token 的 remember 判定:原 token 剩余寿命
    超过普通时限(7 天)时按 remember_me 轮换,不得降级为 7 天。
    """
    user = make_user()
    data = _login(client, user.username, remember_me=True)
    assert _decode_refresh_exp(data["refresh_token"]) - time.time() > 20 * 86400

    resp = client.post("/api/auth/refresh", json={"refresh_token": data["refresh_token"]})
    assert resp.status_code == 200, resp.text
    assert _decode_refresh_exp(resp.json()["refresh_token"]) - time.time() > 20 * 86400


def test_refresh_short_expiry_without_remember(client, make_user):
    """remember_me=false → 登录与旋转后的 refresh token 均 < 10 天(7 天语义)。"""
    user = make_user()
    data = _login(client, user.username, remember_me=False)
    assert _decode_refresh_exp(data["refresh_token"]) - time.time() < 10 * 86400

    resp = client.post("/api/auth/refresh", json={"refresh_token": data["refresh_token"]})
    assert resp.status_code == 200, resp.text
    assert _decode_refresh_exp(resp.json()["refresh_token"]) - time.time() < 10 * 86400


def test_auth_refresh_rotates_old_invalid(client, make_user):
    """/api/auth/refresh 旋转后,旧 refresh token 再用 → 401(旋转即失效)。"""
    user = make_user()
    data = _login(client, user.username)

    r1 = client.post("/api/auth/refresh", json={"refresh_token": data["refresh_token"]})
    assert r1.status_code == 200, r1.text
    new_refresh = r1.json()["refresh_token"]
    assert new_refresh != data["refresh_token"], "refresh token should rotate"

    r2 = client.post("/api/auth/refresh", json={"refresh_token": data["refresh_token"]})
    assert r2.status_code == 401, r2.text


# ---------------------------------------------------------------------------
# 8-9: 认证 cookie 化(A2)
# ---------------------------------------------------------------------------

def test_auth_cookies_set_on_login(client, make_user):
    """登录响应设置两条认证 cookie:

    - laaa_refresh:HttpOnly + Path=/api/auth + SameSite=strict(仅 refresh/logout 可见)
    - authorize_token:Path=/api/oauth + Max-Age=900(= access token TTL 15min)
    """
    user = make_user()
    resp = client.post(
        "/api/auth/login",
        json={"username": user.username, "password": "Passw0rd!"},
    )
    assert resp.status_code == 200, resp.text

    cookies = resp.headers.get_list("set-cookie")
    refresh_cookie = next((c for c in cookies if c.startswith("laaa_refresh=")), None)
    authorize_cookie = next((c for c in cookies if c.startswith("authorize_token=")), None)
    assert refresh_cookie, f"laaa_refresh cookie missing: {cookies}"
    assert authorize_cookie, f"authorize_token cookie missing: {cookies}"

    for attr in ("HttpOnly", "Path=/api/auth", "SameSite=strict"):
        assert attr in refresh_cookie, f"{attr} missing in: {refresh_cookie}"

    for attr in ("Path=/api/oauth", "Max-Age=900"):
        assert attr in authorize_cookie, f"{attr} missing in: {authorize_cookie}"


def test_refresh_reads_cookie(client, make_user):
    """body 的 refresh_token 为空时,refresh 端点从 laaa_refresh cookie 读(双读兼容)。"""
    user = make_user()
    resp = client.post(
        "/api/auth/login",
        json={"username": user.username, "password": "Passw0rd!"},
    )
    assert resp.status_code == 200, resp.text

    # cookie_secure=True → jar 不自动回传,显式取 Set-Cookie 值用请求级参数传
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
