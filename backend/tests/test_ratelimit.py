"""速率限制测试。"""


def test_login_rate_limit(client, seed_admin):
    """登录端点 IP 限流:超过 10 次/分钟返回 429。"""
    for _ in range(10):
        client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "wrong"},
        )
    # 第 11 次应被限流
    resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "wrong"},
    )
    assert resp.status_code == 429


def test_register_rate_limit(client):
    """注册端点限流:3 次/小时后 429。"""
    for _ in range(3):
        client.post(
            "/api/auth/register",
            json={"username": f"user_{_}", "email": f"u_{_}@test.com", "password": "ValidPass123!"},
        )
    resp = client.post(
        "/api/auth/register",
        json={"username": "user_x", "email": "ux@test.com", "password": "ValidPass123!"},
    )
    assert resp.status_code == 429


def test_token_endpoint_rate_limit(client, internal_client):
    """token 端点限流:10 次/分钟后 429(即使请求体无效也消耗配额前会先被限流)。"""
    cid, secret = internal_client
    for _ in range(10):
        client.post(
            "/api/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": "invalid",
                "redirect_uri": "http://localhost:3000/callback",
                "client_id": cid,
                "client_secret": secret,
            },
        )
    resp = client.post(
        "/api/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": "invalid",
            "redirect_uri": "http://localhost:3000/callback",
            "client_id": cid,
            "client_secret": secret,
        },
    )
    assert resp.status_code == 429


def test_rate_limit_response_includes_retry_after(client):
    """429 响应应包含 Retry-After 或可识别的错误体。"""
    resp = None
    for _ in range(11):
        resp = client.post("/api/auth/login", json={"username": "x", "password": "y"})
    assert resp is not None
    assert resp.status_code == 429
    body = resp.json()
    assert "rate" in str(body).lower() or "limit" in str(body).lower()
