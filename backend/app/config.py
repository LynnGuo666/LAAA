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

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings():
    return Settings()
