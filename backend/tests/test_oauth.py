"""OAuth 2.0 核心路径测试:authorize → code → token → userinfo,refresh 旋转,scope/redirect_uri 校验。"""
import base64
from urllib.parse import parse_qs, urlparse


def _auth_header(client_id, client_secret):
    raw = f"{client_id}:{client_secret}".encode()
    return {"Authorization": f"Basic {base64.b64encode(raw).decode()}"}


def test_authorize_requires_authentication(client, internal_client):
    """未登录访问 authorize 应重定向到登录页,不能直接给出 code。"""
    cid, _ = internal_client
    resp = client.get(
        "/api/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": cid,
            "redirect_uri": "http://localhost:3000/callback",
            "scope": "profile",
        },
        follow_redirects=False,
    )
    # 未带 token → 302 重定向到 /login(绝不直接发 code)
    assert resp.status_code == 302
    location = resp.headers.get("location", "")
    assert "code=" not in location, "must not issue code without auth"
    assert "/login" in location


def test_full_authorization_code_flow(client, admin_token, internal_client):
    """trusted client + 已登录 → GET authorize 直接返回 code → 换 token → userinfo。"""
    cid, secret = internal_client
    headers = {"Authorization": f"Bearer {admin_token}", "Accept": "application/json"}

    # 1. authorize(trusted 自动批准)
    resp = client.get(
        "/api/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": cid,
            "redirect_uri": "http://localhost:3000/callback",
            "scope": "profile email openid",
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    redirect_url = resp.json().get("redirect_url", "")
    assert "code=" in redirect_url, redirect_url
    code = parse_qs(urlparse(redirect_url).query)["code"][0]

    # 2. exchange code → token
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
    token_data = resp.json()
    assert token_data["token_type"] == "bearer"
    assert token_data["expires_in"] > 0
    assert "access_token" in token_data
    # openid scope → 应有 id_token
    assert "id_token" in token_data, "openid scope should yield id_token"

    access_token = token_data["access_token"]

    # 3. userinfo
    resp = client.get(
        "/api/oauth/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert resp.status_code == 200, resp.text
    info = resp.json()
    assert info["sub"]  # user id as string
    assert info["username"] == "admin"


def test_authorization_code_single_use(client, admin_token, internal_client):
    """授权码单次使用:第二次兑换应失败。"""
    cid, secret = internal_client
    headers = {"Authorization": f"Bearer {admin_token}", "Accept": "application/json"}

    resp = client.get(
        "/api/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": cid,
            "redirect_uri": "http://localhost:3000/callback",
            "scope": "profile",
        },
        headers=headers,
    )
    code = parse_qs(urlparse(resp.json()["redirect_url"]).query)["code"][0]

    # 第一次成功
    r1 = client.post(
        "/api/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": "http://localhost:3000/callback",
            "client_id": cid,
            "client_secret": secret,
        },
    )
    assert r1.status_code == 200

    # 第二次应失败(invalid_grant)
    r2 = client.post(
        "/api/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": "http://localhost:3000/callback",
            "client_id": cid,
            "client_secret": secret,
        },
    )
    assert r2.status_code == 400
    assert r2.json()["error"] == "invalid_grant"


def test_refresh_token_rotation(client, admin_token, internal_client):
    """refresh token 旋转:旧 refresh 兑换后应失效。"""
    cid, secret = internal_client
    headers = {"Authorization": f"Bearer {admin_token}", "Accept": "application/json"}

    # 拿到第一组 token
    resp = client.get(
        "/api/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": cid,
            "redirect_uri": "http://localhost:3000/callback",
            "scope": "profile",
        },
        headers=headers,
    )
    code = parse_qs(urlparse(resp.json()["redirect_url"]).query)["code"][0]

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
    old_refresh = resp.json()["refresh_token"]

    # 用旧 refresh 换新
    resp = client.post(
        "/api/oauth/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": old_refresh,
            "client_id": cid,
            "client_secret": secret,
        },
    )
    assert resp.status_code == 200, resp.text
    new_refresh = resp.json()["refresh_token"]
    assert new_refresh != old_refresh, "refresh token should rotate"

    # 旧 refresh 应失效
    resp = client.post(
        "/api/oauth/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": old_refresh,
            "client_id": cid,
            "client_secret": secret,
        },
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "invalid_grant"


def test_invalid_redirect_uri_rejected(client, admin_token, internal_client):
    """redirect_uri 不在白名单应被拒。"""
    cid, _ = internal_client
    headers = {"Authorization": f"Bearer {admin_token}", "Accept": "application/json"}

    resp = client.get(
        "/api/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": cid,
            "redirect_uri": "http://evil.example/callback",  # 不在白名单
            "scope": "profile",
        },
        headers=headers,
    )
    assert resp.status_code == 400
    assert "redirect_uri" in resp.json()["detail"].lower()


def test_invalid_scope_rejected(client, admin_token, internal_client):
    """请求超出 client 允许的 scope 应被拒。"""
    cid, _ = internal_client
    headers = {"Authorization": f"Bearer {admin_token}", "Accept": "application/json"}

    resp = client.get(
        "/api/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": cid,
            "redirect_uri": "http://localhost:3000/callback",
            "scope": "profile admin",  # admin 不在 allowed_scopes
        },
        headers=headers,
    )
    assert resp.status_code == 400


def test_token_endpoint_basic_auth(client, admin_token, internal_client):
    """token 端点支持 HTTP Basic 客户端认证。"""
    cid, secret = internal_client
    headers = {"Authorization": f"Bearer {admin_token}", "Accept": "application/json"}

    resp = client.get(
        "/api/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": cid,
            "redirect_uri": "http://localhost:3000/callback",
            "scope": "profile",
        },
        headers=headers,
    )
    code = parse_qs(urlparse(resp.json()["redirect_url"]).query)["code"][0]

    # 用 Basic auth 而非 body 里的 client_secret
    resp = client.post(
        "/api/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": "http://localhost:3000/callback",
        },
        headers=_auth_header(cid, secret),
    )
    assert resp.status_code == 200, resp.text
    assert "access_token" in resp.json()


def test_token_wrong_client_secret(client, admin_token, internal_client):
    """错误 client_secret 应返回 invalid_client。"""
    cid, _ = internal_client
    headers = {"Authorization": f"Bearer {admin_token}", "Accept": "application/json"}

    resp = client.get(
        "/api/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": cid,
            "redirect_uri": "http://localhost:3000/callback",
            "scope": "profile",
        },
        headers=headers,
    )
    code = parse_qs(urlparse(resp.json()["redirect_url"]).query)["code"][0]

    resp = client.post(
        "/api/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": "http://localhost:3000/callback",
            "client_id": cid,
            "client_secret": "wrong-secret",
        },
    )
    assert resp.status_code == 401
    assert resp.json()["error"] == "invalid_client"
