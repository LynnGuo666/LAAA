from pydantic_settings import BaseSettings
from typing import List, Optional, ClassVar
import secrets


class Settings(BaseSettings):
    # 应用基础配置
    PROJECT_NAME: str = "LAAA - 统一身份认证系统"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # 安全配置
    SECRET_KEY: str = secrets.token_urlsafe(32)
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    ALGORITHM: str = "HS256"
    
    # OAuth2 配置
    OAUTH_AUTH_CODE_EXPIRE_MINUTES: int = 10
    OAUTH_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    
    # 数据库配置
    DATABASE_URL: str = "sqlite:///./laaa.db"
    
    # Redis配置 (用于缓存和会话)
    REDIS_URL: str = "redis://localhost:6379/0"
    
    # 邮件配置
    SENDGRID_API_KEY: Optional[str] = None
    FROM_EMAIL: str = "noreply@example.com"
    
    # 安全验证配置
    TOTP_ISSUER: str = "LAAA Auth"
    EMAIL_VERIFICATION_EXPIRE_MINUTES: int = 30
    MAX_LOGIN_ATTEMPTS: int = 5
    ACCOUNT_LOCKOUT_MINUTES: int = 30
    
    # 邀请码配置
    INVITATION_CODE_LENGTH: int = 12
    DEFAULT_INVITATION_EXPIRE_DAYS: int = 7
    
    # CORS配置
    BACKEND_CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:8000",
    ]
    
    # 安全等级配置
    SECURITY_LEVELS: ClassVar[dict] = {
        1: "低级",
        2: "中级", 
        3: "高级",
        4: "管理员级"
    }
    
    class Config:
        env_file = ".env"
        extra = "ignore"  # 允许忽略额外的环境变量


settings = Settings()