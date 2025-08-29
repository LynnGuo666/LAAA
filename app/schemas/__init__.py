from pydantic import BaseModel, EmailStr, validator
from typing import Optional, List
from datetime import datetime


class UserBase(BaseModel):
    email: EmailStr
    username: str
    full_name: Optional[str] = None
    is_active: Optional[bool] = True


class UserCreate(UserBase):
    password: str

    @validator('password')
    def validate_password(cls, v):
        if len(v) < 8:
            raise ValueError('Password must be at least 8 characters long')
        return v


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    username: Optional[str] = None
    full_name: Optional[str] = None
    given_name: Optional[str] = None
    family_name: Optional[str] = None
    middle_name: Optional[str] = None
    nickname: Optional[str] = None
    preferred_username: Optional[str] = None
    profile: Optional[str] = None
    picture: Optional[str] = None
    website: Optional[str] = None
    phone_number: Optional[str] = None
    phone_number_verified: Optional[bool] = None
    email_verified: Optional[bool] = None
    gender: Optional[str] = None
    birthdate: Optional[str] = None
    zoneinfo: Optional[str] = None
    locale: Optional[str] = None


class UserResponse(UserBase):
    id: str
    is_admin: bool
    created_at: datetime
    # OIDC fields
    given_name: Optional[str] = None
    family_name: Optional[str] = None
    middle_name: Optional[str] = None
    nickname: Optional[str] = None
    preferred_username: Optional[str] = None
    profile: Optional[str] = None
    picture: Optional[str] = None
    website: Optional[str] = None
    phone_number: Optional[str] = None
    phone_number_verified: Optional[bool] = None
    email_verified: Optional[bool] = None
    gender: Optional[str] = None
    birthdate: Optional[str] = None
    zoneinfo: Optional[str] = None
    locale: Optional[str] = None

    class Config:
        from_attributes = True


class ClientApplicationBase(BaseModel):
    client_name: str
    client_description: Optional[str] = None
    redirect_uris: List[str]
    response_types: Optional[str] = "code"
    grant_types: Optional[str] = "authorization_code,refresh_token"
    scope: Optional[str] = "openid profile email"
    client_uri: Optional[str] = None
    logo_uri: Optional[str] = None
    tos_uri: Optional[str] = None
    policy_uri: Optional[str] = None
    contacts: Optional[List[str]] = None
    token_endpoint_auth_method: Optional[str] = "client_secret_basic"
    jwks_uri: Optional[str] = None


class ClientApplicationCreate(ClientApplicationBase):
    pass


class ClientApplicationUpdate(BaseModel):
    client_name: Optional[str] = None
    client_description: Optional[str] = None
    redirect_uris: Optional[List[str]] = None
    response_types: Optional[str] = None
    grant_types: Optional[str] = None
    scope: Optional[str] = None
    client_uri: Optional[str] = None
    logo_uri: Optional[str] = None
    tos_uri: Optional[str] = None
    policy_uri: Optional[str] = None
    contacts: Optional[List[str]] = None
    token_endpoint_auth_method: Optional[str] = None
    jwks_uri: Optional[str] = None
    is_active: Optional[bool] = None


class ClientApplicationResponse(ClientApplicationBase):
    id: str
    client_id: str
    client_secret: str
    owner_id: str
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ClientApplicationPublic(BaseModel):
    client_id: str
    client_name: str
    client_description: Optional[str] = None
    client_uri: Optional[str] = None
    logo_uri: Optional[str] = None
    tos_uri: Optional[str] = None
    policy_uri: Optional[str] = None

    class Config:
        from_attributes = True


# OAuth2 流程相关的 schemas
class AuthorizationRequest(BaseModel):
    response_type: str
    client_id: str
    redirect_uri: str
    scope: Optional[str] = None
    state: Optional[str] = None
    code_challenge: Optional[str] = None
    code_challenge_method: Optional[str] = "S256"
    nonce: Optional[str] = None


class TokenRequest(BaseModel):
    grant_type: str
    code: Optional[str] = None
    redirect_uri: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    code_verifier: Optional[str] = None
    refresh_token: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    refresh_token: Optional[str] = None
    scope: Optional[str] = None
    id_token: Optional[str] = None


class UserInfo(BaseModel):
    sub: str
    email: Optional[str] = None
    email_verified: Optional[bool] = None
    given_name: Optional[str] = None
    family_name: Optional[str] = None
    middle_name: Optional[str] = None
    name: Optional[str] = None
    nickname: Optional[str] = None
    preferred_username: Optional[str] = None
    profile: Optional[str] = None
    picture: Optional[str] = None
    website: Optional[str] = None
    phone_number: Optional[str] = None
    phone_number_verified: Optional[bool] = None
    gender: Optional[str] = None
    birthdate: Optional[str] = None
    zoneinfo: Optional[str] = None
    locale: Optional[str] = None
    updated_at: Optional[int] = None


class WellKnownConfiguration(BaseModel):
    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    userinfo_endpoint: str
    jwks_uri: str
    registration_endpoint: Optional[str] = None
    scopes_supported: List[str] = ["openid", "profile", "email"]
    response_types_supported: List[str] = ["code", "id_token", "token id_token"]
    grant_types_supported: List[str] = ["authorization_code", "refresh_token"]
    subject_types_supported: List[str] = ["public"]
    id_token_signing_alg_values_supported: List[str] = ["HS256", "RS256"]
    token_endpoint_auth_methods_supported: List[str] = ["client_secret_basic", "client_secret_post"]
    claims_supported: List[str] = [
        "sub", "iss", "auth_time", "name", "given_name", "family_name",
        "nickname", "email", "email_verified", "picture", "created_at",
        "updated_at", "aud", "exp", "iat", "nonce"
    ]
    code_challenge_methods_supported: List[str] = ["plain", "S256"]


# 权限管理相关 schemas
class PermissionBase(BaseModel):
    is_allowed: bool = False
    is_blocked: bool = False
    allowed_scopes: Optional[List[str]] = None
    denied_scopes: Optional[List[str]] = None
    approval_reason: Optional[str] = None
    expires_at: Optional[datetime] = None


class PermissionCreate(PermissionBase):
    user_id: str
    client_id: str


class PermissionUpdate(BaseModel):
    is_allowed: Optional[bool] = None
    is_blocked: Optional[bool] = None
    allowed_scopes: Optional[List[str]] = None
    denied_scopes: Optional[List[str]] = None
    approval_reason: Optional[str] = None
    expires_at: Optional[datetime] = None


class PermissionResponse(PermissionBase):
    id: str
    user_id: str
    client_id: str
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    # 关联对象
    user: Optional[UserResponse] = None
    client: Optional[ClientApplicationPublic] = None
    approver: Optional[UserResponse] = None

    class Config:
        from_attributes = True


class PermissionRequestBase(BaseModel):
    requested_scopes: List[str]
    request_reason: Optional[str] = None


class PermissionRequestCreate(PermissionRequestBase):
    client_id: str


class PermissionRequestUpdate(BaseModel):
    status: str  # approved, denied
    review_reason: Optional[str] = None


class PermissionRequestResponse(PermissionRequestBase):
    id: str
    user_id: str
    client_id: str
    status: str
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    review_reason: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    # 关联对象
    user: Optional[UserResponse] = None
    client: Optional[ClientApplicationPublic] = None
    reviewer: Optional[UserResponse] = None

    class Config:
        from_attributes = True


class PermissionCheckRequest(BaseModel):
    user_id: str
    client_id: str
    requested_scopes: List[str]


class PermissionCheckResponse(BaseModel):
    has_permission: bool
    allowed_scopes: List[str]
    denied_scopes: List[str]
    reason: Optional[str] = None
    requires_approval: bool = False