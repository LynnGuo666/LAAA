from typing import Union

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models import Passkey, User
from app.schemas import (
    ChangeEmailRequest,
    LoginRequest,
    MagicLinkLoginRequest,
    PasskeyVerifyCompleteRequest,
    PasskeyVerifyRequest,
    RefreshTokenRequest,
    SendEmailCodeRequest,
    SendMagicLinkRequest,
    SkipVerificationRequest,
    TokenResponse,
    TokenResponseExtended,
    UserCreate,
    UserMeResponse,
    UserResponse,
    VerificationCompleteResponse,
    VerificationRequiredResponse,
    VerifyBackupCodeRequest,
    VerifyEmailCodeRequest,
    VerifyTOTPRequest,
)
from app.services.auth_service import AuthService
from app.services.email_service import EmailService
from app.services.geoip_service import GeoIPService
from app.services.risk_service import RiskLevel, RiskService
from app.services.totp_service import (
    InvalidBackupCodeError,
    InvalidTOTPCodeError,
    TOTPNotEnabledError,
    TOTPService,
)
from app.services.verification_service import (
    CodeExpiredError,
    CodeInvalidError,
    DeviceMismatchError,
    MaxAttemptsError,
    VerificationError,
    VerificationService,
)
from app.utils.device import get_client_ip
from app.utils.time import utcnow

settings = get_settings()
router = APIRouter(prefix="/api/auth", tags=["Authentication"])


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(user_data: UserCreate, db: Session = Depends(get_db)):
    """Register a new user"""
    try:
        user = AuthService.register_user(
            db,
            username=user_data.username,
            email=user_data.email,
            password=user_data.password,
            invite_code=getattr(user_data, "invite_code", None),
        )

        # Send verification email (non-blocking)
        try:
            import asyncio
            import secrets
            from datetime import timedelta

            from app.models import VerificationCode
            from app.services.site_service import SiteService

            # Generate verification token
            token = secrets.token_urlsafe(32)
            now = utcnow()

            # Create verification code record
            verification_code = VerificationCode(
                user_id=user.id,
                token=token,
                purpose="email_verification",
                expires_at=now + timedelta(hours=24),
                max_attempts=1
            )
            db.add(verification_code)
            db.commit()

            # Generate verification link
            verification_link = f"{settings.frontend_url}/verify-email?token={token}"

            # Get site name
            site_name = SiteService.get_site_name(db)

            # Send email asynchronously
            asyncio.create_task(
                EmailService.send_email_verification(
                    to_email=user.email,
                    username=user.username,
                    link=verification_link,
                    expire_hours=24,
                    site_name=site_name
                )
            )
        except Exception as e:
            # Don't fail registration if email sending fails
            import logging
            logging.getLogger(__name__).warning(f"Failed to send verification email: {e}")

        return user
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/login", response_model=Union[TokenResponseExtended, VerificationRequiredResponse])
async def login(
    login_data: LoginRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Login and get access token.

    If suspicious activity is detected, returns 202 with verification requirements.
    Otherwise returns 200 with tokens.
    """
    # Get client info
    client_ip = get_client_ip(request)
    user_agent = request.headers.get("user-agent", "")

    # Get geo info
    geo_info = GeoIPService.get_location(client_ip)
    city = geo_info.get("city") if geo_info else None
    country = geo_info.get("country") if geo_info else None

    # Authenticate user
    user, failure_reason = AuthService.authenticate_user(
        db, login_data.username, login_data.password,
        ip_address=client_ip, user_agent=user_agent
    )

    if not user:
        # Record failed login attempt
        AuthService.record_login_log(
            db,
            user=None,
            username=login_data.username,
            success=False,
            failure_reason=failure_reason,
            ip_address=client_ip,
            user_agent=user_agent,
            geo_info=geo_info
        )

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password"
        )

    # Assess risk for password login
    if settings.block_suspicious_login:
        risk_assessment = RiskService.assess_password_login_risk(
            db=db,
            user=user,
            ip_address=client_ip,
            city=city,
            country=country,
            device_token=login_data.device_token
        )

        # If risk detected, create verification session
        if risk_assessment.risk_level != RiskLevel.NONE:
            verification_session = VerificationService.create_verification_session(
                db=db,
                user=user,
                risk_assessment=risk_assessment,
                ip_address=client_ip,
                user_agent=user_agent,
                device_name=login_data.device_name,
                device_token=login_data.device_token,
                remember_me=login_data.remember_me
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
                username=login_data.username,
                success=False,
                failure_reason="pending_verification",
                ip_address=client_ip,
                user_agent=user_agent,
                geo_info=geo_info,
                login_method="password",
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
    result = AuthService.create_tokens(
        db,
        user=user,
        client_id="internal",
        scope="profile email",
        remember_me=login_data.remember_me,
        device_name=login_data.device_name,
        device_token=login_data.device_token,
        ip_address=client_ip,
        user_agent=user_agent,
        login_method="password"
    )

    return TokenResponseExtended(
        access_token=result["access_token"],
        refresh_token=result["refresh_token"],
        token_type="bearer",
        expires_in=settings.access_token_expire_minutes * 60,
        kicked_session=result.get("kicked_session"),
        is_suspicious=result.get("is_suspicious", False),
        anomalies=result.get("anomalies", [])
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(refresh_data: RefreshTokenRequest, db: Session = Depends(get_db)):
    """Refresh access token"""
    result = AuthService.refresh_access_token(
        db,
        refresh_data.refresh_token,
        client_id=refresh_data.client_id,
        client_secret=refresh_data.client_secret
    )
    if not result:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token"
        )

    access_token, refresh_token = result

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=settings.access_token_expire_minutes * 60
    )


@router.post("/logout")
async def logout(
    refresh_data: RefreshTokenRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Logout user"""
    AuthService.logout(db, refresh_data.refresh_token)
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserMeResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get current user information"""
    permissions = sorted({p.code for r in current_user.roles for p in r.permissions})
    roles = sorted({r.name for r in current_user.roles})
    groups = sorted({g.name for g in current_user.groups})

    # Calculate is_restricted: need email_verified AND (totp OR passkey)
    has_totp = current_user.totp is not None and current_user.totp.is_enabled
    passkey_count = db.query(Passkey).filter(Passkey.user_id == current_user.id).count()
    is_restricted = not (
        current_user.email_verified
        and (has_totp or passkey_count > 0)
    )

    return UserMeResponse(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        email_verified=current_user.email_verified,
        avatar=current_user.avatar,
        status=current_user.status,
        created_at=current_user.created_at,
        groups=groups,
        roles=roles,
        permissions=permissions,
        is_admin=current_user.has_permission("admin.*") or current_user.has_role("admin"),
        is_restricted=is_restricted,
    )


# =============================================================================
# Verification Endpoints (Risk-based Multi-step Verification)
# =============================================================================

def _get_valid_verification_session(db: Session, session_token: str):
    """Helper to get and validate a verification session"""
    verification_session = VerificationService.get_verification_session(db, session_token)
    if not verification_session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="验证会话不存在"
        )
    if not VerificationService.validate_session(verification_session):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="验证会话已过期"
        )
    return verification_session


def _finalize_login(db: Session, verification_session, user: User) -> VerificationCompleteResponse:
    """Helper to finalize login after verification is complete"""
    # Create tokens
    result = AuthService.create_tokens(
        db,
        user=user,
        client_id="internal",
        scope="profile email",
        remember_me=verification_session.remember_me,
        device_name=verification_session.device_name,
        device_token=verification_session.device_token,
        ip_address=verification_session.ip_address,
        user_agent=verification_session.user_agent,
        login_method="password"
    )

    # Record successful login
    geo_info = GeoIPService.get_location(verification_session.ip_address)
    AuthService.record_login_log(
        db,
        user=user,
        username=user.username,
        success=True,
        ip_address=verification_session.ip_address,
        user_agent=verification_session.user_agent,
        geo_info=geo_info,
        login_method="password",
        is_suspicious=False
    )

    return VerificationCompleteResponse(
        verification_complete=True,
        access_token=result["access_token"],
        refresh_token=result["refresh_token"],
        token_type="bearer",
        expires_in=settings.access_token_expire_minutes * 60
    )


@router.get("/verify/status/{session_token}")
async def get_verification_status(
    session_token: str,
    db: Session = Depends(get_db)
):
    """Get current verification session status"""
    verification_session = _get_valid_verification_session(db, session_token)

    user = db.query(User).filter(User.id == verification_session.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    return VerificationService.get_session_status(user, verification_session)


@router.post("/verify/email-code/send")
async def send_email_verification_code(
    request_data: SendEmailCodeRequest,
    db: Session = Depends(get_db)
):
    """Send email verification code"""
    verification_session = _get_valid_verification_session(db, request_data.session_token)

    try:
        await VerificationService.create_email_code(db, verification_session, send_email=True)
        return {"message": "验证码已发送"}
    except VerificationError as e:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(e)
        )


@router.post("/verify/email-code")
async def verify_email_code(
    request_data: VerifyEmailCodeRequest,
    db: Session = Depends(get_db)
):
    """Verify email verification code"""
    verification_session = _get_valid_verification_session(db, request_data.session_token)

    try:
        VerificationService.verify_email_code(db, verification_session, request_data.code)
    except CodeExpiredError:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="验证码已过期"
        )
    except CodeInvalidError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except MaxAttemptsError:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="验证码尝试次数已达上限"
        )

    # Mark verification step as complete
    is_complete = VerificationService.complete_verification_step(
        db, verification_session, "email_code"
    )

    if is_complete:
        user = db.query(User).filter(User.id == verification_session.user_id).first()
        return _finalize_login(db, verification_session, user)

    # Return updated status
    user = db.query(User).filter(User.id == verification_session.user_id).first()
    return VerificationService.get_session_status(user, verification_session)


@router.post("/verify/totp")
async def verify_totp(
    request_data: VerifyTOTPRequest,
    db: Session = Depends(get_db)
):
    """Verify TOTP code"""
    verification_session = _get_valid_verification_session(db, request_data.session_token)

    user = db.query(User).filter(User.id == verification_session.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    try:
        TOTPService.verify_totp_code(db, user, request_data.code)
    except TOTPNotEnabledError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="TOTP 未启用"
        )
    except InvalidTOTPCodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码错误"
        )

    # Mark verification step as complete
    is_complete = VerificationService.complete_verification_step(
        db, verification_session, "totp"
    )

    if is_complete:
        return _finalize_login(db, verification_session, user)

    return VerificationService.get_session_status(user, verification_session)


@router.post("/verify/backup-code")
async def verify_backup_code(
    request_data: VerifyBackupCodeRequest,
    db: Session = Depends(get_db)
):
    """Verify TOTP backup code"""
    verification_session = _get_valid_verification_session(db, request_data.session_token)

    user = db.query(User).filter(User.id == verification_session.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    try:
        TOTPService.verify_backup_code(db, user, request_data.code)
    except TOTPNotEnabledError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="TOTP 未启用"
        )
    except InvalidBackupCodeError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

    # Mark verification step as complete (counts as TOTP)
    is_complete = VerificationService.complete_verification_step(
        db, verification_session, "totp"
    )

    if is_complete:
        return _finalize_login(db, verification_session, user)

    return VerificationService.get_session_status(user, verification_session)


@router.post("/verify/magic-link/send")
async def send_magic_link(
    request_data: SendMagicLinkRequest,
    response: Response,
    db: Session = Depends(get_db)
):
    """Send magic link email for verification"""
    verification_session = _get_valid_verification_session(db, request_data.session_token)

    user = db.query(User).filter(User.id == verification_session.user_id).first()
    if not user or not user.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户邮箱不可用"
        )

    # Generate device token for magic link binding
    import secrets
    device_token = secrets.token_urlsafe(32)

    # Create magic link
    verification_code, token = await VerificationService.create_magic_link(
        db=db,
        verification_session=verification_session,
        user=user,
        device_token=device_token,
        purpose="magic_link"
    )

    # Build magic link URL
    magic_link_url = f"{settings.frontend_url}/login/magic-link?token={token}&session={request_data.session_token}"

    # Send email
    await EmailService.send_magic_link(
        to_email=user.email,
        username=user.username,
        link=magic_link_url,
        expire_minutes=settings.magic_link_expire_minutes
    )

    # Set device token in HttpOnly cookie for verification
    response.set_cookie(
        key="magic_link_device",
        value=device_token,
        max_age=settings.magic_link_expire_minutes * 60,
        httponly=True,
        secure=True,
        samesite="strict"
    )

    return {"message": "验证链接已发送到您的邮箱"}


@router.get("/verify/magic-link/{token}")
async def verify_magic_link(
    token: str,
    session: str,
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    """Verify magic link token"""
    verification_session = _get_valid_verification_session(db, session)

    # Get device token from cookie
    device_token = request.cookies.get("magic_link_device")

    try:
        verification_code, device_matched = await VerificationService.verify_magic_link(
            db, token, device_token
        )
    except CodeExpiredError:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="链接已过期"
        )
    except CodeInvalidError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except DeviceMismatchError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="请在同一设备上验证链接"
        )

    # Clear the cookie
    response.delete_cookie("magic_link_device")

    # Mark verification step as complete
    is_complete = VerificationService.complete_verification_step(
        db, verification_session, "magic_link"
    )

    if is_complete:
        user = db.query(User).filter(User.id == verification_session.user_id).first()
        return _finalize_login(db, verification_session, user)

    user = db.query(User).filter(User.id == verification_session.user_id).first()
    return VerificationService.get_session_status(user, verification_session)


# =============================================================================
# Magic Link Independent Login
# =============================================================================

@router.post("/magic-link/login")
async def magic_link_login_send(
    request_data: MagicLinkLoginRequest,
    response: Response,
    db: Session = Depends(get_db)
):
    """Request magic link for independent login (no password)"""
    # Find user by email
    user = db.query(User).filter(User.email == request_data.email).first()
    if not user:
        # Don't reveal if user exists
        return {"message": "如果该邮箱已注册，我们已发送登录链接"}

    if user.status != "active":
        return {"message": "如果该邮箱已注册，我们已发送登录链接"}

    # Generate device token for magic link binding
    import secrets
    device_token = secrets.token_urlsafe(32)

    # Create magic link (no verification session)
    verification_code, token = await VerificationService.create_magic_link(
        db=db,
        verification_session=None,
        user=user,
        device_token=device_token,
        purpose="magic_link_login"
    )

    # Build magic link URL
    magic_link_url = f"{settings.frontend_url}/login/magic-link?token={token}"

    # Send email
    await EmailService.send_magic_link(
        to_email=user.email,
        username=user.username,
        link=magic_link_url,
        expire_minutes=settings.magic_link_expire_minutes
    )

    # Set device token in HttpOnly cookie
    response.set_cookie(
        key="magic_link_device",
        value=device_token,
        max_age=settings.magic_link_expire_minutes * 60,
        httponly=True,
        secure=True,
        samesite="strict"
    )

    return {"message": "如果该邮箱已注册，我们已发送登录链接"}


@router.get("/magic-link/login/{token}")
async def magic_link_login_verify(
    token: str,
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    """Verify magic link for independent login"""
    # Get device token from cookie
    device_token = request.cookies.get("magic_link_device")

    try:
        verification_code, device_matched = await VerificationService.verify_magic_link(
            db, token, device_token
        )
    except CodeExpiredError:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="链接已过期"
        )
    except CodeInvalidError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except DeviceMismatchError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="请在同一设备上验证链接"
        )

    # Clear the cookie
    response.delete_cookie("magic_link_device")

    # Get user
    user = db.query(User).filter(User.id == verification_code.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    # Get client info
    client_ip = get_client_ip(request)
    user_agent = request.headers.get("user-agent", "")

    # Create tokens
    result = AuthService.create_tokens(
        db,
        user=user,
        client_id="internal",
        scope="profile email",
        remember_me=False,
        device_name=None,
        device_token=None,
        ip_address=client_ip,
        user_agent=user_agent,
        login_method="magic_link"
    )

    # Record successful login
    geo_info = GeoIPService.get_location(client_ip)
    AuthService.record_login_log(
        db,
        user=user,
        username=user.username,
        success=True,
        ip_address=client_ip,
        user_agent=user_agent,
        geo_info=geo_info,
        login_method="magic_link"
    )

    return VerificationCompleteResponse(
        verification_complete=True,
        access_token=result["access_token"],
        refresh_token=result["refresh_token"],
        token_type="bearer",
        expires_in=settings.access_token_expire_minutes * 60
    )


# =============================================================================
# Passkey Verification (as verification method)
# =============================================================================

@router.post("/verify/passkey/start")
async def start_passkey_verification(
    request_data: PasskeyVerifyRequest,
    db: Session = Depends(get_db)
):
    """Start passkey verification (get authentication options)"""
    verification_session = _get_valid_verification_session(db, request_data.session_token)

    user = db.query(User).filter(User.id == verification_session.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    if not user.passkeys:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="未绑定通行密钥"
        )

    # Import passkey service
    from app.services.passkey_service import PasskeyService

    # Generate authentication options for this specific user
    options = PasskeyService.generate_authentication_options(db, user.username)

    return {
        "session_token": request_data.session_token,
        "options": options
    }


@router.post("/verify/passkey/complete")
async def complete_passkey_verification(
    request_data: PasskeyVerifyCompleteRequest,
    db: Session = Depends(get_db)
):
    """Complete passkey verification"""
    verification_session = _get_valid_verification_session(db, request_data.session_token)

    user = db.query(User).filter(User.id == verification_session.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    # Import passkey service
    from app.services.passkey_service import PasskeyService

    # Verify the passkey credential
    try:
        verified_user, passkey = PasskeyService.verify_authentication(
            db, request_data.credential
        )
        # Verify the passkey belongs to the expected user
        if verified_user.id != user.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="通行密钥不属于此用户"
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"通行密钥验证失败: {str(e)}"
        )

    # Mark verification step as complete
    is_complete = VerificationService.complete_verification_step(
        db, verification_session, "passkey"
    )

    if is_complete:
        return _finalize_login(db, verification_session, user)

    return VerificationService.get_session_status(user, verification_session)


# ==================== Email Verification Endpoints ====================

@router.post("/send-verification-email")
async def send_verification_email(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send email verification link to the user's email address"""
    if current_user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="邮箱已验证"
        )

    # Check rate limiting (max 5 per day, 60s between sends)
    from datetime import timedelta

    from app.models import VerificationCode

    now = utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Count today's verification emails
    today_count = db.query(VerificationCode).filter(
        VerificationCode.user_id == current_user.id,
        VerificationCode.purpose == "email_verification",
        VerificationCode.created_at >= today_start
    ).count()

    if today_count >= 5:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="今日邮箱验证邮件发送次数已达上限，请明天再试"
        )

    # Check cooldown (60 seconds between sends)
    last_code = db.query(VerificationCode).filter(
        VerificationCode.user_id == current_user.id,
        VerificationCode.purpose == "email_verification"
    ).order_by(VerificationCode.created_at.desc()).first()

    if last_code and (now - last_code.created_at).total_seconds() < 60:
        remaining = 60 - int((now - last_code.created_at).total_seconds())
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"请等待 {remaining} 秒后再试"
        )

    # Generate verification token
    import secrets
    token = secrets.token_urlsafe(32)

    # Create verification code record
    verification_code = VerificationCode(
        user_id=current_user.id,
        token=token,
        purpose="email_verification",
        expires_at=now + timedelta(hours=24),
        max_attempts=1
    )
    db.add(verification_code)
    db.commit()

    # Generate verification link
    from app.config import get_settings
    settings = get_settings()
    verification_link = f"{settings.frontend_url}/verify-email?token={token}"

    # Get site name
    from app.services.site_service import SiteService
    site_name = SiteService.get_site_name(db)

    # Send email
    await EmailService.send_email_verification(
        to_email=current_user.email,
        username=current_user.username,
        link=verification_link,
        expire_hours=24,
        site_name=site_name
    )

    return {"message": "验证邮件已发送，请检查您的邮箱"}


@router.get("/verify-email/{token}")
async def verify_email(
    token: str,
    db: Session = Depends(get_db)
):
    """Verify email address using the token from the email link"""
    from app.models import VerificationCode

    # Find the verification code
    verification_code = db.query(VerificationCode).filter(
        VerificationCode.token == token,
        VerificationCode.purpose == "email_verification",
        VerificationCode.is_used == False
    ).first()

    if not verification_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证链接无效或已使用"
        )

    # Check expiration
    if utcnow() > verification_code.expires_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证链接已过期，请重新发送"
        )

    # Get user
    user = db.query(User).filter(User.id == verification_code.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    # Mark email as verified
    user.email_verified = True
    user.email_verified_at = utcnow()

    # Mark verification code as used
    verification_code.is_used = True
    verification_code.used_at = utcnow()

    db.commit()

    return {"message": "邮箱验证成功", "email_verified": True}


# ==================== Skip Verification & Change Email ====================

@router.post("/verify/skip")
async def skip_verification(
    request_data: SkipVerificationRequest,
    db: Session = Depends(get_db)
):
    """Skip risk verification and login in restricted mode"""
    verification_session = _get_valid_verification_session(db, request_data.session_token)

    user = db.query(User).filter(User.id == verification_session.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    # Create tokens (user will be in restricted mode, handled by frontend)
    result = AuthService.create_tokens(
        db,
        user=user,
        client_id="internal",
        scope="profile email",
        remember_me=verification_session.remember_me,
        device_name=verification_session.device_name,
        device_token=verification_session.device_token,
        ip_address=verification_session.ip_address,
        user_agent=verification_session.user_agent,
        login_method="password"
    )

    # Record login log (mark as suspicious since verification was skipped)
    geo_info = GeoIPService.get_location(verification_session.ip_address)
    AuthService.record_login_log(
        db,
        user=user,
        username=user.username,
        success=True,
        ip_address=verification_session.ip_address,
        user_agent=verification_session.user_agent,
        geo_info=geo_info,
        login_method="password",
        is_suspicious=True
    )

    # Clean up verification session
    db.delete(verification_session)
    db.commit()

    return {
        "access_token": result["access_token"],
        "refresh_token": result["refresh_token"],
        "token_type": "bearer",
        "expires_in": settings.access_token_expire_minutes * 60
    }


@router.post("/change-email")
async def change_email(
    request_data: ChangeEmailRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Change user email (available in restricted mode)"""
    # Check if new email is already taken
    existing = db.query(User).filter(User.email == request_data.new_email).first()
    if existing and existing.id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该邮箱已被使用"
        )

    # Update email and reset verification status
    current_user.email = request_data.new_email
    current_user.email_verified = False
    current_user.email_verified_at = None
    db.commit()

    return {"message": "邮箱已更新，请验证新邮箱"}
