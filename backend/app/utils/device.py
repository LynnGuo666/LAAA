import hashlib
from typing import Optional

from fastapi import Request

from app.config import get_settings


def get_client_ip(request: Request) -> Optional[str]:
    """Get the real client IP address from request.

    代理头(XFF/CF-Connecting-IP/X-Real-IP)默认**不信任**:直连部署时
    客户端可任意伪造这些头,污染 GeoIP/风控/登录日志的 IP 记录。
    推荐部署形态:反代 + uvicorn --proxy-headers + FORWARDED_ALLOW_IPS,
    此时 request.client.host 已是解析后的真实 IP,直接用即可。
    仅当显式设置 TRUST_PROXY_HEADERS=true(自担风险)时才读头。

    Checks various headers for proxied requests (Cloudflare, Nginx, etc.),
    falls back to direct client IP.
    """
    settings = get_settings()

    if settings.trust_proxy_headers:
        # Check CF-Connecting-IP header (Cloudflare)
        cf_ip = request.headers.get("cf-connecting-ip")
        if cf_ip:
            return cf_ip.strip()

        # Check X-Forwarded-For header (may contain multiple IPs: client, proxy1, proxy2, ...)
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            # Take the first IP (original client)
            return forwarded_for.split(",")[0].strip()

        # Check X-Real-IP header
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()

    # Direct client IP(开了 --proxy-headers 时已是真实客户端 IP)
    if request.client:
        return request.client.host

    return None


def generate_device_id(user_id: int, user_agent: str, ip_address: Optional[str] = None) -> str:
    """Generate a stable device ID based on user, user-agent and IP.

    This is used for "remember me" session tracking. It is deterministic so that
    repeated logins from the same environment map to the same remembered device.
    """
    ua = user_agent or "unknown"
    ip = ip_address or "unknown"
    data = f"{user_id}:{ua}:{ip}"
    return hashlib.sha256(data.encode()).hexdigest()[:32]


def parse_device_type(user_agent: str) -> str:
    """Parse device type from user agent"""
    user_agent_lower = user_agent.lower()

    if 'mobile' in user_agent_lower or 'android' in user_agent_lower or 'iphone' in user_agent_lower:
        return 'mobile'
    elif 'tablet' in user_agent_lower or 'ipad' in user_agent_lower:
        return 'tablet'
    else:
        return 'desktop'


def get_device_name(user_agent: str) -> str:
    """Extract a friendly device name from user agent"""
    user_agent_lower = user_agent.lower()

    # Browser detection
    browser = 'Unknown Browser'
    if 'chrome' in user_agent_lower and 'edg' not in user_agent_lower:
        browser = 'Chrome'
    elif 'firefox' in user_agent_lower:
        browser = 'Firefox'
    elif 'safari' in user_agent_lower and 'chrome' not in user_agent_lower:
        browser = 'Safari'
    elif 'edg' in user_agent_lower:
        browser = 'Edge'

    # OS detection
    os_name = 'Unknown OS'
    if 'windows' in user_agent_lower:
        os_name = 'Windows'
    elif 'mac' in user_agent_lower:
        os_name = 'macOS'
    elif 'linux' in user_agent_lower:
        os_name = 'Linux'
    elif 'android' in user_agent_lower:
        os_name = 'Android'
    elif 'iphone' in user_agent_lower or 'ipad' in user_agent_lower:
        os_name = 'iOS'

    return f"{browser} on {os_name}"
