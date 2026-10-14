"""邀请码列表分页测试(批次3 修复6)。

守护 /api/admin/invites/ 返回 {items, total}:前端此前把当页条数当
总数,超过一页(20 条)时永远翻不到第 2 页。
"""
import secrets

from app.models import Group, InviteCode


def _seed_invites(db, group_id, count):
    """直插 count 条邀请码(唯一 code),返回 code 列表。"""
    codes = [f"inv_{secrets.token_hex(6)}" for _ in range(count)]
    for code in codes:
        db.add(InviteCode(code=code, group_id=group_id, is_active=True))
    db.commit()
    return codes


def _group(db):
    group = db.query(Group).first()
    if not group:
        group = Group(name=f"g_{secrets.token_hex(4)}", description="test")
        db.add(group)
        db.commit()
    return group


def test_invite_list_returns_server_total(client, db_session, seed_admin, admin_token):
    """列表返回 {items, total};total 为服务端总数,items 遵循 skip/limit。"""
    group = _group(db_session)
    codes = _seed_invites(db_session, group.id, 25)
    headers = {"Authorization": f"Bearer {admin_token}"}

    resp = client.get("/api/admin/invites/", params={"skip": 0, "limit": 20}, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert isinstance(data["items"], list)
    assert len(data["items"]) == 20
    # 共享 DB:总数只做下界断言(其他测试可能也造过邀请码)
    assert data["total"] >= 25

    # 第 2 页仍可取到数据(修复前前端根本翻不到第 2 页)
    resp2 = client.get("/api/admin/invites/", params={"skip": 20, "limit": 20}, headers=headers)
    assert resp2.status_code == 200, resp2.text
    assert len(resp2.json()["items"]) >= 1
    # 两页不重复
    page1_ids = {item["id"] for item in data["items"]}
    page2_ids = {item["id"] for item in resp2.json()["items"]}
    assert page1_ids.isdisjoint(page2_ids)
    assert set(codes) <= {item["code"] for item in data["items"] + resp2.json()["items"]}


def test_invite_list_total_respects_active_filter(client, db_session, seed_admin, admin_token):
    """active 过滤口径下 total 与 items 一致(均为过滤后的服务端计数)。"""
    group = _group(db_session)
    _seed_invites(db_session, group.id, 3)
    db_session.add(InviteCode(code=f"inv_{secrets.token_hex(6)}", group_id=group.id, is_active=False))
    db_session.commit()
    headers = {"Authorization": f"Bearer {admin_token}"}

    resp = client.get("/api/admin/invites/", params={"active": True, "limit": 500}, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total"] == len(data["items"])
    assert all(item["is_active"] for item in data["items"])
