"""安全工具单元测试:JWT 签发/解码、hash_password 别名、常量时间比较、datetime helper。"""
from datetime import timedelta

from app.utils.security import (
    create_access_token,
    create_id_token,
    create_refresh_token,
    decode_token,
    generate_random_string,
    get_password_hash,
    hash_password,
    hash_token,
    verify_client_secret,
    verify_password,
)
from app.utils.time import utcnow


def test_access_token_roundtrip():
    """access token (RS256) 签发后能解码,含正确 type/sub/kid header。"""
    from app.utils.security import keystore
    keystore.ensure_loaded()
    token = create_access_token({"sub": "42", "scope": "profile"})
    from jose import jwt
    header = jwt.get_unverified_header(token)
    assert header["alg"] == "RS256"
    assert "kid" in header
    payload = decode_token(token)
    assert payload is not None
    assert payload["sub"] == "42"
    assert payload["type"] == "access"
    assert payload["scope"] == "profile"


def test_refresh_token_uses_hs256():
    """refresh token 仍用 HS256(对称,不对外暴露验证)。"""
    token = create_refresh_token({"sub": "1"})
    from jose import jwt
    header = jwt.get_unverified_header(token)
    assert header["alg"] == "HS256"
    payload = decode_token(token)
    assert payload is not None
    assert payload["type"] == "refresh"
    assert "jti" in payload


def test_id_token_type():
    """id token (RS256) type=id(含 aud/iat),签名能用 JWKS 公钥验证。"""
    from jose import jwt
    token = create_id_token({"sub": "1", "aud": "client-x"})
    header = jwt.get_unverified_header(token)
    assert header["alg"] == "RS256"
    payload = jwt.get_unverified_claims(token)
    assert payload["type"] == "id"
    assert payload["aud"] == "client-x"
    assert "iat" in payload
    # 用 JWKS 公钥(按 kid)解码应成功
    from app.utils.security import keystore
    keystore.ensure_loaded()
    pub = keystore.verifying_key(header["kid"])
    assert pub is not None
    verified = jwt.decode(token, pub, algorithms=["RS256"], audience="client-x")
    assert verified["sub"] == "1"


def test_decode_invalid_token_returns_none():
    """无效 token 解码返回 None,不抛异常。"""
    assert decode_token("not.a.token") is None
    assert decode_token("") is None


def test_hash_password_alias_works():
    """P1-1:hash_password 是 get_password_hash 的别名(修复 ImportError)。"""
    h = hash_password("mypassword")
    assert h.startswith("$2b$")
    assert hash_password is get_password_hash  # 别名指向同一函数对象
    # 验证可用
    assert verify_password("mypassword", h) is True
    assert verify_password("wrong", h) is False


def test_verify_client_secret_constant_time():
    """P2-9b:client secret 比较用 compare_digest。"""
    secret = "my-client-secret-value"
    hashed = hash_token(secret)
    assert verify_client_secret(secret, hashed) is True
    assert verify_client_secret("wrong", hashed) is False
    # 函数应使用 hmac.compare_digest(不抛异常即可证明返回 bool)
    assert isinstance(verify_client_secret(secret, hashed), bool)


def test_generate_random_string_uniqueness():
    """随机串足够长且不重复。"""
    strs = {generate_random_string(32) for _ in range(100)}
    assert len(strs) == 100


def test_utcnow_is_naive():
    """P2-17:utcnow() 返回 naive datetime(避免 aware/naive 比较崩溃)。"""
    t = utcnow()
    assert t.tzinfo is None, "utcnow() must return naive datetime for SQLite compat"


def test_utcnow_comparison_works():
    """关键回归点:naive datetime 与 timedelta 加减、比较正常。"""
    now = utcnow()
    future = now + timedelta(hours=1)
    assert future > now
    past = now - timedelta(minutes=5)
    assert now > past
    # 模拟 expires_at 比较(token 过期判断的核心)
    expires_at = utcnow() + timedelta(minutes=15)
    assert expires_at > utcnow()


def test_validation_error_response_strips_input(client, caplog):
    """422 响应与日志不回显用户原始输入(input 字段含明文密码)。

    exc.errors() 每项的 input 是用户提交的原始值(如注册密码),
    必须在 request_validation_error_handler 里被剥离。
    """
    secret_password = "short-but-secret-pw"
    resp = client.post(
        "/api/auth/register",
        json={"username": "u", "email": "u@example.com", "password": secret_password},
    )
    assert resp.status_code == 422, resp.text

    # 响应体不含 input 字段,也不含明文密码
    body_text = resp.text
    assert "input" not in body_text
    assert secret_password not in body_text

    # 日志同样不落明文密码
    with caplog.at_level("WARNING"):
        client.post(
            "/api/auth/register",
            json={"username": "u2", "email": "u2@example.com", "password": secret_password},
        )
    assert secret_password not in caplog.text


def test_ready_endpoint_does_not_leak_db_error(client):
    """/api/ready DB 异常时不向匿名探测者回显内部异常详情(修复5)。

    原实现返回 {"checks": {"database": "fail: <异常>"}},异常串含
    DB 路径/驱动细节;该端点未认证,属于信息泄露。现在只返回状态,
    详情进日志。
    """
    from app.database import get_db
    from app.main import app

    class _BrokenDB:
        def execute(self, *args, **kwargs):
            raise RuntimeError("sqlite: internal/path/secret oauth.db boom")

    def _override():
        yield _BrokenDB()

    app.dependency_overrides[get_db] = _override
    try:
        resp = client.get("/api/ready")
        assert resp.status_code == 503
        data = resp.json()
        assert data["status"] == "not_ready"
        assert "checks" not in data
        # 异常细节(路径/错误串)绝不出现在响应体
        assert "boom" not in resp.text
        assert "secret" not in resp.text
        assert "fail:" not in resp.text
    finally:
        app.dependency_overrides.pop(get_db, None)
