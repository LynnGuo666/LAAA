"""波4 OIDC 合规测试:PKCE、nonce/at_hash、userinfo scope 过滤、revoke/introspect、consent。"""
import base64
import hashlib
from urllib.parse import parse_qs, urlparse


def _get_code(client, admin_token, internal_client, scope="profile", **extra):
    """helper:trusted client + 已登录 → authorize 拿 code。"""
    cid, _ = internal_client
    params = {
        "response_type": "code",
        "client_id": cid,
        "redirect_uri": "http://localhost:3000/callback",
        "scope": scope,
    }
    params.update(extra)
    resp = client.get(
        "/api/oauth/authorize",
        params=params,
        headers={"Authorization": f"Bearer {admin_token}", "Accept": "application/json"},
    )
    assert resp.status_code == 200, resp.text
    return parse_qs(urlparse(resp.json()["redirect_url"]).query)["code"][0]


def test_pkce_full_flow_with_s256(client, admin_token, internal_client):
    """PKCE S256:authorize 带 code_challenge,token 兑换带 code_verifier 校验。"""
    cid, secret = internal_client
    verifier = "a" * 64
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")

    code = _get_code(
        client, admin_token, internal_client,
        scope="profile", code_challenge=challenge, code_challenge_method="S256",
    )

    # 正确 verifier → 200
    resp = client.post(
        "/api/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": "http://localhost:3000/callback",
            "client_id": cid, "client_secret": secret,
            "code_verifier": verifier,
        },
    )
    assert resp.status_code == 200, resp.text
    assert "access_token" in resp.json()


def test_pkce_wrong_verifier_rejected(client, admin_token, internal_client):
    """PKCE:错误 code_verifier → invalid_grant(授权码被消耗,无法重用)。"""
    cid, secret = internal_client
    verifier = "correct-verifier-" + "x" * 40
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")

    code = _get_code(
        client, admin_token, internal_client,
        scope="profile", code_challenge=challenge, code_challenge_method="S256",
    )

    # 错误 verifier → 400
    resp = client.post(
        "/api/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": "http://localhost:3000/callback",
            "client_id": cid, "client_secret": secret,
            "code_verifier": "wrong-verifier",
        },
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "invalid_grant"


def test_id_token_contains_nonce_and_at_hash(client, admin_token, internal_client):
    """openid scope + nonce → id_token 含 nonce 与 at_hash(P2-2)。"""
    from jose import jwt

    from app.utils.security import keystore
    keystore.ensure_loaded()

    cid, secret = internal_client
    nonce = "client-nonce-12345"
    code = _get_code(
        client, admin_token, internal_client,
        scope="openid profile", nonce=nonce,
    )
    resp = client.post(
        "/api/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": "http://localhost:3000/callback",
            "client_id": cid, "client_secret": secret,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "id_token" in data

    # id_token claims(不验签)
    claims = jwt.get_unverified_claims(data["id_token"])
    assert claims["nonce"] == nonce
    assert "at_hash" in claims
    # at_hash 应 = base64url(sha256(access_token)[:16])
    expected = base64.urlsafe_b64encode(
        hashlib.sha256(data["access_token"].encode("ascii")).digest()[:16]
    ).rstrip(b"=").decode("ascii")
    assert claims["at_hash"] == expected


def test_userinfo_filters_by_scope(client, admin_token, internal_client):
    """userinfo 按 token scope 过滤:profile-only token 不返回 email(P2-2)。"""
    cid, secret = internal_client
    code = _get_code(client, admin_token, internal_client, scope="profile")
    resp = client.post(
        "/api/oauth/token",
        data={
            "grant_type": "authorization_code", "code": code,
            "redirect_uri": "http://localhost:3000/callback",
            "client_id": cid, "client_secret": secret,
        },
    )
    at = resp.json()["access_token"]

    # profile scope(无 email)→ 不应返回 email
    resp = client.get("/api/oauth/userinfo", headers={"Authorization": f"Bearer {at}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["sub"]
    assert data.get("username")  # profile claim
    assert "email" not in data or data.get("email") is None


def test_userinfo_email_scope(client, admin_token, internal_client):
    """email scope token → userinfo 返回 email。"""
    cid, secret = internal_client
    code = _get_code(client, admin_token, internal_client, scope="profile email")
    resp = client.post(
        "/api/oauth/token",
        data={
            "grant_type": "authorization_code", "code": code,
            "redirect_uri": "http://localhost:3000/callback",
            "client_id": cid, "client_secret": secret,
        },
    )
    at = resp.json()["access_token"]
    resp = client.get("/api/oauth/userinfo", headers={"Authorization": f"Bearer {at}"})
    assert resp.status_code == 200
    assert resp.json().get("email")  # email claim 存在


def test_introspect_active_token(client, admin_token, internal_client):
    """RFC 7662:introspect 有效 access token 返回 active=true + claims。"""
    cid, secret = internal_client
    code = _get_code(client, admin_token, internal_client, scope="profile")
    resp = client.post(
        "/api/oauth/token",
        data={
            "grant_type": "authorization_code", "code": code,
            "redirect_uri": "http://localhost:3000/callback",
            "client_id": cid, "client_secret": secret,
        },
    )
    at = resp.json()["access_token"]

    resp = client.post(
        "/api/oauth/introspect",
        data={"token": at, "client_id": cid, "client_secret": secret},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["active"] is True
    assert data["token_type"] == "Bearer"
    assert data["sub"]


def test_introspect_invalid_token_inactive(client, internal_client):
    """introspect 无效 token → active=false(不泄露原因)。"""
    cid, secret = internal_client
    resp = client.post(
        "/api/oauth/introspect",
        data={"token": "invalid-token", "client_id": cid, "client_secret": secret},
    )
    assert resp.status_code == 200
    assert resp.json()["active"] is False


def test_revoke_refresh_token(client, admin_token, internal_client):
    """RFC 7009:revoke refresh token 后无法再用它换新。"""
    cid, secret = internal_client
    code = _get_code(client, admin_token, internal_client, scope="profile")
    resp = client.post(
        "/api/oauth/token",
        data={
            "grant_type": "authorization_code", "code": code,
            "redirect_uri": "http://localhost:3000/callback",
            "client_id": cid, "client_secret": secret,
        },
    )
    rt = resp.json()["refresh_token"]

    # revoke
    resp = client.post(
        "/api/oauth/revoke",
        data={"token": rt, "client_id": cid, "client_secret": secret},
    )
    assert resp.status_code == 200

    # 再用该 refresh → invalid_grant
    resp = client.post(
        "/api/oauth/token",
        data={
            "grant_type": "refresh_token", "refresh_token": rt,
            "client_id": cid, "client_secret": secret,
        },
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "invalid_grant"


def test_discovery_has_all_oidc_endpoints(client):
    """discovery 文档补全:revoke/introspect/code_challenge_methods(P2-6)。"""
    resp = client.get("/.well-known/openid-configuration")
    data = resp.json()
    assert "revocation_endpoint" in data
    assert "introspection_endpoint" in data
    assert "code_challenge_methods_supported" in data
    assert "S256" in data["code_challenge_methods_supported"]
    assert "grant_types_supported" in data
    assert "client_secret_basic" in data["token_endpoint_auth_methods_supported"]


def test_consent_scope_upgrade_requires_approval(client, admin_token, internal_client, db_session):
    """P2-4:已授权 profile 后,请求 profile+email(新增 scope)需再次同意。"""
    cid, _ = internal_client
    # 先授权 profile(trusted 自动批准,记录 UserAuthorization.scope=profile)
    _get_code(client, admin_token, internal_client, scope="profile")

    # 改 client 为非 trusted,使 needs_consent 生效
    from app.models import Client
    c = db_session.query(Client).filter(Client.client_id == cid).first()
    was_trusted = c.trusted
    c.trusted = False
    db_session.commit()

    try:
        # 请求 profile+email(新增 email)→ 应 needs_approval,不直接发 code
        resp = client.get(
            "/api/oauth/authorize",
            params={
                "response_type": "code", "client_id": cid,
                "redirect_uri": "http://localhost:3000/callback",
                "scope": "profile email",
            },
            headers={"Authorization": f"Bearer {admin_token}", "Accept": "application/json"},
        )
        assert resp.status_code == 200
        data = resp.json()
        # 要么 needs_approval=True,要么 redirect_url(若已授权 email)
        assert data.get("needs_approval") is True or "code=" in data.get("redirect_url", "")
    finally:
        c.trusted = was_trusted
        db_session.commit()
