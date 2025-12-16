from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import Optional


class Settings(BaseSettings):
    app_name: str = "Personal OAuth Server"
    debug: bool = True
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

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings():
    return Settings()
