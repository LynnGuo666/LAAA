"""
Passkey/WebAuthn schemas
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime


# ==================== Request Schemas ====================

class PasskeyRegistrationVerify(BaseModel):
    """Verify passkey registration"""
    id: str  # credential.id (Base64URL)
    rawId: str  # credential.rawId (Base64URL)
    response: dict  # AuthenticatorAttestationResponse
    type: str = "public-key"
    clientExtensionResults: Optional[dict] = None
    authenticatorAttachment: Optional[str] = None
    name: str = Field(..., min_length=1, max_length=100)  # User-provided name


class PasskeyAuthenticationOptionsRequest(BaseModel):
    """Request authentication options"""
    username: Optional[str] = None  # Optional for discoverable credentials


class PasskeyAuthenticationVerify(BaseModel):
    """Verify passkey authentication"""
    id: str  # credential.id (Base64URL)
    rawId: str  # credential.rawId (Base64URL)
    response: dict  # AuthenticatorAssertionResponse
    type: str = "public-key"
    clientExtensionResults: Optional[dict] = None
    authenticatorAttachment: Optional[str] = None
    remember_me: bool = False
    device_name: Optional[str] = None
    device_token: Optional[str] = None  # Device token from localStorage for device identification


class PasskeyUpdate(BaseModel):
    """Update passkey (rename)"""
    name: str = Field(..., min_length=1, max_length=100)


# ==================== Response Schemas ====================

class PasskeyResponse(BaseModel):
    """Passkey info response"""
    id: int
    name: str
    credential_id: str  # Base64URL encoded credential ID
    created_at: datetime
    last_used_at: Optional[datetime] = None
    transports: Optional[List[str]] = None
    backup_eligible: bool = False
    backup_state: bool = False
    aaguid: Optional[str] = None

    class Config:
        from_attributes = True


class PasskeyCheckResponse(BaseModel):
    """Check if user has passkeys"""
    has_passkeys: bool
    count: int
