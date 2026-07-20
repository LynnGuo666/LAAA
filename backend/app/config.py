from functools import lru_cache
from typing import Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# 占位/弱密钥黑名单——出现这些值时启动 fail-fast
_WEAK_SECRET_KEYS = {
    "your-secret-key-change-this-in-production",
    "your-secret-key-here",
    "change-me",
    "secret",
    "changeme",
}


class Settings(BaseSettings):
    app_name: str = "Personal OAuth Server"
    debug: bool = False
    secret_key: str
    algorithm: str = "HS256"

    database_url: str

    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    refresh_token_remember_me_days: int = 30

    allowed_origins: str = "http://localhost:3000,http://localhost:8000"

    host: str = "0.0.0.0"
    port: int = 8000
    # Optional override for frontend static export directory.
    # Env var: STATIC_DIR
    static_dir: Optional[str] = None
    # Optional OpenID Connect issuer override.
    # Env var: OIDC_ISSUER
    oidc_issuer: Optional[str] = None
    # Registration control
    # Env vars: ALLOW_OPEN_REGISTRATION, BOOTSTRAP_ALLOW_FIRST_USER
    allow_open_registration: bool = False
    bootstrap_allow_first_user: bool = True

    # WebAuthn / Passkey settings
    # Env vars: WEBAUTHN_RP_ID, WEBAUTHN_RP_NAME, WEBAUTHN_RP_ORIGIN
    webauthn_rp_id: str = "localhost"  # Production: "lynn6.top"
    webauthn_rp_name: str = "LAAA OAuth Server"
    webauthn_rp_origin: str = "http://localhost:8000"  # Production: "https://laaa.lynn6.top"
    webauthn_challenge_timeout_seconds: int = 300

    # Session security settings
    # Env vars: DEFAULT_MAX_SESSIONS, ENABLE_LOGIN_ANOMALY_DETECTION
    default_max_sessions: int = 3  # Default max concurrent sessions per user
    enable_login_anomaly_detection: bool = True  # Enable anomaly detection

    # Anomaly detection thresholds
    # Env vars: SUSPICIOUS_IP_CHANGE_HOURS, SUSPICIOUS_LOCATION_DISTANCE_KM, SUSPICIOUS_LOGIN_VELOCITY_MINUTES, SUSPICIOUS_LOGIN_VELOCITY_COUNT
    suspicious_ip_change_hours: int = 1  # Time window for IP change detection
    suspicious_location_distance_km: int = 500  # Distance threshold for geo jump
    suspicious_login_velocity_minutes: int = 5  # Time window for login frequency
    suspicious_login_velocity_count: int = 5  # Max logins in time window

    # GeoIP settings (using local MaxMind database)
    # Env vars: GEOIP_ENABLED, GEOIP_DATABASE_PATH
    geoip_enabled: bool = True
    geoip_database_path: str = "data/GeoLite2-City.mmdb"

    # ip2region settings (for accurate Chinese IP province lookup)
    # Env vars: IP2REGION_ENABLED, IP2REGION_DATABASE_PATH
    ip2region_enabled: bool = True
    ip2region_database_path: str = "data/ip2region.xdb"

    # SMTP Email settings
    # Env vars: SMTP_ENABLED, SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD,
    #           SMTP_FROM_EMAIL, SMTP_FROM_NAME, SMTP_USE_TLS, SMTP_USE_SSL
    smtp_enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_from_name: str = "LAAA OAuth Server"
    smtp_use_tls: bool = True  # STARTTLS (port 587)
    smtp_use_ssl: bool = False  # SSL/TLS (port 465)

    # Risk-based verification settings
    # Env vars: RISK_SCORE_MEDIUM, RISK_SCORE_HIGH
    risk_score_medium: int = 3  # Medium risk threshold
    risk_score_high: int = 5  # High risk threshold

    # Verification settings
    # Env vars: VERIFICATION_CODE_EXPIRE_MINUTES, VERIFICATION_CODE_MAX_ATTEMPTS,
    #           VERIFICATION_CODE_COOLDOWN_SECONDS, MAGIC_LINK_EXPIRE_MINUTES,
    #           VERIFICATION_SESSION_EXPIRE_MINUTES, BLOCK_SUSPICIOUS_LOGIN
    verification_code_expire_minutes: int = 5
    verification_code_max_attempts: int = 5
    verification_code_cooldown_seconds: int = 60
    magic_link_expire_minutes: int = 15
    verification_session_expire_minutes: int = 30
    block_suspicious_login: bool = True

    # TOTP settings
    # Env vars: TOTP_ISSUER
    totp_issuer: str = "LAAA OAuth Server"

    # Frontend URL (for magic links, etc.)
    # Env var: FRONTEND_URL
    frontend_url: str = "http://localhost:8000"  # Production: "https://laaa.lynn6.top"

    # JWT signing (RS256 迁移)。access/id token 用非对称签名,JWKS 只暴露公钥。
    # refresh token 仍用对称 secret_key(不对外暴露验证)。
    # 默认指向 jwt_keys/(相对工作目录)。开发 = backend/jwt_keys/,
    # 容器 = /app/jwt_keys/(compose 挂载 ./jwt_keys → /app/jwt_keys)。
    # 想换路径/用 docker secrets 注入时再在 .env 显式覆盖。
    jwt_algorithm: str = "RS256"
    jwt_private_key_path: str = "jwt_keys/jwt_private.pem"
    jwt_public_key_path: str = "jwt_keys/jwt_public.pem"
    jwt_key_id: str = ""  # 可选,留空则用公钥 DER 的 sha256[:16]

    # Rate limiting storage (slowapi)。单实例留空用内存;多 worker 设 redis://...
    # Env var: RATELIMIT_STORAGE_URI
    ratelimit_storage_uri: str = ""

    # 可观测性(env 开关,默认关闭以避免开销)
    # LOG_FORMAT=json 启用结构化 JSON 日志;SENTRY_DSN 启用错误上报
    log_format: str = ""  # 空=人类可读,json=结构化
    sentry_dsn: str = ""
    sentry_environment: str = "production"

    @field_validator("secret_key")
    @classmethod
    def _validate_secret_key(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("SECRET_KEY 必须是≥32字符的随机串")
        if v in _WEAK_SECRET_KEYS:
            raise ValueError("SECRET_KEY 不能使用占位/弱密钥,请生成强随机串")
        return v

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)


@lru_cache()
def get_settings():
    return Settings()
