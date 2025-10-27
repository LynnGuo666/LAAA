from pydantic_settings import BaseSettings
from functools import lru_cache


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

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings():
    return Settings()
