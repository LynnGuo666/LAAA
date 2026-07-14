"""
Async Email Service

This service provides asynchronous email sending capabilities using aiosmtplib.
Supports both plain text and HTML emails with Jinja2 templating.
"""

import asyncio
import logging
import ssl
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, List, Optional

import aiosmtplib
from jinja2 import BaseLoader, Environment

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


# Email templates
EMAIL_TEMPLATES = {
    "suspicious_login": {
        "subject": "【安全提醒】检测到可疑登录活动",
        "html": """
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #dc2626; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
        .footer { background: #f3f4f6; padding: 15px; border-radius: 0 0 8px 8px; font-size: 12px; color: #6b7280; }
        .info-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        .info-table td { padding: 8px; border-bottom: 1px solid #e5e7eb; }
        .info-table td:first-child { font-weight: 600; width: 120px; color: #374151; }
        .warning { background: #fef2f2; border: 1px solid #fecaca; padding: 15px; border-radius: 6px; margin: 15px 0; }
        .anomaly-item { background: #fff; padding: 10px; margin: 5px 0; border-radius: 4px; border-left: 3px solid #dc2626; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2 style="margin: 0;">⚠️ 安全提醒</h2>
        </div>
        <div class="content">
            <p>您好，<strong>{{ username }}</strong>：</p>
            <p>我们检测到您的账户存在可疑登录活动：</p>

            <table class="info-table">
                <tr><td>登录时间</td><td>{{ login_time }}</td></tr>
                <tr><td>IP 地址</td><td>{{ ip_address }}</td></tr>
                <tr><td>地理位置</td><td>{{ location }}</td></tr>
                <tr><td>设备</td><td>{{ device_name }}</td></tr>
                <tr><td>登录方式</td><td>{{ login_method }}</td></tr>
            </table>

            <div class="warning">
                <strong>检测到的异常：</strong>
                {% for anomaly in anomalies %}
                <div class="anomaly-item">
                    <strong>{{ anomaly.type_name }}</strong>：{{ anomaly.message }}
                </div>
                {% endfor %}
            </div>

            <p>如果这是您本人的操作，请忽略此邮件。</p>
            <p>如果这不是您本人的操作，建议您：</p>
            <ul>
                <li>立即修改密码</li>
                <li>检查并撤销可疑会话</li>
                <li>启用通行密钥增强安全性</li>
            </ul>
        </div>
        <div class="footer">
            <p>此邮件由 {{ site_name }} 系统自动发送，请勿回复。</p>
        </div>
    </div>
</body>
</html>
"""
    },
    "new_device_login": {
        "subject": "【安全提醒】您的账户在新设备上登录",
        "html": """
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
        .footer { background: #f3f4f6; padding: 15px; border-radius: 0 0 8px 8px; font-size: 12px; color: #6b7280; }
        .info-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        .info-table td { padding: 8px; border-bottom: 1px solid #e5e7eb; }
        .info-table td:first-child { font-weight: 600; width: 120px; color: #374151; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2 style="margin: 0;">🔔 新设备登录提醒</h2>
        </div>
        <div class="content">
            <p>您好，<strong>{{ username }}</strong>：</p>
            <p>您的账户刚刚在一台新设备上登录：</p>

            <table class="info-table">
                <tr><td>登录时间</td><td>{{ login_time }}</td></tr>
                <tr><td>IP 地址</td><td>{{ ip_address }}</td></tr>
                <tr><td>地理位置</td><td>{{ location }}</td></tr>
                <tr><td>设备</td><td>{{ device_name }}</td></tr>
                <tr><td>登录方式</td><td>{{ login_method }}</td></tr>
            </table>

            <p>如果这是您本人的操作，请忽略此邮件。</p>
            <p>如果这不是您本人的操作，请立即修改密码并检查账户安全。</p>
        </div>
        <div class="footer">
            <p>此邮件由 {{ site_name }} 系统自动发送，请勿回复。</p>
        </div>
    </div>
</body>
</html>
"""
    },
    "password_changed": {
        "subject": "【安全提醒】您的密码已修改",
        "html": """
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #059669; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
        .footer { background: #f3f4f6; padding: 15px; border-radius: 0 0 8px 8px; font-size: 12px; color: #6b7280; }
        .info-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        .info-table td { padding: 8px; border-bottom: 1px solid #e5e7eb; }
        .info-table td:first-child { font-weight: 600; width: 120px; color: #374151; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2 style="margin: 0;">✅ 密码修改成功</h2>
        </div>
        <div class="content">
            <p>您好，<strong>{{ username }}</strong>：</p>
            <p>您的账户密码已成功修改。</p>

            <table class="info-table">
                <tr><td>修改时间</td><td>{{ change_time }}</td></tr>
                <tr><td>IP 地址</td><td>{{ ip_address }}</td></tr>
                <tr><td>设备</td><td>{{ device_name }}</td></tr>
            </table>

            <p>如果这不是您本人的操作，请立即联系管理员。</p>
        </div>
        <div class="footer">
            <p>此邮件由 {{ site_name }} 系统自动发送，请勿回复。</p>
        </div>
    </div>
</body>
</html>
"""
    },
    "verification_code": {
        "subject": "【验证码】您的登录验证码",
        "html": """
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #7c3aed; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; text-align: center; }
        .footer { background: #f3f4f6; padding: 15px; border-radius: 0 0 8px 8px; font-size: 12px; color: #6b7280; }
        .code { font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #7c3aed; background: #ede9fe; padding: 20px 30px; border-radius: 8px; display: inline-block; margin: 20px 0; }
        .expire { color: #6b7280; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2 style="margin: 0;">🔐 验证码</h2>
        </div>
        <div class="content">
            <p>您好，<strong>{{ username }}</strong>：</p>
            <p>您的验证码是：</p>
            <div class="code">{{ code }}</div>
            <p class="expire">验证码有效期 {{ expire_minutes }} 分钟，请勿泄露给他人。</p>
        </div>
        <div class="footer">
            <p>此邮件由 {{ site_name }} 系统自动发送，请勿回复。</p>
            <p>如果您没有请求此验证码，请忽略此邮件。</p>
        </div>
    </div>
</body>
</html>
"""
    },
    "magic_link": {
        "subject": "【登录链接】点击链接完成登录验证",
        "html": """
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; text-align: center; }
        .footer { background: #f3f4f6; padding: 15px; border-radius: 0 0 8px 8px; font-size: 12px; color: #6b7280; }
        .button { display: inline-block; background: #2563eb; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
        .button:hover { background: #1d4ed8; }
        .expire { color: #6b7280; font-size: 14px; }
        .warning { background: #fef3cd; border: 1px solid #ffc107; padding: 10px; border-radius: 6px; margin: 15px 0; font-size: 13px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2 style="margin: 0;">🔗 登录验证链接</h2>
        </div>
        <div class="content">
            <p>您好，<strong>{{ username }}</strong>：</p>
            <p>请点击下方按钮完成登录验证：</p>
            <a href="{{ link }}" class="button">验证登录</a>
            <p class="expire">链接有效期 {{ expire_minutes }} 分钟</p>
            <div class="warning">
                ⚠️ 请务必在发起请求的同一设备和浏览器中点击此链接
            </div>
        </div>
        <div class="footer">
            <p>此邮件由 {{ site_name }} 系统自动发送，请勿回复。</p>
            <p>如果您没有请求此链接，请忽略此邮件。</p>
            <p>如果按钮无法点击，请复制以下链接到浏览器：</p>
            <p style="word-break: break-all; color: #2563eb;">{{ link }}</p>
        </div>
    </div>
</body>
</html>
"""
    },
    "magic_link_device_mismatch": {
        "subject": "【安全警告】检测到可疑的登录链接验证",
        "html": """
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #dc2626; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
        .footer { background: #f3f4f6; padding: 15px; border-radius: 0 0 8px 8px; font-size: 12px; color: #6b7280; }
        .warning { background: #fef2f2; border: 1px solid #fecaca; padding: 15px; border-radius: 6px; margin: 15px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2 style="margin: 0;">安全警告</h2>
        </div>
        <div class="content">
            <p>您好，<strong>{{ username }}</strong>：</p>
            <div class="warning">
                <strong>检测到可疑活动</strong>
                <p>有人尝试在不同的设备上使用您的登录链接进行验证。这可能表明有人试图未经授权访问您的账户。</p>
            </div>
            <p>为了安全起见，该登录链接已被拒绝。</p>
            <p>如果这是您本人的操作，请确保在发送登录链接请求的同一设备和浏览器中点击链接。</p>
            <p>如果这不是您本人的操作，建议您：</p>
            <ul>
                <li>立即修改密码</li>
                <li>检查账户安全设置</li>
                <li>启用 TOTP 两步验证</li>
            </ul>
        </div>
        <div class="footer">
            <p>此邮件由 {{ site_name }} 系统自动发送，请勿回复。</p>
        </div>
    </div>
</body>
</html>
"""
    },
    "email_verification": {
        "subject": "【邮箱验证】请验证您的邮箱地址",
        "html": """
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #059669; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; text-align: center; }
        .footer { background: #f3f4f6; padding: 15px; border-radius: 0 0 8px 8px; font-size: 12px; color: #6b7280; }
        .button { display: inline-block; background: #059669; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
        .expire { color: #6b7280; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2 style="margin: 0;">验证您的邮箱</h2>
        </div>
        <div class="content">
            <p>您好，<strong>{{ username }}</strong>：</p>
            <p>感谢您注册 {{ site_name }}。请点击下方按钮验证您的邮箱地址：</p>
            <a href="{{ link }}" class="button">验证邮箱</a>
            <p class="expire">链接有效期 {{ expire_hours }} 小时</p>
            <p style="color: #6b7280; font-size: 13px; margin-top: 20px;">
                验证邮箱后，您将可以使用以下功能：
            </p>
            <ul style="text-align: left; color: #6b7280; font-size: 13px;">
                <li>创建 OAuth 应用</li>
                <li>绑定通行密钥</li>
                <li>修改邮箱地址</li>
            </ul>
        </div>
        <div class="footer">
            <p>此邮件由 {{ site_name }} 系统自动发送，请勿回复。</p>
            <p>如果您没有注册此账户，请忽略此邮件。</p>
            <p>如果按钮无法点击，请复制以下链接到浏览器：</p>
            <p style="word-break: break-all; color: #059669;">{{ link }}</p>
        </div>
    </div>
</body>
</html>
"""
    }
}

# Anomaly type translations
ANOMALY_TYPE_NAMES = {
    "ip_change": "IP 地址变化",
    "geo_jump": "地理位置跳跃",
    "high_velocity": "登录频率异常",
    "new_device": "新设备登录"
}

# Login method translations
LOGIN_METHOD_NAMES = {
    "password": "密码",
    "passkey": "通行密钥",
    "oauth": "OAuth"
}


class EmailService:
    """Async email service using aiosmtplib"""

    # autoescape=True:邮件模板渲染用户可控字段(显示名、IP、地理位置、验证码等),
    # 自动转义防止 HTML 注入/XSS。模板本身需要的 HTML 结构写在模板里,不依赖原始注入。
    _jinja_env = Environment(loader=BaseLoader(), autoescape=True)

    @classmethod
    async def send_email(
        cls,
        to_email: str,
        subject: str,
        html_content: str,
        text_content: Optional[str] = None
    ) -> bool:
        """
        Send an email asynchronously.

        Args:
            to_email: Recipient email address
            subject: Email subject
            html_content: HTML content of the email
            text_content: Plain text content (optional, will be extracted from HTML if not provided)

        Returns:
            True if email was sent successfully, False otherwise
        """
        if not settings.smtp_enabled:
            logger.warning("SMTP is disabled, email not sent")
            return False

        if not settings.smtp_host or not settings.smtp_from_email:
            logger.error("SMTP configuration incomplete")
            return False

        try:
            # Create message
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
            msg["To"] = to_email

            # Add plain text part
            if text_content:
                msg.attach(MIMEText(text_content, "plain", "utf-8"))

            # Add HTML part
            msg.attach(MIMEText(html_content, "html", "utf-8"))

            # Send email
            # Create SSL context that doesn't verify certificates (for some SMTP servers)
            tls_context = ssl.create_default_context()
            tls_context.check_hostname = False
            tls_context.verify_mode = ssl.CERT_NONE

            if settings.smtp_use_ssl:
                # Direct SSL connection (port 465)
                await aiosmtplib.send(
                    msg,
                    hostname=settings.smtp_host,
                    port=settings.smtp_port,
                    username=settings.smtp_username or None,
                    password=settings.smtp_password or None,
                    use_tls=True,
                    tls_context=tls_context
                )
            else:
                # STARTTLS connection (port 587)
                await aiosmtplib.send(
                    msg,
                    hostname=settings.smtp_host,
                    port=settings.smtp_port,
                    username=settings.smtp_username or None,
                    password=settings.smtp_password or None,
                    start_tls=settings.smtp_use_tls,
                    tls_context=tls_context if settings.smtp_use_tls else None
                )

            logger.info(f"Email sent successfully to {to_email}")
            return True

        except Exception as e:
            logger.error(f"Failed to send email to {to_email}: {e}")
            return False

    @classmethod
    def render_template(cls, template_name: str, **kwargs) -> tuple[str, str]:
        """
        Render an email template.

        Args:
            template_name: Name of the template (e.g., 'suspicious_login')
            **kwargs: Template variables

        Returns:
            Tuple of (subject, html_content)
        """
        template_data = EMAIL_TEMPLATES.get(template_name)
        if not template_data:
            raise ValueError(f"Unknown email template: {template_name}")

        subject = template_data["subject"]
        html_template = cls._jinja_env.from_string(template_data["html"])
        html_content = html_template.render(**kwargs)

        return subject, html_content

    @classmethod
    async def send_suspicious_login_notification(
        cls,
        to_email: str,
        username: str,
        ip_address: str,
        location: str,
        device_name: str,
        login_method: str,
        anomalies: List[Dict[str, Any]],
        site_name: str = "LAAA OAuth Server"
    ) -> bool:
        """Send suspicious login notification email"""
        # Translate anomaly types
        translated_anomalies = []
        for anomaly in anomalies:
            translated_anomalies.append({
                "type_name": ANOMALY_TYPE_NAMES.get(anomaly.get("type"), anomaly.get("type")),
                "message": anomaly.get("message", "")
            })

        subject, html_content = cls.render_template(
            "suspicious_login",
            username=username,
            login_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            ip_address=ip_address,
            location=location or "未知",
            device_name=device_name or "未知设备",
            login_method=LOGIN_METHOD_NAMES.get(login_method, login_method),
            anomalies=translated_anomalies,
            site_name=site_name
        )

        return await cls.send_email(to_email, subject, html_content)

    @classmethod
    async def send_new_device_notification(
        cls,
        to_email: str,
        username: str,
        ip_address: str,
        location: str,
        device_name: str,
        login_method: str,
        site_name: str = "LAAA OAuth Server"
    ) -> bool:
        """Send new device login notification email"""
        subject, html_content = cls.render_template(
            "new_device_login",
            username=username,
            login_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            ip_address=ip_address,
            location=location or "未知",
            device_name=device_name or "未知设备",
            login_method=LOGIN_METHOD_NAMES.get(login_method, login_method),
            site_name=site_name
        )

        return await cls.send_email(to_email, subject, html_content)

    @classmethod
    async def send_password_changed_notification(
        cls,
        to_email: str,
        username: str,
        ip_address: str,
        device_name: str,
        site_name: str = "LAAA OAuth Server"
    ) -> bool:
        """Send password changed notification email"""
        subject, html_content = cls.render_template(
            "password_changed",
            username=username,
            change_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            ip_address=ip_address,
            device_name=device_name or "未知设备",
            site_name=site_name
        )

        return await cls.send_email(to_email, subject, html_content)

    @classmethod
    async def send_verification_code(
        cls,
        to_email: str,
        username: str,
        code: str,
        expire_minutes: int = 5,
        site_name: str = "LAAA OAuth Server"
    ) -> bool:
        """Send verification code email"""
        subject, html_content = cls.render_template(
            "verification_code",
            username=username,
            code=code,
            expire_minutes=expire_minutes,
            site_name=site_name
        )

        return await cls.send_email(to_email, subject, html_content)

    @classmethod
    async def send_magic_link(
        cls,
        to_email: str,
        username: str,
        link: str,
        expire_minutes: int = 15,
        site_name: str = "LAAA OAuth Server"
    ) -> bool:
        """Send magic link email"""
        subject, html_content = cls.render_template(
            "magic_link",
            username=username,
            link=link,
            expire_minutes=expire_minutes,
            site_name=site_name
        )

        return await cls.send_email(to_email, subject, html_content)

    @classmethod
    async def send_magic_link_device_mismatch(
        cls,
        to_email: str,
        username: str,
        site_name: str = "LAAA OAuth Server"
    ) -> bool:
        """Send magic link device mismatch security alert"""
        subject, html_content = cls.render_template(
            "magic_link_device_mismatch",
            username=username,
            site_name=site_name
        )

        return await cls.send_email(to_email, subject, html_content)

    @classmethod
    async def send_email_verification(
        cls,
        to_email: str,
        username: str,
        link: str,
        expire_hours: int = 24,
        site_name: str = "LAAA OAuth Server"
    ) -> bool:
        """Send email verification link"""
        subject, html_content = cls.render_template(
            "email_verification",
            username=username,
            link=link,
            expire_hours=expire_hours,
            site_name=site_name
        )

        return await cls.send_email(to_email, subject, html_content)


# Background task helper for non-async contexts
def send_email_background(
    to_email: str,
    subject: str,
    html_content: str,
    text_content: Optional[str] = None
):
    """
    Send email in background (for use in sync contexts).
    Creates a new event loop if needed.
    """
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # If we're in an async context, create a task
            asyncio.create_task(
                EmailService.send_email(to_email, subject, html_content, text_content)
            )
        else:
            # If we're in a sync context, run the coroutine
            loop.run_until_complete(
                EmailService.send_email(to_email, subject, html_content, text_content)
            )
    except RuntimeError:
        # No event loop, create one
        asyncio.run(
            EmailService.send_email(to_email, subject, html_content, text_content)
        )
