from pydantic import BaseModel, EmailStr, Field, field_validator, ConfigDict
from typing import Optional, List, Any, Dict
from datetime import datetime
import string


def _validate_password_strength(v: str) -> str:
    """密码强度校验:长度 12-72,且至少包含大写/小写/数字/特殊字符中的 3 类。

    注册和改密共用。登录端点不调用(登录不应因复杂度拒绝)。
    """
    if len(v) < 12:
        raise ValueError("密码至少 12 个字符")
    if len(v) > 72:
        raise ValueError("密码不能超过 72 个字符")
    categories = sum([
        any(c.islower() for c in v),
        any(c.isupper() for c in v),
        any(c.isdigit() for c in v),
        any(c in string.punctuation for c in v),
    ])
    if categories < 3:
        raise ValueError("密码需包含大写、小写、数字、特殊字符中至少 3 类")
    return v


# User Schemas
class UserBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr


class UserCreate(UserBase):
    password: str = Field(..., min_length=12, max_length=72)
    invite_code: Optional[str] = Field(None, min_length=4, max_length=64)

    @field_validator("password")
    @classmethod
    def _check_password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    avatar: Optional[str] = None


class UserResponse(UserBase):
    id: int
    avatar: Optional[str] = None
    status: str
    email_verified: bool = False
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserMeResponse(UserResponse):
    groups: List[str] = []
    roles: List[str] = []
    permissions: List[str] = []
    is_admin: bool = False
    is_restricted: bool = False  # 受限模式：需要完成邮箱验证 + 二次验证


# Auth Schemas
class LoginRequest(BaseModel):
    username: str
    password: str
    remember_me: bool = False
    device_name: Optional[str] = None
    device_token: Optional[str] = None  # Device token from localStorage for device identification


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class TokenResponseExtended(TokenResponse):
    """Extended token response with security information"""
    kicked_session: Optional[Dict[str, Any]] = None  # Info about kicked session if any
    is_suspicious: bool = False  # Whether login is suspicious
    anomalies: List[Dict[str, Any]] = []  # List of detected anomalies


class RefreshTokenRequest(BaseModel):
    refresh_token: str
    client_id: Optional[str] = None
    client_secret: Optional[str] = None


# Client Schemas
class ClientBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    logo: Optional[str] = None
    website_url: Optional[str] = Field(None, max_length=500)
    redirect_uris: List[str]
    allowed_scopes: List[str]
    trusted: bool = False
    default_access: bool = False


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    logo: Optional[str] = None
    website_url: Optional[str] = Field(None, max_length=500)
    redirect_uris: Optional[List[str]] = None
    allowed_scopes: Optional[List[str]] = None
    trusted: Optional[bool] = None
    default_access: Optional[bool] = None


class ClientResponse(ClientBase):
    id: int
    client_id: str
    owner_id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ClientWithSecretResponse(ClientResponse):
    client_secret: str  # Only returned once when created


class ClientPublicResponse(BaseModel):
    id: int
    client_id: str
    name: str
    description: Optional[str] = None
    logo: Optional[str] = None
    website_url: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


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

    model_config = ConfigDict(from_attributes=True)


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
    # New fields for security
    country: Optional[str] = None
    city: Optional[str] = None
    is_trusted: bool = False

    model_config = ConfigDict(from_attributes=True)


# Role and Permission
class RoleResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]

    model_config = ConfigDict(from_attributes=True)


class PermissionResponse(BaseModel):
    id: int
    code: str
    name: str
    description: Optional[str]

    model_config = ConfigDict(from_attributes=True)


# Login History and Security Settings
class LoginLogResponse(BaseModel):
    """Login log entry for security audit"""
    id: int
    success: bool
    failure_reason: Optional[str] = None
    ip_address: Optional[str] = None
    device_type: Optional[str] = None
    device_name: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    is_suspicious: bool = False
    login_method: str = "password"
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SecuritySettingsResponse(BaseModel):
    """User security settings"""
    max_sessions: int
    notify_new_login: bool


class SecuritySettingsUpdate(BaseModel):
    """Update user security settings"""
    max_sessions: Optional[int] = Field(None, ge=1, le=10)
    notify_new_login: Optional[bool] = None


class KickedSessionsResponse(BaseModel):
    """Response for kick all other sessions"""
    kicked_count: int
    kicked_sessions: List[Dict[str, Any]]


class ChangePasswordRequest(BaseModel):
    """Request to change user password"""
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=12, max_length=72)

    @field_validator("new_password")
    @classmethod
    def _check_new_password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


# Verification Schemas (Risk-based Multi-step Verification)
class VerificationMethodInfo(BaseModel):
    """Information about an available verification method"""
    method: str  # email_code, magic_link, totp, passkey
    strength: str  # standard, strong
    available: bool = True  # Whether user can use this method


class AnomalyInfo(BaseModel):
    """Information about a detected anomaly"""
    type: str
    score: int
    message: str


class VerificationRequiredResponse(BaseModel):
    """Response when verification is required (202)"""
    requires_verification: bool = True
    session_token: str
    risk_level: str  # low, medium, high
    risk_score: int
    required_verifications: int
    completed_verifications: int
    email_masked: str
    available_methods: List[VerificationMethodInfo]
    anomalies: List[AnomalyInfo]


class VerificationStatusResponse(BaseModel):
    """Current verification session status"""
    session_token: str
    risk_level: str
    required_verifications: int
    completed_verifications: int
    completed_methods: List[str]
    remaining_methods: List[VerificationMethodInfo]
    is_complete: bool
    expires_at: str


class VerificationCompleteResponse(BaseModel):
    """Response when verification is complete"""
    verification_complete: bool = True
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class SendEmailCodeRequest(BaseModel):
    """Request to send email verification code"""
    session_token: str


class VerifyEmailCodeRequest(BaseModel):
    """Request to verify email code"""
    session_token: str
    code: str = Field(..., min_length=6, max_length=6)


class VerifyTOTPRequest(BaseModel):
    """Request to verify TOTP code"""
    session_token: str
    code: str = Field(..., min_length=6, max_length=6)


class VerifyBackupCodeRequest(BaseModel):
    """Request to verify backup code"""
    session_token: str
    code: str = Field(..., min_length=8, max_length=8)


class SendMagicLinkRequest(BaseModel):
    """Request to send magic link"""
    session_token: str


class MagicLinkLoginRequest(BaseModel):
    """Request for magic link independent login"""
    email: EmailStr


class PasskeyVerifyRequest(BaseModel):
    """Request to start passkey verification"""
    session_token: str


class PasskeyVerifyCompleteRequest(BaseModel):
    """Request to complete passkey verification"""
    session_token: str
    credential: Dict[str, Any]


# TOTP Schemas
class TOTPSetupResponse(BaseModel):
    """Response for TOTP setup initiation"""
    secret: str
    provisioning_uri: str
    qr_code: str  # Base64 encoded QR code image


class TOTPVerifySetupRequest(BaseModel):
    """Request to verify and enable TOTP"""
    code: str = Field(..., min_length=6, max_length=6)


class TOTPEnableResponse(BaseModel):
    """Response after TOTP is enabled"""
    enabled: bool = True
    backup_codes: List[str]


class TOTPStatusResponse(BaseModel):
    """TOTP status for a user"""
    enabled: bool
    name: Optional[str] = None
    backup_codes_remaining: int
    last_used_at: Optional[str] = None


class TOTPDisableRequest(BaseModel):
    """Request to disable TOTP"""
    password: str


class TOTPBackupCodesRequest(BaseModel):
    """Request to view/regenerate backup codes"""
    password: str


class TOTPBackupCodesResponse(BaseModel):
    """Response with backup codes"""
    backup_codes: List[str]


class SkipVerificationRequest(BaseModel):
    """Request to skip verification and enter restricted mode"""
    session_token: str


class ChangeEmailRequest(BaseModel):
    """Request to change user email"""
    new_email: EmailStr
