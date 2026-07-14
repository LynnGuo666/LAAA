"""认证相关测试:登录、密码策略、JWT、SECRET_KEY 校验、JWKS 止血。"""
import pytest
from pydantic import ValidationError


def test_login_success(client, seed_admin):
    """正确凭据登录返回 access_token。"""
    resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


def test_login_wrong_password(client, seed_admin):
    """错误密码返回 401,且不泄露具体原因。"""
    resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "wrong-password"},
    )
    assert resp.status_code == 401
    assert "username or password" in resp.json()["detail"].lower()


def test_login_nonexistent_user(client, seed_admin):
    """不存在用户返回 401(且响应时间应与错误密码接近——dummy bcrypt)。"""
    resp = client.post(
        "/api/auth/login",
        json={"username": "no-such-user", "password": "whatever"},
    )
    assert resp.status_code == 401


def test_me_endpoint(client, admin_token):
    """/api/auth/me 返回当前用户信息。"""
    resp = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "admin"
    assert data["is_admin"] is True


def test_me_rejects_invalid_token(client):
    """无效 token 访问 /me 返回 401。"""
    resp = client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer not-a-real-token"},
    )
    assert resp.status_code == 401


def test_password_strength_too_short():
    """注册密码 <12 字符被拒。"""
    from app.schemas import UserCreate
    with pytest.raises(ValidationError):
        UserCreate(username="newuser", email="a@b.com", password="short12")


def test_password_strength_no_complexity():
    """密码只含小写+数字(2 类)被拒。"""
    from app.schemas import UserCreate
    with pytest.raises(ValidationError):
        UserCreate(username="newuser", email="a@b.com", password="alllowercase1234")


def test_password_strength_valid():
    """合规密码(3 类,≥12 字符)通过。"""
    from app.schemas import UserCreate
    u = UserCreate(username="newuser", email="a@b.com", password="ValidPass123!")
    assert u.password == "ValidPass123!"


def test_change_password_policy_enforced(client, admin_token, seed_admin):
    """改密同样执行强度策略:弱密码 422,不是 500。"""
    resp = client.put(
        "/api/user/password",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"current_password": "admin123", "new_password": "weak"},
    )
    assert resp.status_code == 422, resp.text


def test_change_password_complexity(client, admin_token, seed_admin):
    """改密复杂度不足(只 2 类)返回 422,不是 500。"""
    resp = client.put(
        "/api/user/password",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"current_password": "admin123", "new_password": "alllowercase1234"},
    )
    assert resp.status_code == 422


def test_secret_key_validator_rejects_short():
    """SECRET_KEY <32 字符启动失败。"""
    from app.config import Settings
    with pytest.raises(ValidationError):
        Settings(secret_key="short")


def test_secret_key_validator_rejects_placeholder():
    """占位密钥被拒。"""
    from app.config import Settings
    with pytest.raises(ValidationError):
        Settings(secret_key="your-secret-key-change-this-in-production")


def test_secret_key_validator_accepts_strong():
    """强密钥通过。"""
    from app.config import Settings
    s = Settings(secret_key="a" * 48)
    assert len(s.secret_key) == 48


def test_jwks_endpoint_returns_rsa_keys(client):
    """JWKS 返回 RSA 公钥(RS256),不泄露对称密钥(P0-2)。
    RS256 迁移后 keys 非空,但只含公钥(n/e),无 'k'(对称密钥)。"""
    resp = client.get("/.well-known/jwks.json")
    assert resp.status_code == 200
    data = resp.json()
    assert "keys" in data
    assert len(data["keys"]) >= 1, "JWKS should expose at least one RSA public key"
    key = data["keys"][0]
    assert key["kty"] == "RSA"
    assert key["alg"] == "RS256"
    assert key["use"] == "sig"
    assert "kid" in key
    assert "n" in key and "e" in key  # 公钥参数


def test_jwks_response_has_no_secret_material(client):
    """JWKS 响应体不含 'k' 字段(对称密钥泄露指标)——RS256 核心保证。"""
    resp = client.get("/.well-known/jwks.json")
    body = resp.text
    assert '"k"' not in body, "JWKS must not expose symmetric key material"
    assert "oct" not in body, "JWKS must not contain oct (symmetric) keys"


def test_openid_configuration_still_works(client):
    """discovery 文档正常返回(止血不影响)。"""
    resp = client.get("/.well-known/openid-configuration")
    assert resp.status_code == 200
    data = resp.json()
    assert data["issuer"]
    assert data["authorization_endpoint"].endswith("/api/oauth/authorize")
    assert data["token_endpoint"].endswith("/api/oauth/token")
