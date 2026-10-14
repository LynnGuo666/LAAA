"""用户会话「当前设备」识别测试(批次3 修复3)。

守护 _resolve_current_session:is_current 与 revoke-others 通过当前请求
的 refresh token(X-Refresh-Token 头)按 hash 反查所属 session,而非按
UA+IP 现算 device_id——用户切换网络后 IP 变化,现算值匹配不到任何
session,「登出其他设备」会把自己也踢掉。
"""
import secrets

from conftest import make_session

from app.utils.security import create_refresh_token, hash_token
from app.utils.time import utcnow


def _login(client, username):
    resp = client.post(
        "/api/auth/login",
        json={"username": username, "password": "Passw0rd!"},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _make_bound_session(db, user):
    """造一条与真实 refresh token 绑定的 session,返回 (session, 明文 token)。"""
    raw = create_refresh_token({"sub": str(user.id)})
    session = make_session(
        db, user,
        device_id=f"dev-{secrets.token_hex(8)}",
        refresh_token_hash=hash_token(raw),
    )
    return session, raw


def test_is_current_resolved_via_refresh_token(client, db_session, make_user, seed_admin):
    """用 session B 的 refresh token 查列表 → B 标记 is_current,A 不标记。

    seed_admin:确保 user id=1 是持久的 admin 用户(internal client 的
    owner_id=1,若首个用户被 make_user teardown 删除会级联删掉 internal)。
    """
    user = make_user()
    headers = _login(client, user.username)

    sess_a, _raw_a = _make_bound_session(db_session, user)
    sess_b, raw_b = _make_bound_session(db_session, user)

    resp = client.get(
        "/api/user/sessions",
        headers={**headers, "X-Refresh-Token": raw_b},
    )
    assert resp.status_code == 200, resp.text
    by_device = {s["device_id"]: s for s in resp.json()}

    assert by_device[sess_b.device_id]["is_current"] is True
    assert by_device[sess_a.device_id]["is_current"] is False


def test_revoke_others_spares_refresh_token_session(client, db_session, make_user, seed_admin):
    """revoke-others 后:非当前 session 被吊销,refresh token 反查出的当前 session 存活。"""
    from app.models import Session as SessionModel

    user = make_user()
    headers = _login(client, user.username)

    sess_a, _raw_a = _make_bound_session(db_session, user)
    sess_b, raw_b = _make_bound_session(db_session, user)

    resp = client.post(
        "/api/user/sessions/revoke-others",
        headers={**headers, "X-Refresh-Token": raw_b},
    )
    assert resp.status_code == 200, resp.text
    kicked_ids = {s["id"] for s in resp.json()["kicked_sessions"]}
    assert sess_a.id in kicked_ids
    assert sess_b.id not in kicked_ids

    db_session.expire_all()
    fresh_a = db_session.query(SessionModel).filter(SessionModel.id == sess_a.id).first()
    fresh_b = db_session.query(SessionModel).filter(SessionModel.id == sess_b.id).first()
    assert fresh_a.kicked_at is not None, "非当前 session 应被吊销"
    assert fresh_b.kicked_at is None, "当前 session 不应被误杀"
    assert fresh_b.expires_at > utcnow()


def test_login_history_limit_clamped(client, db_session, make_user, seed_admin):
    """login-history 的 limit 参数有上界钳制(min(limit, 200)),超大值不报错。

    防止无上界的 offset/limit 被用于一次性拉全表(DoS 面)。
    """
    user = make_user()
    headers = _login(client, user.username)

    resp = client.get(
        "/api/user/login-history",
        params={"skip": 0, "limit": 99999},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert isinstance(resp.json(), list)
