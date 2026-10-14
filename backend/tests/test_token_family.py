"""refresh token 家族吊销与轮换原子性测试。

守护 AuthService.refresh_access_token 的两个不变量:
1. 顺序重放旧 token → 家族吊销(旧 token 再现 = 疑似被盗,灭族);
2. 轮换用条件 UPDATE 原子抢占 revoked_at——并发竞争只有一个赢家,
   输家按重放处理走家族吊销,封死「家族分叉成两条活跃链」的竞态绕过。

约定见 conftest.py 顶部:共享 DB 不隔离,唯一标识用随机后缀,
绝不 assert 全表计数,只断言自己创建的行。
"""
import pytest


@pytest.fixture(autouse=True)
def _pin_internal_client_owner(seed_admin):
    """把 internal 客户端的 owner 钉在永不删除的 admin 用户上。

    全新库里 internal.owner_id 硬编码为 1(database.py);若本文件首个
    make_user 用户恰好拿到 id=1,其 teardown 会级联删掉 internal 客户端,
    登录会以 "Client not found: internal" 炸掉(同 test_restricted_session.py)。
    """


def _login(client, user):
    resp = client.post(
        "/api/auth/login",
        json={"username": user.username, "password": "Passw0rd!"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_sequential_replay_revokes_family(client, make_user, db_session):
    """顺序重放旧 refresh token → 401 + 家族吊销(旋转后的新 token 一并失效)。"""
    from app.models import Token
    from app.utils.security import hash_token

    user = make_user()
    data = _login(client, user)
    old_refresh = data["refresh_token"]

    # 正常轮换一次
    r1 = client.post("/api/auth/refresh", json={"refresh_token": old_refresh})
    assert r1.status_code == 200, r1.text
    new_refresh = r1.json()["refresh_token"]
    assert new_refresh != old_refresh

    # 重放旧 token → 401(触发家族吊销)
    r2 = client.post("/api/auth/refresh", json={"refresh_token": old_refresh})
    assert r2.status_code == 401, r2.text

    # 家族已被灭:轮换后的新 token 也无法使用(记录被删,直接 401)
    r3 = client.post("/api/auth/refresh", json={"refresh_token": new_refresh})
    assert r3.status_code == 401, r3.text
    assert db_session.query(Token).filter(
        Token.token_hash == hash_token(new_refresh)
    ).first() is None


def test_rotation_race_loses_to_concurrent_claim(client, make_user, db_session, monkeypatch):
    """竞态模拟:SELECT 之后、条件 UPDATE 抢占之前,并发方抢先轮换了同一 token。

    修复前(先 SELECT 检查后标记吊销,非原子):本请求仍会成功轮换,
    家族分叉成两条活跃链,重放检测永不触发;
    修复后(条件 UPDATE 抢占):抢占失败按重放处理 → 家族吊销。
    """
    from datetime import timedelta

    import app.services.auth_service as auth_service_module
    from app.models import Token
    from app.utils.security import hash_token
    from app.utils.time import utcnow

    user = make_user()
    data = _login(client, user)
    refresh_token = data["refresh_token"]
    token_hash_value = hash_token(refresh_token)

    # 记录原始 token 行(拿 client_id 供"赢家"的新 token 行使用)
    orig_record = db_session.query(Token).filter(
        Token.token_hash == token_hash_value, Token.type == "refresh"
    ).first()
    assert orig_record is not None and orig_record.revoked_at is None

    winner_token_hash = hash_token("winner-concurrent-new-token")

    orig_create_refresh_token = auth_service_module.create_refresh_token

    def racing_create_refresh_token(token_data, remember_me=False):
        """模拟并发请求在本次 UPDATE 抢占之前抢先完成轮换:
        把该 token 标记 revoked + 在同 family 插入赢家的新 token。"""
        db_session.query(Token).filter(
            Token.id == orig_record.id,
        ).update(
            {"revoked_at": utcnow(), "family_id": "race-family"},
            synchronize_session=False,
        )
        db_session.add(Token(
            token_hash=winner_token_hash,
            type="refresh",
            user_id=user.id,
            client_id=orig_record.client_id,
            scope=orig_record.scope,
            family_id="race-family",
            expires_at=utcnow() + timedelta(days=7),
        ))
        db_session.commit()
        return orig_create_refresh_token(token_data, remember_me)

    # create_refresh_token 在「SELECT 检查之后、条件 UPDATE 抢占之前」被调用,
    # 恰好是原实现的 TOCTOU 窗口——在这里注入并发竞争
    monkeypatch.setattr(
        auth_service_module, "create_refresh_token", racing_create_refresh_token
    )

    result = auth_service_module.AuthService.refresh_access_token(
        db_session, refresh_token
    )

    # 抢占失败:不得成功轮换(修复前这里会返回新 token 对 = 家族分叉)
    assert result is None

    # 家族被灭:赢家的活跃新 token 也一并删除(重放响应语义)
    db_session.expire_all()
    assert db_session.query(Token).filter(
        Token.token_hash == winner_token_hash
    ).first() is None
    assert db_session.query(Token).filter(
        Token.token_hash == token_hash_value
    ).first() is None


def test_normal_rotation_unaffected(client, make_user, db_session):
    """无竞争时正常轮换:旧 token 标记 revoked,新 token 活跃。"""
    from app.models import Token
    from app.utils.security import hash_token

    user = make_user()
    data = _login(client, user)
    old_refresh = data["refresh_token"]

    r1 = client.post("/api/auth/refresh", json={"refresh_token": old_refresh})
    assert r1.status_code == 200, r1.text
    new_refresh = r1.json()["refresh_token"]

    db_session.expire_all()
    old_record = db_session.query(Token).filter(
        Token.token_hash == hash_token(old_refresh)
    ).first()
    new_record = db_session.query(Token).filter(
        Token.token_hash == hash_token(new_refresh)
    ).first()
    assert old_record is not None and old_record.revoked_at is not None
    assert new_record is not None and new_record.revoked_at is None
    assert old_record.family_id == new_record.family_id
