from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


class InvitationCodeCreate(BaseModel):
    security_level: int = 1
    max_uses: int = 1
    expire_days: int = 7


class InvitationCodeResponse(BaseModel):
    id: str
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
    logo_url: Optional[str] = None
    website_url: Optional[str] = None
    support_email: Optional[str] = None
    privacy_policy_url: Optional[str] = None
    terms_of_service_url: Optional[str] = None
    redirect_uris: List[str] = []
    required_security_level: int = 1
    require_mfa: bool = False


class ApplicationResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    logo_url: Optional[str]
    website_url: Optional[str]
    support_email: Optional[str]
    privacy_policy_url: Optional[str]
    terms_of_service_url: Optional[str]
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
    id: str
    name: str
    resource: str
    action: str
    description: Optional[str]
    required_security_level: int
    require_additional_verification: bool

    class Config:
        from_attributes = True


class UserResponse(BaseModel):
    id: str
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