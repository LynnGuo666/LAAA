"""maintenance 回归测试(守护 8742db6:定期清理过期数据)。

守护 cleanup_expired_data:
1. 只删过期的 Token(含 authorization_code/claimed/refresh)、VerificationCode、
   WebAuthnChallenge,以及 180 天保留窗口外的 LoginLog;新鲜行一律保留。
2. 幂等:第二次运行删除数为 0。

直插数据不走服务层;按自建行的存在性断言(共享 DB,不 assert 全表计数)。
"""
import secrets
from datetime import timedelta

from app.models import LoginLog, Token, VerificationCode, WebAuthnChallenge
from app.services.maintenance_service import (
    LOGIN_LOG_RETENTION_DAYS,
    cleanup_expired_data,
)
from app.utils.time import utcnow


def _make_token(db, user, client_id_internal, *, type_="refresh", expires_at):
    return Token(
        token_hash=secrets.token_hex(32),
        type=type_,
        user_id=user.id,
        client_id=client_id_internal,
        scope="profile",
        expires_at=expires_at,
    )


def test_cleanup_removes_only_expired(db_session, make_user, internal_client):
    """过期行被删,新鲜行保留——四类对象逐一验证。"""
    from app.models import Client

    user = make_user()
    _ = internal_client  # 确保初始化顺序:internal client 已存在
    client_pk = (
        db_session.query(Client).filter(Client.client_id == "internal").first().id
    )

    now = utcnow()
    past = now - timedelta(hours=1)
    future = now + timedelta(days=7)

    # Token:过期 refresh + 新鲜 refresh
    expired_token = _make_token(db_session, user, client_pk, expires_at=past)
    fresh_token = _make_token(db_session, user, client_pk, expires_at=future)

    # VerificationCode:过期 + 新鲜
    expired_code = VerificationCode(
        user_id=user.id,
        token=f"tok_{secrets.token_hex(16)}",
        purpose="magic_link_login",
        expires_at=past,
        max_attempts=1,
    )
    fresh_code = VerificationCode(
        user_id=user.id,
        token=f"tok_{secrets.token_hex(16)}",
        purpose="magic_link_login",
        expires_at=future,
        max_attempts=1,
    )

    # WebAuthnChallenge:过期 + 新鲜
    expired_challenge = WebAuthnChallenge(
        challenge=f"chal_{secrets.token_hex(16)}",
        type="registration",
        user_id=user.id,
        expires_at=past,
    )
    fresh_challenge = WebAuthnChallenge(
        challenge=f"chal_{secrets.token_hex(16)}",
        type="registration",
        user_id=user.id,
        expires_at=future,
    )

    # LoginLog:181 天前(超期)+ 新鲜
    old_log = LoginLog(
        user_id=user.id,
        username=user.username,
        success=True,
        ip_address="1.2.3.4",
        created_at=now - timedelta(days=LOGIN_LOG_RETENTION_DAYS + 1),
    )
    fresh_log = LoginLog(
        user_id=user.id,
        username=user.username,
        success=True,
        ip_address="1.2.3.4",
        created_at=now,
    )

    for obj in (expired_token, fresh_token, expired_code, fresh_code,
                expired_challenge, fresh_challenge, old_log, fresh_log):
        db_session.add(obj)
    db_session.commit()

    # cleanup 后再访问已删 ORM 实例属性会触发刷新报错,先取 PK
    expired_token_id = expired_token.id
    fresh_token_id = fresh_token.id
    expired_code_id = expired_code.id
    fresh_code_id = fresh_code.id
    expired_challenge_id = expired_challenge.id
    fresh_challenge_id = fresh_challenge.id
    old_log_id = old_log.id
    fresh_log_id = fresh_log.id

    stats = cleanup_expired_data(db_session)
    assert stats["tokens"] >= 1
    assert stats["verification_codes"] >= 1
    assert stats["webauthn_challenges"] >= 1
    assert stats["login_logs"] >= 1

    def _exists(model, pk):
        db_session.expire_all()
        return db_session.query(model).filter(model.id == pk).first() is not None

    # 过期行已删
    assert not _exists(Token, expired_token_id)
    assert not _exists(VerificationCode, expired_code_id)
    assert not _exists(WebAuthnChallenge, expired_challenge_id)
    assert not _exists(LoginLog, old_log_id)
    # 新鲜行保留
    assert _exists(Token, fresh_token_id)
    assert _exists(VerificationCode, fresh_code_id)
    assert _exists(WebAuthnChallenge, fresh_challenge_id)
    assert _exists(LoginLog, fresh_log_id)


def test_cleanup_idempotent(db_session, make_user, internal_client):
    """首次清理删掉过期行后,二次运行删除数为 0。"""
    from app.models import Client

    user = make_user()
    client_pk = (
        db_session.query(Client).filter(Client.client_id == "internal").first().id
    )

    db_session.add(_make_token(
        db_session, user, client_pk,
        expires_at=utcnow() - timedelta(minutes=5),
    ))
    db_session.add(VerificationCode(
        user_id=user.id,
        token=f"tok_{secrets.token_hex(16)}",
        purpose="email_verification",
        expires_at=utcnow() - timedelta(minutes=5),
        max_attempts=1,
    ))
    db_session.commit()

    first = cleanup_expired_data(db_session)
    assert first["tokens"] >= 1
    assert first["verification_codes"] >= 1

    second = cleanup_expired_data(db_session)
    assert second["tokens"] == 0
    assert second["verification_codes"] == 0
    assert second["webauthn_challenges"] == 0
    assert second["login_logs"] == 0
