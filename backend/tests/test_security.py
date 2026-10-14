"""安全工具单元测试:JWT 签发/解码、hash_password 别名、常量时间比较、datetime helper、TOTP 重放防护。"""
from datetime import timedelta

import pytest
from conftest import seed_login_history

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


# ==================== TOTP 验证码重放防护 ====================

def _totp_code_at(secret: str, step: int) -> str:
    """生成指定时间步的 TOTP 验证码(绕开真实时钟,测试可指定步)"""
    import pyotp
    return pyotp.TOTP(secret).generate_otp(step)


def _current_totp_step() -> int:
    import time
    return int(time.time() // 30)


def test_totp_code_replay_rejected(db_session, make_user, seed_admin):
    """同一验证码连续提交两次 → 第二次被拒(重放防护核心)。

    修复前只更新 last_used_at 时间戳,同一 6 位码在 ~90 秒窗口内可
    重复使用(AiTM 钓鱼/肩窥场景)。
    """
    from app.services.totp_service import InvalidTOTPCodeError, TOTPService

    user, secret = make_user(totp=True)
    step = _current_totp_step()
    code = _totp_code_at(secret, step)

    assert TOTPService.verify_totp_code(db_session, user, code) is True
    assert user.totp.last_used_timestep is not None

    # 同一验证码立即重放 → 拒绝
    with pytest.raises(InvalidTOTPCodeError):
        TOTPService.verify_totp_code(db_session, user, code)


def test_totp_previous_window_code_blocked_after_use(db_session, make_user, seed_admin):
    """消费当前步的码后,前一步的码(valid_window=1 本可匹配)同样被拒。

    匹配到的时间步 <= 已记录时间步,一律视为已消费。
    """
    from app.services.totp_service import InvalidTOTPCodeError, TOTPService

    user, secret = make_user(totp=True)
    step = _current_totp_step()

    assert TOTPService.verify_totp_code(db_session, user, _totp_code_at(secret, step)) is True

    # 前一步的码:匹配步 step-1 <= 已记录 step → 拒绝
    with pytest.raises(InvalidTOTPCodeError):
        TOTPService.verify_totp_code(db_session, user, _totp_code_at(secret, step - 1))


def test_totp_next_window_code_accepted(db_session, make_user, seed_admin):
    """等一个窗口后新验证码仍可正常使用(防护不过度)。"""
    from app.services.totp_service import TOTPService

    user, secret = make_user(totp=True)
    step = _current_totp_step()

    assert TOTPService.verify_totp_code(db_session, user, _totp_code_at(secret, step)) is True

    # 下一步的码:无论真实时钟仍在 step(偏移 +1)还是已走到 step+1
    # (偏移 0),匹配步都是 step+1 > 已记录 step → 通过
    assert TOTPService.verify_totp_code(db_session, user, _totp_code_at(secret, step + 1)) is True


def test_totp_setup_confirm_replay_rejected(db_session, make_user, seed_admin):
    """绑定确认(verify_and_enable)同样防重放,且跨流程生效。

    绑定确认消费掉的时间步会被记录:同一验证码紧接着用于登录验证
    (verify_totp_code)也被拒绝;新窗口的码可正常登录。
    """
    from app.services.totp_service import InvalidTOTPCodeError, TOTPService

    user = make_user()
    secret, _uri, _qr = TOTPService.setup_totp(db_session, user)
    step = _current_totp_step()
    code = _totp_code_at(secret, step)

    backup_codes = TOTPService.verify_and_enable_totp(db_session, user, code)
    assert backup_codes, "绑定成功应返回备用码"
    assert user.totp.is_enabled is True

    # 同一验证码用于登录验证 → 拒绝(跨流程重放)
    with pytest.raises(InvalidTOTPCodeError):
        TOTPService.verify_totp_code(db_session, user, code)

    # 新窗口的码可正常登录
    assert TOTPService.verify_totp_code(db_session, user, _totp_code_at(secret, step + 1)) is True


def test_totp_legacy_null_timestep_accepts_first_code(db_session, make_user, seed_admin):
    """存量数据 last_used_timestep 为 NULL 视为无记录:首个验证码正常通过。"""
    from app.services.totp_service import TOTPService

    user, secret = make_user(totp=True)
    # make_user 直插的 UserTOTP 不带 last_used_timestep → NULL
    assert user.totp.last_used_timestep is None

    code = _totp_code_at(secret, _current_totp_step())
    assert TOTPService.verify_totp_code(db_session, user, code) is True


# ==================== 2FA 管理操作密码确认 ====================

def _login_token(client, username: str, password: str = "Passw0rd!") -> str:
    """登录拿 access_token(make_user 工厂用户默认密码 Passw0rd!)。"""
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _delete_json(client, url: str, headers: dict, payload: dict):
    """DELETE 带 JSON 请求体(当前 httpx 版本的 TestClient.delete 不支持 json=)。"""
    import json as _json
    return client.request(
        "DELETE", url,
        headers={**headers, "Content-Type": "application/json"},
        content=_json.dumps(payload),
    )


def test_totp_setup_endpoint_requires_password(client, db_session, make_user, seed_admin):
    """TOTP setup 必须带正确密码:无密码 422、错密码 401、正确 200。"""
    user = make_user()
    headers = {"Authorization": f"Bearer {_login_token(client, user.username)}"}

    # 缺少 current_password → 422
    resp = client.post("/api/totp/setup", headers=headers, json={})
    assert resp.status_code == 422, resp.text

    # 错误密码 → 401
    resp = client.post("/api/totp/setup", headers=headers, json={"current_password": "WrongPass123!"})
    assert resp.status_code == 401, resp.text
    assert "密码错误" in resp.json()["detail"]

    # 正确密码 → 200,返回 secret/二维码
    resp = client.post("/api/totp/setup", headers=headers, json={"current_password": "Passw0rd!"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["secret"]


def test_totp_verify_setup_endpoint_requires_password(client, db_session, make_user, seed_admin):
    """TOTP verify-setup 同样要求密码,且不影响正常绑定流程。"""
    import pyotp

    user = make_user()
    headers = {"Authorization": f"Bearer {_login_token(client, user.username)}"}

    # 先走 setup(正确密码)
    resp = client.post("/api/totp/setup", headers=headers, json={"current_password": "Passw0rd!"})
    assert resp.status_code == 200, resp.text
    secret = resp.json()["secret"]
    code = pyotp.TOTP(secret).now()

    # 无密码 → 422
    resp = client.post("/api/totp/verify-setup", headers=headers, json={"code": code})
    assert resp.status_code == 422, resp.text

    # 错密码 → 401
    resp = client.post(
        "/api/totp/verify-setup", headers=headers,
        json={"code": code, "current_password": "WrongPass123!"},
    )
    assert resp.status_code == 401, resp.text

    # 正确密码 + 有效验证码 → 200,返回备用码
    resp = client.post(
        "/api/totp/verify-setup", headers=headers,
        json={"code": code, "current_password": "Passw0rd!"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["enabled"] is True
    assert resp.json()["backup_codes"]


def test_passkey_delete_endpoint_requires_password(client, db_session, make_user, seed_admin):
    """passkey 删除必须带正确密码:无密码 422、错密码 401、正确 204。"""
    from app.models import Passkey

    user = make_user(passkeys=True)
    headers = {"Authorization": f"Bearer {_login_token(client, user.username)}"}
    passkey = db_session.query(Passkey).filter(Passkey.user_id == user.id).first()
    assert passkey is not None

    # 无密码(无请求体) → 422
    resp = client.delete(f"/api/passkeys/{passkey.id}", headers=headers)
    assert resp.status_code == 422, resp.text

    # 错误密码 → 401
    resp = _delete_json(client, f"/api/passkeys/{passkey.id}", headers, {"current_password": "WrongPass123!"})
    assert resp.status_code == 401, resp.text
    assert "密码错误" in resp.json()["detail"]

    # 正确密码 → 204,passkey 被删除
    resp = _delete_json(client, f"/api/passkeys/{passkey.id}", headers, {"current_password": "Passw0rd!"})
    assert resp.status_code == 204, resp.text
    assert db_session.query(Passkey).filter(Passkey.id == passkey.id).first() is None


def test_passkey_delete_wrong_password_keeps_passkey(client, db_session, make_user, seed_admin):
    """错密码的删除请求不会误删 passkey。"""
    from app.models import Passkey

    user = make_user(passkeys=True)
    headers = {"Authorization": f"Bearer {_login_token(client, user.username)}"}
    passkey = db_session.query(Passkey).filter(Passkey.user_id == user.id).first()

    _delete_json(client, f"/api/passkeys/{passkey.id}", headers, {"current_password": "WrongPass123!"})
    db_session.expire_all()
    assert db_session.query(Passkey).filter(Passkey.id == passkey.id).first() is not None


# ==================== WebAuthn challenge 绑定 + 端点限流 ====================

class _FakeVerification:
    """verify_authentication_response 的桩返回值(只用到计数器/UV 标志)"""
    new_sign_count = 1
    user_verified = True


def _stub_webauthn_verify(monkeypatch, captured=None):
    """把 webauthn 库的响应验签桩掉,只捕获 expected_challenge。"""
    from app.services import passkey_service as ps

    def _fake(**kwargs):
        if captured is not None:
            captured['challenge'] = kwargs['expected_challenge']
        return _FakeVerification()

    monkeypatch.setattr(ps, "verify_authentication_response", _fake)


def _passkey_credential(passkey) -> dict:
    return {
        "id": passkey.credential_id,
        "rawId": passkey.credential_id,
        "response": {},
        "type": "public-key",
    }


def test_passkey_challenge_binding_survives_options_spam(db_session, make_user, seed_admin, monkeypatch):
    """options 被攻击者刷出新 challenge 后,受害者持旧 challenge_id 仍可完成验证。

    修复前 verify 取「该用户最新一条」challenge,高频刷 options 可让受害者的
    passkey 登录持续 DoS;现在按 challenge_id 精确取对应记录。
    """
    from webauthn.helpers import base64url_to_bytes

    from app.models import Passkey
    from app.services.passkey_service import PasskeyService

    user = make_user(passkeys=True)
    passkey = db_session.query(Passkey).filter(Passkey.user_id == user.id).first()

    opts = PasskeyService.generate_authentication_options(db_session, user.username)
    assert 'challenge_id' in opts

    # 攻击者高频刷 options(生成一堆更新的 challenge)
    for _ in range(5):
        PasskeyService.generate_authentication_options(db_session, user.username)

    captured = {}
    _stub_webauthn_verify(monkeypatch, captured)

    verified_user, _p = PasskeyService.verify_authentication(
        db_session, _passkey_credential(passkey), opts['challenge_id']
    )
    assert verified_user.id == user.id
    # 消费的正是 opts 对应的那条 challenge,没有被后来刷出的顶掉
    assert captured['challenge'] == base64url_to_bytes(opts['challenge'])

    # challenge 单次消费:再用同一个 challenge_id → 拒绝
    with pytest.raises(ValueError):
        PasskeyService.verify_authentication(
            db_session, _passkey_credential(passkey), opts['challenge_id']
        )


def test_passkey_challenge_id_required_and_must_match(db_session, make_user, seed_admin, monkeypatch):
    """challenge_id 缺失/错误/过期 → 一律拒绝。"""
    from datetime import timedelta

    from app.models import Passkey, WebAuthnChallenge
    from app.services.passkey_service import PasskeyService
    from app.utils.time import utcnow

    user = make_user(passkeys=True)
    passkey = db_session.query(Passkey).filter(Passkey.user_id == user.id).first()

    _stub_webauthn_verify(monkeypatch)

    # 缺失 → 拒绝(不给「取最新」的兜底,否则 DoS 窗口重新打开)
    with pytest.raises(ValueError):
        PasskeyService.verify_authentication(db_session, _passkey_credential(passkey))

    # 不存在的 id → 拒绝
    with pytest.raises(ValueError):
        PasskeyService.verify_authentication(db_session, _passkey_credential(passkey), 99999999)

    # 过期 → 拒绝
    opts = PasskeyService.generate_authentication_options(db_session, user.username)
    record = db_session.query(WebAuthnChallenge).filter(
        WebAuthnChallenge.id == opts['challenge_id']
    ).first()
    record.expires_at = utcnow() - timedelta(seconds=1)
    db_session.commit()
    with pytest.raises(ValueError):
        PasskeyService.verify_authentication(
            db_session, _passkey_credential(passkey), opts['challenge_id']
        )

    # 与用户不匹配(别人的 challenge_id)→ 拒绝
    other = make_user(passkeys=True)
    other_opts = PasskeyService.generate_authentication_options(db_session, other.username)
    with pytest.raises(ValueError):
        PasskeyService.verify_authentication(
            db_session, _passkey_credential(passkey), other_opts['challenge_id']
        )


def test_passkey_discoverable_flow_challenge_works(db_session, make_user, seed_admin, monkeypatch):
    """discoverable(不带 username)流程:challenge 不绑用户,verify 后从 credential 反查。

    修复前的死代码 bug:按 user_id IS NULL 匹配的分支永远不命中
    (Passkey.user_id 非空外键),无用户名的 passwordless 流程实际报
    "Challenge expired"。
    """
    from app.models import Passkey
    from app.services.passkey_service import PasskeyService

    user = make_user(passkeys=True)
    passkey = db_session.query(Passkey).filter(Passkey.user_id == user.id).first()

    # discoverable:不传 username → challenge user_id 为 NULL
    opts = PasskeyService.generate_authentication_options(db_session, None)
    assert 'challenge_id' in opts

    _stub_webauthn_verify(monkeypatch)

    verified_user, _p = PasskeyService.verify_authentication(
        db_session, _passkey_credential(passkey), opts['challenge_id']
    )
    assert verified_user.id == user.id


def test_passkey_check_endpoint_uniform_response(client, db_session, make_user, seed_admin):
    """check 端点:用户不存在与「存在但无 passkey」响应完全一致(消除用户名枚举)。"""
    user_without_passkeys = make_user()

    resp_existing = client.get(f"/api/passkeys/check/{user_without_passkeys.username}")
    resp_missing = client.get("/api/passkeys/check/no_such_user_abcxyz")

    assert resp_existing.status_code == 200
    assert resp_missing.status_code == 200
    assert resp_existing.json() == resp_missing.json()
    assert resp_existing.json() == {"has_passkeys": False, "count": 0}


def test_passkey_options_rate_limit(client):
    """authenticate/options 端点限流:10 次/分钟后 429。"""
    for _ in range(10):
        resp = client.post("/api/passkeys/authenticate/options", json={})
        assert resp.status_code == 200, resp.text
    resp = client.post("/api/passkeys/authenticate/options", json={})
    assert resp.status_code == 429


def test_passkey_check_rate_limit(client):
    """check/{username} 端点限流:10 次/分钟后 429。"""
    for _ in range(10):
        resp = client.get("/api/passkeys/check/whoever")
        assert resp.status_code == 200, resp.text
    resp = client.get("/api/passkeys/check/whoever")
    assert resp.status_code == 429


def test_passkey_authentication_options_require_uv(db_session, make_user, seed_admin):
    """认证 options 要求 userVerification=REQUIRED(注册保持 PREFERRED)。"""
    from app.services.passkey_service import PasskeyService

    user = make_user(passkeys=True)
    user_no_passkey = make_user()

    auth_opts = PasskeyService.generate_authentication_options(db_session, user.username)
    assert auth_opts["userVerification"] == "required"

    # 注册 options:无 passkey 的用户(非管理员限 1 个,故用独立用户);
    # 注册的 UV 位于 authenticatorSelection 下,保持 PREFERRED(兼容性)
    reg_opts = PasskeyService.generate_registration_options(db_session, user_no_passkey)
    assert reg_opts["authenticatorSelection"]["userVerification"] == "preferred"


def test_passkey_authentication_rejects_missing_uv_flag(db_session, make_user, seed_admin, monkeypatch):
    """验证结果缺 UV 标志 → 拒绝:passkey 因子必须证明所有者在场,不只是设备在场。"""
    from app.models import Passkey
    from app.services import passkey_service as ps
    from app.services.passkey_service import PasskeyService

    user = make_user(passkeys=True)
    passkey = db_session.query(Passkey).filter(Passkey.user_id == user.id).first()

    opts = PasskeyService.generate_authentication_options(db_session, user.username)

    class _NoUVVerification:
        new_sign_count = 1
        user_verified = False

    monkeypatch.setattr(ps, "verify_authentication_response", lambda **kw: _NoUVVerification())

    with pytest.raises(ValueError):
        PasskeyService.verify_authentication(
            db_session, _passkey_credential(passkey), opts['challenge_id']
        )


# ==================== 打包修复:备用码熵 / velocity 统计 / GeoIP 私有段 ====================

def test_backup_codes_10_chars_40bit_entropy():
    """新生成的备用码为 10 字符(40-bit);存量 8 字符码哈希校验不受影响。"""
    from app.services.totp_service import TOTPService

    codes = TOTPService.generate_backup_codes()
    assert len(codes) == 10
    assert all(len(c) == 10 for c in codes), "新备用码应为 10 字符(40-bit 熵)"
    assert len(set(codes)) == 10
    # 8 字符存量码仍可通过哈希比较(校验逻辑与长度无关)
    legacy = "A1B2C3D4"
    assert TOTPService.hash_backup_code(legacy) == TOTPService.hash_backup_code(legacy.lower())


def test_velocity_ignores_failed_logins(db_session, make_user, seed_admin):
    """velocity 只统计成功登录:攻击者故意失败不能把受害者下次登录顶成 high_velocity。"""
    from app.config import get_settings
    from app.services.login_anomaly_service import LoginAnomalyService

    settings = get_settings()
    user = make_user()

    # 灌满阈值数量的失败记录(N >= suspicious_login_velocity_count)
    for _ in range(settings.suspicious_login_velocity_count + 2):
        seed_login_history(db_session, user, ip="9.9.9.9", success=False)
    assert LoginAnomalyService._check_login_velocity(db_session, user) is None

    # 1 次成功登录:成功计数远低于阈值 → 仍无异常
    seed_login_history(db_session, user, ip="9.9.9.9", success=True)
    assert LoginAnomalyService._check_login_velocity(db_session, user) is None


def test_velocity_counts_successful_logins(db_session, make_user, seed_admin):
    """成功登录达到阈值 → 正常触发 high_velocity(防护不过度)。"""
    from app.config import get_settings
    from app.services.login_anomaly_service import LoginAnomalyService

    settings = get_settings()
    user = make_user()

    for _ in range(settings.suspicious_login_velocity_count):
        seed_login_history(db_session, user, ip="9.9.9.9", success=True)

    anomaly = LoginAnomalyService._check_login_velocity(db_session, user)
    assert anomaly is not None
    assert anomaly["type"] == "high_velocity"


def test_geoip_private_ip_precise_172_range():
    """172.16-31 才是私有段;172.32+ 是公网,不得再被 startswith('172.') 误杀。"""
    from app.services.geoip_service import _is_private_ip

    # 私有段
    assert _is_private_ip("172.16.0.1")
    assert _is_private_ip("172.31.255.255")
    assert _is_private_ip("10.1.2.3")
    assert _is_private_ip("192.168.1.1")
    assert _is_private_ip("127.0.0.1")
    assert _is_private_ip("::1")
    assert _is_private_ip("localhost")

    # 公网段(此前 172/8 全被误杀)
    assert not _is_private_ip("172.32.0.1")
    assert not _is_private_ip("172.160.0.1")
    assert not _is_private_ip("172.15.0.1")
    assert not _is_private_ip("8.8.8.8")
    assert not _is_private_ip("1.2.3.4")


# ---------------------------------------------------------------------------
# website_url 协议校验(批次 8 修复 9)
# ---------------------------------------------------------------------------

class TestWebsiteUrlValidation:
    """ClientCreate/ClientUpdate 的 website_url 只允许 http/https。

    该字段会渲染为 consent 页链接/前端 window.open 入口,
    javascript:/data: 协议等于存储型 XSS。
    """

    def test_create_accepts_http_and_https(self):
        from app.schemas import ClientCreate

        base = {
            "name": "x",
            "redirect_uris": ["https://rp.example.com/cb"],
            "allowed_scopes": ["profile"],
        }
        assert ClientCreate(**base, website_url="https://example.com").website_url == "https://example.com"
        assert ClientCreate(**base, website_url="http://example.com").website_url == "http://example.com"

    def test_create_rejects_dangerous_schemes(self):
        from pydantic import ValidationError

        from app.schemas import ClientCreate

        base = {
            "name": "x",
            "redirect_uris": ["https://rp.example.com/cb"],
            "allowed_scopes": ["profile"],
        }
        for evil in (
            "javascript:alert(1)",
            "data:text/html;base64,PHNjcmlwdD4=",
            "vbscript:msgbox",
            "file:///etc/passwd",
        ):
            with pytest.raises(ValidationError, match="website_url"):
                ClientCreate(**base, website_url=evil)

    def test_update_rejects_dangerous_scheme_and_allows_clearing(self):
        from pydantic import ValidationError

        from app.schemas import ClientUpdate

        with pytest.raises(ValidationError, match="website_url"):
            ClientUpdate(website_url="javascript:alert(1)")
        # 显式清空/置 None 不受影响
        assert ClientUpdate(website_url=None).website_url is None
        assert ClientUpdate(website_url="").website_url == ""
