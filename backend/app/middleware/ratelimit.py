"""全局速率限制配置(slowapi)。

按 IP 和按关键标识(用户名/邮箱)分层限流,覆盖登录、token、注册、magic-link 等
高风险端点,防止撞库与邮件轰炸。

生产多 worker 部署时,把 limiter storage_uri 改为 redis:// 以共享计数。
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import get_settings

settings = get_settings()

# 单实例用内存存储;生产可设 RATELIMIT_STORAGE_URI=redis://... 共享
limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=settings.ratelimit_storage_uri,
    default_limits=[],  # 不设全局默认,按端点显式标注
)
