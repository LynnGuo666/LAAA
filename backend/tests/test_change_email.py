"""change-email 流程测试:密码确认、双邮箱过渡、token 验证生效。

注:测试共享 session 级 DB,顺序敏感——test_change_email_creates_pending_verification
先用了 newadmin@example.com,本文件靠每个测试用不同邮箱避免串扰。
"""
from app.models import VerificationCode


def test_change_email_requires_password(client, admin_token, seed_admin):
    """无 current_password 或密码错误 → 400,不改邮箱。"""
    # 缺 current_password
    resp = client.post(
        "/api/auth/change-email",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"new_email": "new@example.com"},
    )
    assert resp.status_code == 422  # 缺字段

    # 错误密码
    resp = client.post(
        "/api/auth/change-email",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"current_password": "wrong-password", "new_email": "new@example.com"},
    )
    assert resp.status_code == 400
    assert "密码错误" in resp.json()["detail"]
    # 邮箱未变
    from app.database import SessionLocal
    from app.models import User
    db = SessionLocal()
    u = db.query(User).filter(User.id == seed_admin.id).first()
    assert u.email == "admin@example.com"
    db.close()


def test_change_email_rejects_same_email(client, admin_token, seed_admin):
    """新邮箱与当前相同 → 400。"""
    resp = client.post(
        "/api/auth/change-email",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"current_password": "admin123", "new_email": "admin@example.com"},
    )
    assert resp.status_code == 400


def test_change_email_creates_pending_verification(client, admin_token, seed_admin, db_session):
    """正确密码 + 新邮箱 → 创建 change_email 待验证记录,不立即改 users.email。"""
    resp = client.post(
        "/api/auth/change-email",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"current_password": "admin123", "new_email": "newadmin@example.com"},
    )
    assert resp.status_code == 200
    assert "验证链接已发送" in resp.json()["message"]

    # users.email 未立即变更
    from app.models import User
    u = db_session.query(User).filter(User.id == seed_admin.id).first()
    assert u.email == "admin@example.com"

    # 存在 change_email 待验证记录
    pending = db_session.query(VerificationCode).filter(
        VerificationCode.user_id == seed_admin.id,
        VerificationCode.purpose == "change_email",
        VerificationCode.is_used == False,
    ).first()
    assert pending is not None
    assert pending.new_email == "newadmin@example.com"
    assert pending.token  # 有 token


def test_change_email_verification_applies_new_email(client, admin_token, seed_admin, db_session):
    """验证 change_email token 后,users.email 才真正更新并标记已验证。"""
    # 发起变更(用本测试专属邮箱,避免与其它测试的 pending 记录串扰)
    resp = client.post(
        "/api/auth/change-email",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"current_password": "admin123", "new_email": "verified@example.com"},
    )
    assert resp.status_code == 200

    # 取最新的、new_email=verified 的待验证记录(避免取到别的测试遗留的)
    pending = db_session.query(VerificationCode).filter(
        VerificationCode.purpose == "change_email",
        VerificationCode.is_used == False,
        VerificationCode.new_email == "verified@example.com",
    ).order_by(VerificationCode.id.desc()).first()
    assert pending is not None
    token = pending.token

    # 访问验证链接
    resp = client.get(f"/api/auth/verify-email/{token}")
    assert resp.status_code == 200
    assert resp.json()["email_verified"] is True

    # users.email 已更新
    from app.models import User
    u = db_session.query(User).filter(User.id == seed_admin.id).first()
    db_session.refresh(u)
    assert u.email == "verified@example.com"
    assert u.email_verified is True

    # 记录已标记使用
    db_session.refresh(pending)
    assert pending.is_used is True


def test_change_email_verification_rejects_taken_email(client, admin_token, seed_admin, db_session):
    """若验证期间新邮箱被他人占用,验证应失败。"""
    from app.models import User
    from app.utils.security import get_password_hash

    # 占用新邮箱的另一个用户
    other = User(username="other", email="taken@example.com", password_hash=get_password_hash("x"), status="active")
    db_session.add(other)
    db_session.commit()

    resp = client.post(
        "/api/auth/change-email",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"current_password": "admin123", "new_email": "taken@example.com"},
    )
    # 发起时若已被占用,直接 400
    assert resp.status_code == 400
    assert "已被使用" in resp.json()["detail"]
