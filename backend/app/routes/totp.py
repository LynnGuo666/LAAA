"""
TOTP (Two-Factor Authentication) API Routes

Provides endpoints for setting up and managing TOTP authentication.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models import User
from app.schemas import (
    TOTPBackupCodesRequest,
    TOTPBackupCodesResponse,
    TOTPDisableRequest,
    TOTPEnableResponse,
    TOTPSetupResponse,
    TOTPStatusResponse,
    TOTPVerifySetupRequest,
)
from app.services.totp_service import (
    InvalidTOTPCodeError,
    TOTPAlreadyEnabledError,
    TOTPNotEnabledError,
    TOTPSecretCorruptedError,
    TOTPService,
)
from app.utils.security import verify_password

router = APIRouter(prefix="/api/totp", tags=["TOTP"])


@router.get("/status", response_model=TOTPStatusResponse)
async def get_totp_status(
    current_user: User = Depends(get_current_user)
):
    """Get TOTP status for current user"""
    status_data = TOTPService.get_totp_status(current_user)
    return TOTPStatusResponse(**status_data)


@router.post("/setup", response_model=TOTPSetupResponse)
async def setup_totp(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Start TOTP setup process.

    Returns the secret, provisioning URI, and QR code.
    User must verify with a code before TOTP is enabled.
    """
    try:
        secret, uri, qr_code = TOTPService.setup_totp(db, current_user)
        return TOTPSetupResponse(
            secret=secret,
            provisioning_uri=uri,
            qr_code=qr_code
        )
    except TOTPAlreadyEnabledError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="TOTP 已启用，请先禁用后再重新设置"
        )


@router.post("/verify-setup", response_model=TOTPEnableResponse)
async def verify_totp_setup(
    request_data: TOTPVerifySetupRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Verify TOTP code and enable TOTP.

    Returns backup codes that user should save securely.
    """
    try:
        backup_codes = TOTPService.verify_and_enable_totp(
            db, current_user, request_data.code
        )
        return TOTPEnableResponse(
            enabled=True,
            backup_codes=backup_codes
        )
    except TOTPNotEnabledError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请先调用 /setup 开始设置流程"
        )
    except TOTPAlreadyEnabledError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="TOTP 已启用"
        )
    except InvalidTOTPCodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码错误，请检查时间同步"
        )
    except TOTPSecretCorruptedError:
        # 密钥已损坏并被自动清除——调用方需重新走 /setup 流程
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="TOTP 密钥已损坏，请重新设置"
        )


@router.delete("")
async def disable_totp(
    request_data: TOTPDisableRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Disable TOTP for current user.

    Requires password verification.
    """
    # Verify password
    if not verify_password(request_data.password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="密码错误"
        )

    try:
        TOTPService.disable_totp(db, current_user)
        return {"message": "TOTP 已禁用"}
    except TOTPNotEnabledError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="TOTP 未启用"
        )


@router.post("/backup-codes", response_model=TOTPBackupCodesResponse)
async def regenerate_backup_codes(
    request_data: TOTPBackupCodesRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Regenerate backup codes.

    Old backup codes will be invalidated.
    Requires password verification.
    """
    # Verify password
    if not verify_password(request_data.password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="密码错误"
        )

    try:
        backup_codes = TOTPService.regenerate_backup_codes(db, current_user)
        return TOTPBackupCodesResponse(backup_codes=backup_codes)
    except TOTPNotEnabledError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="TOTP 未启用"
        )
