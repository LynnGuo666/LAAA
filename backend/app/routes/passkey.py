"""
Passkey/WebAuthn API routes
"""

import json
import logging
from typing import List, Union

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.middleware.auth import get_current_user, require_unrestricted
from app.models import Passkey, User
from app.schemas import TokenResponse, VerificationRequiredResponse
from app.schemas.passkey import (
    PasskeyAuthenticationOptionsRequest,
    PasskeyAuthenticationVerify,
    PasskeyCheckResponse,
    PasskeyDeleteRequest,
    PasskeyRegistrationVerify,
    PasskeyResponse,
    PasskeyUpdate,
)
from app.services.auth_service import AuthService
from app.services.geoip_service import GeoIPService
from app.services.passkey_service import PasskeyService
from app.services.risk_service import RiskLevel, RiskService
from app.services.verification_service import VerificationService
from app.utils.cookies import set_auth_cookies
from app.utils.device import get_client_ip
from app.utils.security import verify_password_async

settings = get_settings()
router = APIRouter(prefix="/api/passkeys", tags=["Passkeys"])

logger = logging.getLogger(__name__)


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
        credential_id=passkey.credential_id,
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
    # Check email verification
    if not current_user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="绑定通行密钥需要先验证邮箱"
        )

    try:
        options = PasskeyService.generate_registration_options(db, current_user)
        return options
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
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
    # Check email verification
    if not current_user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="绑定通行密钥需要先验证邮箱"
        )

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


@router.post("/authenticate/verify", response_model=Union[TokenResponse, VerificationRequiredResponse])
async def verify_authentication(
    data: PasskeyAuthenticationVerify,
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    """
    Verify authentication response and issue tokens.

    If suspicious activity is detected (unknown IP city or device), returns 202
    with verification requirements. Otherwise returns tokens directly.
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

        # Get geo info
        geo_info = GeoIPService.get_location(client_ip)
        city = geo_info.get("city") if geo_info else None

        # Assess risk for passkey login (lower risk than password)
        if settings.block_suspicious_login:
            risk_assessment = RiskService.assess_passkey_login_risk(
                db=db,
                user=user,
                city=city,
                device_token=data.device_token
            )

            # If risk detected, create verification session
            if risk_assessment.risk_level != RiskLevel.NONE:
                verification_session = VerificationService.create_verification_session(
                    db=db,
                    user=user,
                    risk_assessment=risk_assessment,
                    ip_address=client_ip,
                    user_agent=user_agent,
                    device_name=data.device_name or f"Passkey: {passkey.name}",
                    device_token=data.device_token,
                    remember_me=data.remember_me
                )

                # Get available verification methods
                available_methods = RiskService.get_available_methods(
                    user=user,
                    risk_level=risk_assessment.risk_level
                )

                # Record login log as pending verification
                AuthService.record_login_log(
                    db,
                    user=user,
                    username=user.username,
                    success=False,
                    failure_reason="pending_verification",
                    ip_address=client_ip,
                    user_agent=user_agent,
                    geo_info=geo_info,
                    login_method="passkey",
                    is_suspicious=True,
                    anomalies=[a.to_dict() for a in risk_assessment.anomalies]
                )

                # Return 202 with verification requirements
                return JSONResponse(
                    status_code=status.HTTP_202_ACCEPTED,
                    content={
                        "requires_verification": True,
                        "session_token": verification_session.session_token,
                        "risk_level": risk_assessment.risk_level.value,
                        "risk_score": risk_assessment.risk_score,
                        "required_verifications": risk_assessment.required_verifications,
                        "completed_verifications": 0,
                        "email_masked": RiskService.mask_email(user.email),
                        "available_methods": available_methods,
                        "anomalies": [a.to_dict() for a in risk_assessment.anomalies]
                    }
                )

        # No risk or risk detection disabled - create tokens directly
        # (复用上面已查的 geo_info,异常检测先算好传入,避免 create_tokens
        # 内二次 GeoIP 查询 + 异常检测——结果等价,参照 auth.py 密码登录)
        from app.services.login_anomaly_service import LoginAnomalyService

        login_anomalies = LoginAnomalyService.check_anomalies(
            db, user, client_ip, user_agent, geo_info
        )
        token_result = AuthService.create_tokens(
            db,
            user=user,
            client_id="internal",
            scope="profile email",
            remember_me=data.remember_me,
            device_name=data.device_name or f"Passkey: {passkey.name}",
            device_token=data.device_token,
            ip_address=client_ip,
            user_agent=user_agent,
            login_method="passkey",
            geo_info=geo_info,
            anomalies=login_anomalies,
        )

        # 与密码登录（auth.py /login）保持一致：签发 token 的同时设置
        # 认证 cookie（laaa_refresh / authorize_token），否则用户按 F5
        # 刷新页面后无法静默恢复会话，等于被登出。
        # is_restricted 用户与密码登录同语义：正常签发 token + cookie，
        # 前端经 /me 的 is_restricted 标记弹引导层（区别于 skip 的受限 claim）。
        set_auth_cookies(response, token_result["access_token"],
                         token_result["refresh_token"], remember_me=data.remember_me)

        return TokenResponse(
            access_token=token_result["access_token"],
            refresh_token=token_result["refresh_token"],
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
    data: PasskeyDeleteRequest,
    current_user: User = Depends(require_unrestricted),
    db: Session = Depends(get_db)
):
    """Delete a passkey.

    Requires password confirmation: a hijacked session could otherwise
    delete all of the victim's passkeys (2FA-grade credentials) without
    any re-authentication.
    """
    if not await verify_password_async(data.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="密码错误"
        )

    passkey = PasskeyService.get_passkey(db, passkey_id, current_user)
    if not passkey:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Passkey not found"
        )

    PasskeyService.delete_passkey(db, passkey)

    # 删除后账号可能不再有任何 2FA 因子(无 passkey 且无 TOTP)——
    # 日志留痕提醒,便于运维/用户察觉风险并引导重新绑定。
    remaining = db.query(Passkey).filter(Passkey.user_id == current_user.id).count()
    has_totp = current_user.totp is not None and current_user.totp.is_enabled
    if remaining == 0 and not has_totp:
        logger.warning(
            "User %s deleted their last passkey and has no TOTP enabled; "
            "account now has no second factor", current_user.id
        )

    return None
