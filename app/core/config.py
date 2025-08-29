from typing import List
from pydantic_settings import BaseSettings
from pydantic import validator
import os


class Settings(BaseSettings):
    database_url: str = "sqlite:///./oauth.db"  # 默认使用SQLite用于开发
    secret_key: str = "dev-secret-key-change-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    jwt_issuer: str = "http://localhost:8000"
    jwt_audience: str = "oauth-client"
    cors_origins: List[str] = ["http://localhost:3000", "http://localhost:8080"]
    laaa_dashboard_client_id: str = "laaa-dashboard"  # LAAA Dashboard的默认Client ID

    @validator('cors_origins', pre=True)
    def assemble_cors_origins(cls, v):
        if isinstance(v, str) and v.startswith('['):
            import json
            return json.loads(v)
        elif isinstance(v, (list, str)):
            return [i.strip() for i in v] if isinstance(v, str) else v
        raise ValueError(v)

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()