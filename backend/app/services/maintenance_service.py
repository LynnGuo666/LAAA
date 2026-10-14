"""Maintenance Service - 定期清理过期数据。

Token 表(authorization_code/refresh)、verification_codes、webauthn_challenges
此前从无清理:过期数据无限累积,表越大登录越慢。login_logs 保留窗口外归档删除。

由 main.py lifespan 启动后台 asyncio 任务,每小时跑一次;各清理实现幂等。
"""
import asyncio
import logging
from datetime import timedelta

from sqlalchemy.orm import Session

from app.models import LoginLog, Token, VerificationCode, WebAuthnChallenge
from app.utils.time import utcnow

logger = logging.getLogger(__name__)

CLEANUP_INTERVAL_SECONDS = 3600  # 每小时
LOGIN_LOG_RETENTION_DAYS = 180   # 登录日志保留半年(异常检测只需要近期历史)


def cleanup_expired_data(db: Session) -> dict:
    """删除所有过期的一次性凭据与超期日志,返回各表删除行数。"""
    now = utcnow()
    stats = {}

    # 过期/已消耗的 token(含 authorization_code、authorization_code_claimed、refresh)
    stats['tokens'] = (
        db.query(Token)
        .filter(Token.expires_at <= now)
        .delete(synchronize_session=False)
    )

    # 过期验证码(email code / magic link / change email)
    stats['verification_codes'] = (
        db.query(VerificationCode)
        .filter(VerificationCode.expires_at <= now)
        .delete(synchronize_session=False)
    )

    # 过期 WebAuthn challenge
    stats['webauthn_challenges'] = (
        db.query(WebAuthnChallenge)
        .filter(WebAuthnChallenge.expires_at <= now)
        .delete(synchronize_session=False)
    )

    # 超期登录日志(保留近期历史供异常检测)
    stats['login_logs'] = (
        db.query(LoginLog)
        .filter(LoginLog.created_at < now - timedelta(days=LOGIN_LOG_RETENTION_DAYS))
        .delete(synchronize_session=False)
    )

    db.commit()
    if any(stats.values()):
        logger.info("maintenance cleanup: %s", stats)
    return stats


async def maintenance_loop():
    """后台循环:每小时清理一次。异常不退出循环。

    清理的同步 DB 操作包进线程池,避免每小时一次的全表删除
    (带索引后仍可能扫删大量行)阻塞事件循环。
    """
    from fastapi.concurrency import run_in_threadpool

    from app.database import SessionLocal

    while True:
        try:
            db = SessionLocal()
            try:
                await run_in_threadpool(cleanup_expired_data, db)
            finally:
                db.close()
        except Exception:
            logger.exception("maintenance cleanup failed")
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)


def start_maintenance_task() -> asyncio.Task:
    """启动清理后台任务(持有引用防 GC)。"""
    return asyncio.create_task(maintenance_loop())
