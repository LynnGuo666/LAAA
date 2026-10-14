"""全局安全响应头中间件。

静态导出(output: 'export')的 Next.js 无法用 next.config headers(),
注入点只能在后端。CSP 取舍:
- script-src 'unsafe-inline':Next 15 App Router 的 flight data 是大量
  inline self.__next_f.push,全 hash 每次构建变、不可维护;接受 inline,
  CSP 在此主要挡外域脚本加载(供应链投毒)、base 劫持、object 嵌入。
- connect-src 限定 self + API_URL:限制数据外带通道。
- HSTS 不在应用层加(反代终止 TLS,由 nginx 加,见 DEPLOY.md)。
"""
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings

# CSP 字符串模块级预计算:配置在进程生命周期内不变,无需每个请求重建
_settings = get_settings()
_API_ORIGIN = _settings.frontend_url or ""
CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; "
    "font-src 'self' data:; "
    f"connect-src 'self'{f' {_API_ORIGIN}' if _API_ORIGIN else ''}; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "object-src 'none'; "
    "form-action 'self'; "
    "upgrade-insecure-requests"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Content-Security-Policy", CSP)
        return response
