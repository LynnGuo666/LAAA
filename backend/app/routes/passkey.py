"""
Passkey/WebAuthn API routes
"""

import json
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.schemas.passkey import (
    PasskeyRegistrationVerify,
    PasskeyAuthenticationOptionsRequest,
    PasskeyAuthenticationVerify,
    PasskeyUpdate,
    PasskeyResponse,
    PasskeyCheckResponse,
)
from app.schemas import TokenResponse
from app.services.passkey_service import PasskeyService
from app.services.auth_service import AuthService
from app.middleware.auth import get_current_user
from app.models import User, Passkey
from app.config import get_settings
from app.utils.device import get_client_ip

settings = get_settings()
router = APIRouter(prefix="/api/passkeys", tags=["Passkeys"])


def passkey_to_response(passkey: Passkey) -> PasskeyResponse:
    """Convert Passkey model to response schema"""
    transports = None
    if passkey.transports:
        try:
            transports = json.loads(passkey.transports)
        except json.JSONDecodeError:
            pass

    return PasskeyResponse(
        id=passkey.id,
        name=passkey.name,
        created_at=passkey.created_at,
        last_used_at=passkey.last_used_at,
        transports=transports,
        backup_eligible=passkey.backup_eligible or False,
        backup_state=passkey.backup_state or False,
        aaguid=passkey.aaguid,
    )


# ==================== Registration Flow ====================

@router.post("/register/options")
async def get_registration_options(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Generate WebAuthn registration options for authenticated user.
    Returns challenge, RP info, user info, excludeCredentials.
    """
    try:
        options = PasskeyService.generate_registration_options(db, current_user)
        return options
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate registration options: {str(e)}"
        )


@router.post("/register/verify", response_model=PasskeyResponse)
async def verify_registration(
    data: PasskeyRegistrationVerify,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Verify registration response and store credential.
    """
    try:
        # Convert schema to dict format expected by webauthn library
        credential_data = {
            "id": data.id,
            "rawId": data.rawId,
            "response": data.response,
            "type": data.type,
            "clientExtensionResults": data.clientExtensionResults or {},
            "authenticatorAttachment": data.authenticatorAttachment,
        }

        passkey = PasskeyService.verify_registration(
            db,
            current_user,
            credential_data,
            data.name
        )
        return passkey_to_response(passkey)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Registration verification failed: {str(e)}"
        )


# ==================== Authentication Flow ====================

@router.post("/authenticate/options")
async def get_authentication_options(
    data: PasskeyAuthenticationOptionsRequest,
    db: Session = Depends(get_db)
):
    """
    Generate WebAuthn authentication options.
    Can be called without authentication for passwordless login.
    """
    try:
        options = PasskeyService.generate_authentication_options(db, data.username)
        return options
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate authentication options: {str(e)}"
        )


@router.post("/authenticate/verify", response_model=TokenResponse)
async def verify_authentication(
    data: PasskeyAuthenticationVerify,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Verify authentication response and issue tokens.
    """
    try:
        # Convert schema to dict format expected by webauthn library
        credential_data = {
            "id": data.id,
            "rawId": data.rawId,
            "response": data.response,
            "type": data.type,
            "clientExtensionResults": data.clientExtensionResults or {},
            "authenticatorAttachment": data.authenticatorAttachment,
        }

        user, passkey = PasskeyService.verify_authentication(db, credential_data)

        # Get client info
        client_ip = get_client_ip(request)
        user_agent = request.headers.get("user-agent", "")

        # Create tokens (same as password login)
        access_token, refresh_token = AuthService.create_tokens(
            db,
            user=user,
            client_id="internal",
            scope="profile email",
            remember_me=data.remember_me,
            device_name=data.device_name or f"Passkey: {passkey.name}",
            ip_address=client_ip,
            user_agent=user_agent
        )

        return TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer",
            expires_in=settings.access_token_expire_minutes * 60
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Authentication verification failed: {str(e)}"
        )


# ==================== Management ====================

@router.get("/", response_model=List[PasskeyResponse])
async def list_passkeys(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all passkeys for current user"""
    passkeys = PasskeyService.list_passkeys(db, current_user)
    return [passkey_to_response(p) for p in passkeys]


@router.get("/check/{username}", response_model=PasskeyCheckResponse)
async def check_user_passkeys(
    username: str,
    db: Session = Depends(get_db)
):
    """Check if a user has passkeys registered (public endpoint)"""
    user = db.query(User).filter(User.username == username).first()
    if not user:
        return PasskeyCheckResponse(has_passkeys=False, count=0)

    count = db.query(Passkey).filter(Passkey.user_id == user.id).count()
    return PasskeyCheckResponse(has_passkeys=count > 0, count=count)


@router.put("/{passkey_id}", response_model=PasskeyResponse)
async def update_passkey(
    passkey_id: int,
    data: PasskeyUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Rename a passkey"""
    passkey = PasskeyService.get_passkey(db, passkey_id, current_user)
    if not passkey:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Passkey not found"
        )

    passkey = PasskeyService.update_passkey(db, passkey, data.name)
    return passkey_to_response(passkey)


@router.delete("/{passkey_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_passkey(
    passkey_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a passkey"""
    passkey = PasskeyService.get_passkey(db, passkey_id, current_user)
    if not passkey:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Passkey not found"
        )

    PasskeyService.delete_passkey(db, passkey)
    return None
