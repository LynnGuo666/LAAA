from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime
import uuid


class UserLogin(BaseModel):
    username: str
    password: str
    totp_token: Optional[str] = None


class UserRegister(BaseModel):
    username: str
    email: EmailStr
    password: str
    invitation_code: str


class UserResponse(BaseModel):
    id: uuid.UUID
    username: str
    email: str
    security_level: int
    totp_enabled: bool
    email_verified: bool
    phone: Optional[str] = None
    phone_verified: bool
    is_active: bool
    is_superuser: bool  # 添加管理员字段
    created_at: datetime
    last_login_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TOTPEnable(BaseModel):
    pass


class TOTPVerify(BaseModel):
    token: str