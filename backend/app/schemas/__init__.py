from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime


# User Schemas
class UserBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr


class UserCreate(UserBase):
    password: str = Field(..., min_length=6)
    invite_code: Optional[str] = Field(None, min_length=4, max_length=64)


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    avatar: Optional[str] = None


class UserResponse(UserBase):
    id: int
    avatar: Optional[str] = None
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class UserMeResponse(UserResponse):
    groups: List[str] = []
    roles: List[str] = []
    permissions: List[str] = []
    is_admin: bool = False


# Auth Schemas
class LoginRequest(BaseModel):
    username: str
    password: str
    remember_me: bool = False
    device_name: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class RefreshTokenRequest(BaseModel):
    refresh_token: str
    client_id: Optional[str] = None
    client_secret: Optional[str] = None


# Client Schemas
class ClientBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    logo: Optional[str] = None
    redirect_uris: List[str]
    allowed_scopes: List[str]
    trusted: bool = False


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    logo: Optional[str] = None
    redirect_uris: Optional[List[str]] = None
    allowed_scopes: Optional[List[str]] = None
    trusted: Optional[bool] = None


class ClientResponse(ClientBase):
    id: int
    client_id: str
    owner_id: int
    created_at: datetime

    class Config:
        from_attributes = True


class ClientWithSecretResponse(ClientResponse):
    client_secret: str  # Only returned once when created


class ClientSecretResetResponse(BaseModel):
    client_id: str
    client_secret: str


# OAuth Schemas
class AuthorizationRequest(BaseModel):
    response_type: str = Field(..., pattern="^code$")  # Only support 'code' for now
    client_id: str
    redirect_uri: str
    scope: str = "profile"
    state: Optional[str] = None


class AuthorizationResponse(BaseModel):
    code: str
    state: Optional[str] = None


class TokenRequest(BaseModel):
    grant_type: str  # authorization_code, refresh_token, password
    code: Optional[str] = None  # For authorization_code
    redirect_uri: Optional[str] = None  # For authorization_code
    refresh_token: Optional[str] = None  # For refresh_token
    username: Optional[str] = None  # For password
    password: Optional[str] = None  # For password
    client_id: str
    client_secret: str
    scope: Optional[str] = None


class UserInfoResponse(BaseModel):
    sub: str  # user id
    username: str
    email: str
    avatar: Optional[str] = None


# Authorization Management
class AuthorizationListItem(BaseModel):
    id: int
    client_name: str
    client_logo: Optional[str]
    scope: str
    created_at: datetime
    last_used_at: datetime

    class Config:
        from_attributes = True


# Session Management
class SessionResponse(BaseModel):
    id: int
    device_id: str
    device_name: Optional[str]
    device_type: Optional[str]
    ip_address: Optional[str]
    last_active: datetime
    expires_at: datetime
    is_current: bool = False

    class Config:
        from_attributes = True


# Role and Permission
class RoleResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]

    class Config:
        from_attributes = True


class PermissionResponse(BaseModel):
    id: int
    code: str
    name: str
    description: Optional[str]

    class Config:
        from_attributes = True
