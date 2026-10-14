"""OAuth 回归测试(P0 前半):守护最近修复批次的 OAuth 端点行为。

守护提交:
- 8742db6(fix(oauth): OAuth 端点加固):_build_redirect_url 统一构造跳转
  URL —— state/nonce 等经 urlencode(state 含 &/# 时不再注入/截断 RP 的
  回调参数)、redirect_uri 已带 query 时用 & 拼接、None 值跳过
- 76a8317(fix(security): P0 安全旁路修复):授权码兑换绑定签发 client
  (RFC 6749 §4.1.3);单次使用改为条件 UPDATE 抢占(claimed 状态的 code
  不可再次兑换)
- public client PKCE fail-fast:authorize 阶段必须带 code_challenge;
  兑换免 client_secret 但必须带 code_verifier
- 67eb895(fix(oauth): password_grant 补访问控制):被 can_access_client
  拒绝的用户即使密码正确、client trusted,也不得经 password grant 拿到
  token(与 authorize 端点同一判定)
"""
import base64
import hashlib
import json
import secrets
from urllib.parse import parse_qs, urlparse

REDIRECT_URI = "http://localhost:3000/callback"


# ---------------------------------------------------------------------------
# _build_redirect_url 单元级守护(8742db6)
# ---------------------------------------------------------------------------

def test_build_redirect_url_encodes_state():
    from app.routes.oauth import _build_redirect_url

    url = _build_redirect_url(
        "http://rp.example/cb", {"state": "a&b=c#d", "code": "xyz"}
    )
    qs = parse_qs(urlparse(url).query)
    # 编码后 RP 端可完整还原
    assert qs["state"] == ["a&b=c#d"]
    assert qs["code"] == ["xyz"]
    # 原始串不得以明文出现在 URL(否则 & 注入额外参数、# 截断 query)
    assert "a&b=c#d" not in url
    assert "#" not in url, "未编码的 # 会把 state 之后的内容变成 fragment"


def test_build_redirect_url_existing_query_uses_amp():
    from app.routes.oauth import _build_redirect_url

    url = _build_redirect_url("http://rp.example/cb?x=1", {"state": "s"})
    # base 已带 query → 用 & 拼接,不能出现第二个 ?(会把 state 变成 fragment 前缀)
    assert url == "http://rp.example/cb?x=1&state=s"
    assert parse_qs(urlparse(url).query) == {"x": ["1"], "state": ["s"]}


def test_build_redirect_url_skips_none_and_empty():
    from app.routes.oauth import _build_redirect_url

    # None 值跳过
    url = _build_redirect_url("http://rp.example/cb", {"state": None, "code": "c"})
    assert "state" not in url
    assert parse_qs(urlparse(url).query) == {"code": ["c"]}
    # 空 params / 全 None → 原样返回,不悬挂 ? 或 &
    assert _build_redirect_url("http://rp.example/cb", {}) == "http://rp.example/cb"
    assert _build_redirect_url(
        "http://rp.example/cb", {"state": None}
    ) == "http://rp.example/cb"


# ---------------------------------------------------------------------------
# authorize 端点:state 编码 roundtrip(8742db6)
# ---------------------------------------------------------------------------

def _authorize_get_code(client, token, client_id, **extra):
    """GET authorize(带 Authorization 头 → JSON 响应)→ (redirect_url, code)。

    供 trusted client(自动批准)使用;仅需 code 时可忽略首元素。
    """
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "scope": "profile",
    }
    params.update(extra)
    resp = client.get(
        "/api/oauth/authorize",
        params=params,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    assert resp.status_code == 200, resp.text
    redirect_url = resp.json()["redirect_url"]
    assert "code=" in redirect_url, redirect_url
    return redirect_url, parse_qs(urlparse(redirect_url).query)["code"][0]


def test_authorize_state_roundtrip_via_endpoint(client, admin_token, internal_client):
    """恶意 state(含 & 和 #)经 authorize → redirect_url 必须完整还原、无注入。"""
    cid, _ = internal_client
    redirect_url = _authorize_get_code(
        client, admin_token, cid, state="a&b=c#d"
    )[0]
    # 原始串不以明文出现(未被编码就会注入/截断参数)
    assert "a&b=c#d" not in redirect_url
    assert "#" not in redirect_url
    qs = parse_qs(urlparse(redirect_url).query)
    # RP 端可完整还原
    assert qs["state"] == ["a&b=c#d"]
    # state 里的 & 不得注入出额外参数
    assert set(qs.keys()) == {"code", "state"}


# ---------------------------------------------------------------------------
# 授权码兑换:client 绑定 + claimed 抢占(76a8317)
# ---------------------------------------------------------------------------

def test_code_bound_to_issuing_client(client, admin_token, internal_client, second_client):
    """客户端 A 签发的 code 用 B 的凭据兑换 → invalid_grant;A 自己兑换 → 200。"""
    cid_a, sec_a = internal_client
    cid_b, sec_b = second_client

    _, code = _authorize_get_code(client, admin_token, cid_a)

    # B 用自己的正确凭据兑换 A 签发的 code → 拒绝(RFC 6749 §4.1.3)
    r_b = client.post("/api/oauth/token", data={
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "client_id": cid_b,
        "client_secret": sec_b,
    })
    assert r_b.status_code == 400, r_b.text
    assert r_b.json()["error"] == "invalid_grant"

    # 同一个 code 由签发它的 A 兑换 → 成功
    # (证明 B 失败的原因是 client 绑定校验,而非 code 本身无效/已被消耗)
    r_a = client.post("/api/oauth/token", data={
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "client_id": cid_a,
        "client_secret": sec_a,
    })
    assert r_a.status_code == 200, r_a.text
    assert "access_token" in r_a.json()


def test_code_claimed_guard(client, db_session, admin_token, internal_client):
    """code 被置为 claimed 后不可再兑换(验证条件 UPDATE 的 WHERE 条件抢占)。"""
    cid, sec = internal_client
    _, code = _authorize_get_code(client, admin_token, cid)

    # 模拟并发兑换中的抢占:手动把该 Token 行置为 claimed
    from app.models import Token
    from app.utils.security import hash_token

    updated = db_session.query(Token).filter(
        Token.token_hash == hash_token(code),
        Token.type == "authorization_code",
    ).update({"type": "authorization_code_claimed"})
    db_session.commit()
    assert updated == 1, "应恰好命中刚签发的 code 行"

    resp = client.post("/api/oauth/token", data={
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "client_id": cid,
        "client_secret": sec,
    })
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "invalid_grant"


# ---------------------------------------------------------------------------
# public client + PKCE(fail-fast + 免 secret 兑换)
# ---------------------------------------------------------------------------

def _pkce_pair():
    """生成 (code_verifier, S256 code_challenge)。"""
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")
    return verifier, challenge


def _approve_for_code(client, token, client_id, **extra):
    """POST authorize action=approve(非 trusted client 走同意流)→ code。"""
    form = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "scope": "profile",
        "action": "approve",
    }
    form.update(extra)
    resp = client.post(
        "/api/oauth/authorize",
        data=form,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    assert resp.status_code == 200, resp.text
    redirect_url = resp.json()["redirect_url"]
    assert "code=" in redirect_url, redirect_url
    return parse_qs(urlparse(redirect_url).query)["code"][0]


def test_public_client_pkce_full_flow(client, admin_token, public_client):
    """public client 全流程:authorize 带 challenge 免 secret → verifier 兑换 200。"""
    verifier, challenge = _pkce_pair()
    code = _approve_for_code(
        client, admin_token, public_client,
        code_challenge=challenge, code_challenge_method="S256",
    )

    # 兑换:不带 client_secret(public 免 secret),带 code_verifier
    resp = client.post("/api/oauth/token", data={
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "client_id": public_client,
        "code_verifier": verifier,
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] > 0
    assert "access_token" in body
    assert "refresh_token" in body


def test_public_client_missing_verifier_rejected(client, admin_token, public_client):
    """public client 兑换时不带 code_verifier → invalid_grant。"""
    # 只取 challenge([1]);兑换时故意不带 verifier
    challenge = _pkce_pair()[1]
    code = _approve_for_code(
        client, admin_token, public_client,
        code_challenge=challenge, code_challenge_method="S256",
    )

    resp = client.post("/api/oauth/token", data={
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "client_id": public_client,
        # 不带 code_verifier
    })
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "invalid_grant"


def test_public_client_no_challenge_rejected(client, admin_token, public_client):
    """public client authorize 不带 code_challenge → 400(fail-fast,不到兑换才失败)。"""
    # GET
    resp = client.get(
        "/api/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": public_client,
            "redirect_uri": REDIRECT_URI,
            "scope": "profile",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 400, resp.text
    assert "Public clients must use PKCE" in resp.json()["detail"]

    # POST(同意流)同样拒绝
    resp = client.post(
        "/api/oauth/authorize",
        data={
            "response_type": "code",
            "client_id": public_client,
            "redirect_uri": REDIRECT_URI,
            "scope": "profile",
            "action": "approve",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 400, resp.text
    assert "Public clients must use PKCE" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# password grant:trusted 校验 + 访问控制(67eb895)
# ---------------------------------------------------------------------------

def test_password_grant_success(client, internal_client):
    """internal(trusted)+ 正确凭据 → 200 拿到 token。"""
    cid, sec = internal_client
    resp = client.post("/api/oauth/token", data={
        "grant_type": "password",
        "username": "admin",
        "password": "admin123",
        "client_id": cid,
        "client_secret": sec,
        "scope": "profile",
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert "access_token" in body
    assert "refresh_token" in body


def test_password_grant_untrusted_client(client, second_client):
    """非 trusted client 即使凭据全部正确 → invalid_grant。"""
    cid, sec = second_client  # trusted=False
    resp = client.post("/api/oauth/token", data={
        "grant_type": "password",
        "username": "admin",
        "password": "admin123",
        "client_id": cid,
        "client_secret": sec,
        "scope": "profile",
    })
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "invalid_grant"


def test_password_grant_denied_user(client, db_session, seed_admin, make_user):
    """守护 67eb895:被 user_denied_apps 显式拒绝的用户,密码正确 + trusted
    client 的 password grant 也必须拒绝(不得绕过 can_access_client)。"""
    from app.models import Client, user_denied_apps
    from app.utils.security import hash_token

    user = make_user()  # 密码 Passw0rd!
    cid = f"testdeny_{secrets.token_hex(4)}"
    csec = secrets.token_hex(16)
    denied_client = Client(
        client_id=cid,
        client_secret_hash=hash_token(csec),
        name="Password Grant Denied Test",
        description="trusted client with an explicitly denied user",
        redirect_uris=json.dumps([REDIRECT_URI]),
        allowed_scopes=json.dumps(["profile"]),
        trusted=True,
        default_access=True,
        owner_id=seed_admin.id,
    )
    db_session.add(denied_client)
    db_session.commit()
    db_session.refresh(denied_client)

    # 直插 user_denied_apps:can_access_client 第 1 优先级即拒绝
    db_session.execute(
        user_denied_apps.insert().values(user_id=user.id, client_id=denied_client.id)
    )
    db_session.commit()

    resp = client.post("/api/oauth/token", data={
        "grant_type": "password",
        "username": user.username,
        "password": "Passw0rd!",
        "client_id": cid,
        "client_secret": csec,
        "scope": "profile",
    })
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "invalid_grant"
