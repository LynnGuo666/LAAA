"""结构化日志与可观测性基线。

提供:
- structlog JSON 输出(env SENTRY_DSN 启用时同时挂 Sentry)
- request_id 中间件:每个请求注入唯一 ID,贯穿日志,便于排障追踪
- 统一 logger 配置,替代裸 logging.getLogger

设计:默认输出人类可读的 console 格式;LOG_FORMAT=json 时输出机器可解析 JSON,
便于采集到 ELK/Loki。env 开关,默认不引入性能开销。
"""
import logging
import sys
import uuid

from app.config import get_settings

settings = get_settings()


def configure_logging() -> None:
    """配置根 logger。

    LOG_FORMAT=json → JSON 行;否则保持 uvicorn 默认人类可读格式。
    SENTRY_DSN 设置时挂载 sentry-sdk(可选,默认关闭)。
    """
    level = logging.DEBUG if settings.debug else logging.INFO

    if settings.log_format == "json":
        # 结构化 JSON:用 structlog(若安装),否则退化为标准 logging JSON
        try:
            import structlog

            structlog.configure(
                processors=[
                    structlog.processors.add_log_level,
                    structlog.processors.TimeStamper(fmt="iso"),
                    structlog.processors.JSONRenderer(),
                ],
                wrapper_class=structlog.make_filtering_bound_logger(level),
                cache_logger_on_first_use=True,
            )
            logging.basicConfig(level=level, stream=sys.stdout, format="%(message)s")
        except ImportError:
            # structlog 未装,退化标准 logging
            logging.basicConfig(level=level, stream=sys.stdout)
    else:
        logging.basicConfig(level=level, stream=sys.stdout)

    # Sentry(可选):env SENTRY_DSN 设置时启用
    if settings.sentry_dsn:
        try:
            import sentry_sdk
            from sentry_sdk.integrations.fastapi import FastApiIntegration

            sentry_sdk.init(
                dsn=settings.sentry_dsn,
                environment=settings.sentry_environment,
                traces_sample_rate=0.0,  # 不开性能采样,只收错误
                integrations=[FastApiIntegration()],
            )
            logging.getLogger(__name__).info("Sentry initialized env=%s", settings.sentry_environment)
        except ImportError:
            logging.getLogger(__name__).warning("SENTRY_DSN set but sentry-sdk not installed")


class RequestIdMiddleware:
    """为每个请求注入 X-Request-ID(复用入站头或生成新 UUID)。

    日志可通过 request_id 关联同一请求的多条记录。
    """

    HEADER = "X-Request-ID"

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # 从入站头取 request_id,否则生成
        headers = dict(scope.get("headers") or [])
        request_id = headers.get(self.HEADER.lower().encode(), b"").decode() or str(uuid.uuid4())

        # 注入到 scope state 供下游访问
        if "state" not in scope:
            scope["state"] = {}
        scope["state"]["request_id"] = request_id

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                message.setdefault("headers", []).append(
                    (self.HEADER.lower().encode(), request_id.encode())
                )
            await send(message)

        await self.app(scope, receive, send_wrapper)


def get_request_id(request) -> str:
    """从 request.state 取 request_id(供日志/响应使用)。"""
    return getattr(getattr(request, "state", None), "request_id", "") or ""
