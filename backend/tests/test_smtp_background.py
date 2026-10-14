"""SMTP 后台化回归测试(守护:邮件发送移出请求路径)。

背景:magic-link 发送端点此前在请求路径 await SMTP,且「已注册走 SMTP
(慢)/未注册立即返回」的时序差可枚举注册邮箱(安全报告 M-3)。
修复:统一 _spawn_email_task 后台发送,两个分支都立即返回相同响应。

覆盖:
1. magic-link 登录发送:已注册/未注册邮箱响应一致且立即返回
   (monkeypatch _spawn_email_task,断言只有已注册用户真正触发发信)
2. 发送不阻塞:SMTP 慢速时端点仍即时返回
"""
import time

import app.routes.auth as auth_mod


def test_magic_link_send_immediate_and_identical(client, db_session, make_user, monkeypatch):
    """已注册/未注册邮箱:响应一致、均立即返回、仅已注册用户触发发信。"""
    spawned = []

    def fake_spawn(coro):
        spawned.append(coro)
        coro.close()  # 只捕获不执行,避免 "never awaited" 警告

    monkeypatch.setattr(auth_mod, "_spawn_email_task", fake_spawn)

    user = make_user()

    t0 = time.monotonic()
    r1 = client.post("/api/auth/magic-link/login", json={"email": user.email})
    t1 = time.monotonic()
    r2 = client.post("/api/auth/magic-link/login", json={"email": "nobody@example.com"})
    t2 = time.monotonic()

    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text
    # 两分支响应完全一致(不泄露邮箱是否注册)
    assert r1.json() == r2.json()
    # 立即返回(不被 SMTP 挂起)
    assert t1 - t0 < 1.0, f"registered branch took {t1 - t0:.2f}s"
    assert t2 - t1 < 1.0, f"unregistered branch took {t2 - t1:.2f}s"
    # 仅已注册用户触发后台发信
    assert len(spawned) == 1


def test_magic_link_send_does_not_await_smtp(client, db_session, make_user, monkeypatch):
    """SMTP 慢速(2s)时发送端点仍即时返回——邮件在后台任务中发送。"""
    import asyncio

    from app.services.email_service import EmailService

    async def slow_send(**kwargs):
        await asyncio.sleep(2)

    monkeypatch.setattr(EmailService, "send_magic_link", slow_send)

    user = make_user()
    t0 = time.monotonic()
    resp = client.post("/api/auth/magic-link/login", json={"email": user.email})
    elapsed = time.monotonic() - t0

    assert resp.status_code == 200, resp.text
    assert elapsed < 1.5, f"endpoint blocked for {elapsed:.2f}s (SMTP on request path?)"
