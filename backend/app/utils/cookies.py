"""认证 cookie 设置（token A2 方案）。

从 routes/auth.py 抽出为公共工具：passkey 登录等非 auth 路由也需要在
签发 token 后设置同样的 cookie，避免各处复制粘贴导致属性漂移。

三条不变量（改动前请读 CLAUDE.md「认证 cookie 契约」）：
1. laaa_refresh:HttpOnly + SameSite=Strict + Path=/api/auth
   —— 只有 refresh/logout 端点收得到，跨站请求一律不带，天然免疫 CSRF
2. authorize_token:HttpOnly + SameSite=Lax + Path=/api/oauth + 15min
   —— 仅供 OAuth 浏览器重定向的 authorize 端点（顶层导航 GET 需要 Lax），
     寿命 = access token TTL，过期走标准 re-login 重定向
3. 业务 API 端点永远只认 Authorization Bearer（get_current_user 不读 cookie）
"""

from fastapi import Response

from app.config import get_settings


def set_auth_cookies(response: Response, access_token: str, refresh_token: str,
                     remember_me: bool = False) -> None:
    """登录成功时统一设置认证 cookie（refresh + authorize 两条）。"""
    settings = get_settings()
    refresh_max_age = (
        settings.refresh_token_remember_me_days if remember_me
        else settings.refresh_token_expire_days
    ) * 86400
    response.set_cookie(
        key="laaa_refresh",
        value=refresh_token,
        max_age=refresh_max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/api/auth",
    )
    set_authorize_cookie(response, access_token, settings.access_token_expire_minutes * 60)


def set_authorize_cookie(response: Response, access_token: str, max_age_seconds: int) -> None:
    """仅设置 authorize_token cookie（受限会话等无 refresh token 的登录形态）。

    寿命由调用方传入：普通登录 = access TTL；受限会话 = 受限 TTL。
    """
    settings = get_settings()
    response.set_cookie(
        key="authorize_token",
        value=access_token,
        max_age=max_age_seconds,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/api/oauth",
    )


def clear_auth_cookies(response: Response) -> None:
    """登出时清除认证 cookie（含旧名 session_token 的兼容清理）。"""
    response.delete_cookie(key="laaa_refresh", path="/api/auth")
    response.delete_cookie(key="authorize_token", path="/api/oauth")
    response.delete_cookie(key="session_token", path="/")  # 旧名，自然消亡
