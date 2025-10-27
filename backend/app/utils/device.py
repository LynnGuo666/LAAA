from typing import Optional
import hashlib
import secrets


def generate_device_id(user_agent: str, ip_address: str) -> str:
    """Generate a unique device ID based on user agent and IP"""
    # Create a hash of user agent and IP
    data = f"{user_agent}:{ip_address}:{secrets.token_hex(8)}"
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
