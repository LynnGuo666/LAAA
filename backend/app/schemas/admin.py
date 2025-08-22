from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import uuid


class InvitationCodeCreate(BaseModel):
    security_level: int = 1
    max_uses: int = 1
    expire_days: int = 7


class InvitationCodeResponse(BaseModel):
    id: uuid.UUID
    code: str
    security_level: int
    max_uses: int
    current_uses: int
    expires_at: datetime
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class ApplicationCreate(BaseModel):
    name: str
    description: Optional[str] = None
    redirect_uris: List[str] = []
    required_security_level: int = 1
    require_mfa: bool = False


class ApplicationResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: Optional[str]
    client_id: str
    redirect_uris: List[str]
    required_security_level: int
    require_mfa: bool
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class PermissionCreate(BaseModel):
    name: str
    resource: str
    action: str
    description: Optional[str] = None
    required_security_level: int = 1
    require_additional_verification: bool = False


class PermissionResponse(BaseModel):
    id: uuid.UUID
    name: str
    resource: str
    action: str
    description: Optional[str]
    required_security_level: int
    require_additional_verification: bool

    class Config:
        from_attributes = True


class UserResponse(BaseModel):
    id: uuid.UUID
    username: str
    email: str
    security_level: int
    totp_enabled: bool
    email_verified: bool
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class SystemStats(BaseModel):
    total_users: int
    active_users: int
    total_applications: int
    active_invitations: int