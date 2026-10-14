import asyncio
import logging
from datetime import timedelta
from typing import Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.middleware.auth import get_current_user
from app.middleware.ratelimit import limiter
from app.models import Session as SessionModel
from app.models import User
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
    SkipVerificationResponse,
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
from app.services.login_anomaly_service import LoginAnomalyService
from app.services.risk_service import RiskLevel, RiskService
from app.services.totp_service import (
    InvalidBackupCodeError,
    InvalidTOTPCodeError,
    TOTPNotEnabledError,
    TOTPSecretCorruptedError,
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
from app.utils.cookies import (
    clear_auth_cookies as _clear_auth_cookies,
)
from app.utils.cookies import (
    set_auth_cookies as _set_auth_cookies,
)
from app.utils.cookies import (
    set_authorize_cookie as _set_authorize_cookie,
)
from app.utils.device import get_client_ip
from app.utils.security import decode_token, hash_token
from app.utils.time import utcnow

settings = get_settings()
logger = logging.getLogger("uvicorn.error")

# 后台邮件任务引用:防止 task 被 GC(Python 文档明确要求持有 create_task 返回值)
_background_tasks: set = set()


def _spawn_email_task(coro) -> None:
    """安全地启动后台邮件任务:持有引用 + 完成后自动移除。"""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


# 认证 cookie 的实现在 app/utils/cookies.py（passkey 等路由共用）；
# 顶部已 import 为 _ 前缀别名，本文件既有调用点无需改动。

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

# 会话被踢原因 → 用户可读文案(session_limit=挤下线 / admin_revoke=管理员终止)
_SESSION_KICK_MESSAGES = {
    "session_limit": "您的账号已在其他设备登录，当前设备已下线，请重新登录",
    "admin_revoke": "您的会话已被管理员终止，请重新登录",
    "refresh_replay": "检测到刷新令牌重放，出于安全考虑本次会话已终止，请重新登录",
}


def _refresh_failure_detail(db: Session, refresh_token_value: str):
    """构造 refresh 失败时的 401 detail。

    session 记录仍在但被踢/吊销时,返回结构化标记
    ({"code": "session_revoked", "message": ...}),前端据此在登出前
    明确告知用户原因,而不是无提示静默跳转登录页;其余失败保持通用
    文案,不泄露失败细节。
    """
    payload = decode_token(refresh_token_value)
    if payload and payload.get("type") == "refresh":
        session = db.query(SessionModel).filter(
            SessionModel.refresh_token_hash == hash_token(refresh_token_value)
        ).first()
        if session and session.kicked_at is not None:
            message = _SESSION_KICK_MESSAGES.get(
                session.kicked_reason, "您的会话已终止，请重新登录"
            )
            return {"code": "session_revoked", "message": message}
    return "Invalid or expired refresh token"


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("3/hour")
async def register(request: Request, user_data: UserCreate, db: Session = Depends(get_db)):
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
            _spawn_email_task(
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
@limiter.limit("10/minute")
async def login(
    login_data: LoginRequest,
    request: Request,
    response: Response,
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

    # 异常检测(geo-jump / IP 变化 / 高频登录)结果作为既有异常传入风控评分——
    # 此前该结果只进日志不参与判定,geo_jump 等高价值信号实际无牙齿
    login_anomalies = LoginAnomalyService.check_anomalies(
        db, user, client_ip, user_agent, geo_info
    )

    # Assess risk for password login
    if settings.block_suspicious_login:
        risk_assessment = RiskService.assess_password_login_risk(
            db=db,
            user=user,
            ip_address=client_ip,
            city=city,
            country=country,
            device_token=login_data.device_token,
            existing_anomalies=login_anomalies
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
    # (复用上面已查的 geo_info 与异常结果,避免 create_tokens 内二次检测)
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
        login_method="password",
        geo_info=geo_info,
        anomalies=login_anomalies,
    )

    _set_auth_cookies(response, result["access_token"], result["refresh_token"],
                      remember_me=login_data.remember_me)

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
@limiter.limit("10/minute")
async def refresh(
    refresh_data: RefreshTokenRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Refresh access token(兼容期双读:body 里的 refresh_token 优先,其次 cookie)"""
    refresh_token_value = refresh_data.refresh_token or request.cookies.get("laaa_refresh")
    if not refresh_token_value:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing refresh token"
        )

    result = AuthService.refresh_access_token(
        db,
        refresh_token_value,
        client_id=refresh_data.client_id,
        client_secret=refresh_data.client_secret
    )
    if not result:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_refresh_failure_detail(db, refresh_token_value)
        )

    access_token, refresh_token = result

    # 旋转后重设两个 cookie(refresh 续期 + authorize 通道与 SPA 会话重新对齐)
    _set_auth_cookies(response, access_token, refresh_token)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=settings.access_token_expire_minutes * 60
    )


@router.post("/logout")
async def logout(
    refresh_data: RefreshTokenRequest,
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Logout user(兼容期双读:body 的 refresh_token 优先,其次 cookie)"""
    refresh_token_value = refresh_data.refresh_token or request.cookies.get("laaa_refresh")
    AuthService.logout(db, refresh_token_value)
    _clear_auth_cookies(response)
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
        is_restricted=current_user.is_restricted,
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


def _finalize_login(db: Session, verification_session, user: User,
                    response: Optional[Response] = None) -> VerificationCompleteResponse:
    """Helper to finalize login after verification is complete"""
    # Create tokens(geo_info 查一次,记录日志复用)
    geo_info = GeoIPService.get_location(verification_session.ip_address)
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
        login_method="password",
        geo_info=geo_info,
    )

    # Record successful login
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

    # 登录完成:同步设置认证 cookie(调用方传了 Response 才设)
    if response is not None:
        _set_auth_cookies(response, result["access_token"], result["refresh_token"],
                          remember_me=verification_session.remember_me)

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
@limiter.limit("5/hour")
async def send_email_verification_code(
    request: Request,
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
@limiter.limit("10/minute")
async def verify_email_code(
    request_data: VerifyEmailCodeRequest,
    request: Request,
    response: Response,
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
        return _finalize_login(db, verification_session, user, response=response)

    # Return updated status
    user = db.query(User).filter(User.id == verification_session.user_id).first()
    return VerificationService.get_session_status(user, verification_session)


@router.post("/verify/totp")
@limiter.limit("10/minute")
async def verify_totp(
    request_data: VerifyTOTPRequest,
    request: Request,
    response: Response,
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
    except TOTPSecretCorruptedError:
        # 已启用的记录必须保留，避免认证降级；需通过受信任的恢复流程重置。
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="TOTP 密钥已损坏，请通过账户恢复流程重置"
        )

    # Mark verification step as complete
    is_complete = VerificationService.complete_verification_step(
        db, verification_session, "totp"
    )

    if is_complete:
        return _finalize_login(db, verification_session, user, response=response)

    return VerificationService.get_session_status(user, verification_session)


@router.post("/verify/backup-code")
@limiter.limit("10/minute")
async def verify_backup_code(
    request_data: VerifyBackupCodeRequest,
    request: Request,
    response: Response,
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

    # Mark verification step as complete
    # 记为 backup_code 而非 totp:两步验证时可与真 TOTP 组合成两个独立因子
    is_complete = VerificationService.complete_verification_step(
        db, verification_session, "backup_code"
    )

    if is_complete:
        return _finalize_login(db, verification_session, user, response=response)

    return VerificationService.get_session_status(user, verification_session)


@router.post("/verify/magic-link/send")
@limiter.limit("5/hour")
async def send_magic_link(
    request: Request,
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
        secure=settings.cookie_secure,
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
        return _finalize_login(db, verification_session, user, response=response)

    user = db.query(User).filter(User.id == verification_session.user_id).first()
    return VerificationService.get_session_status(user, verification_session)


# =============================================================================
# Magic Link Independent Login
# =============================================================================

@router.post("/magic-link/login")
@limiter.limit("10/hour")
async def magic_link_login_send(
    request: Request,
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
        secure=settings.cookie_secure,
        samesite="strict"
    )

    return {"message": "如果该邮箱已注册，我们已发送登录链接"}


@router.get("/magic-link/login/{token}")
async def magic_link_login_verify(
    token: str,
    request: Request,
    response: Response,
    device_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Verify magic link for independent login"""
    # Get device token from cookie
    device_token = request.cookies.get("magic_link_device")
    # 持久设备码(localStorage 的 laaa_device_token):传给风控与会话创建,
    # 避免每次 magic-link 登录都被判为新设备
    persistent_device_token = device_id[:64] if device_id else None

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

    # 被封禁用户不得通过 magic link 登录(与密码/passkey 路径一致)
    if user.status != 'active':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账户已被停用,请联系管理员"
        )

    # Get client info
    client_ip = get_client_ip(request)
    user_agent = request.headers.get("user-agent", "")

    # Magic-link login 不经密码路径,需主动跑风控评估:
    # 若启用风控且检测到异常,拒绝直接签发 token,要求改用密码+二次验证登录。
    from app.services.geoip_service import GeoIPService

    geo_info = GeoIPService.get_location(client_ip)
    if settings.enable_login_anomaly_detection and settings.block_suspicious_login:
        from app.services.risk_service import RiskLevel, RiskService

        risk_assessment = RiskService.assess_password_login_risk(
            db=db,
            user=user,
            ip_address=client_ip,
            city=geo_info.get("city") if geo_info else None,
            country=geo_info.get("country") if geo_info else None,
            device_token=persistent_device_token,
        )
        if risk_assessment.risk_level != RiskLevel.NONE:
            # 高风险:不签发 token,要求用户走密码登录完成二次验证
            logger.warning(
                "magic_link_login: risk detected, refusing direct login user=%s risk=%s",
                user.id, risk_assessment.risk_level.value,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="检测到异常登录风险,请使用密码登录并完成二次验证",
            )

    # Create tokens
    result = AuthService.create_tokens(
        db,
        user=user,
        client_id="internal",
        scope="profile email",
        remember_me=False,
        device_name=None,
        device_token=persistent_device_token,
        ip_address=client_ip,
        user_agent=user_agent,
        login_method="magic_link",
        geo_info=geo_info,
    )

    _set_auth_cookies(response, result["access_token"], result["refresh_token"])

    # Record successful login
    geo_info = geo_info if geo_info else GeoIPService.get_location(client_ip)
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
    response: Response,
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
        return _finalize_login(db, verification_session, user, response=response)

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
    """Verify email address using the token from the email link.

    支持两种 purpose:
    - email_verification: 标记邮箱已验证
    - change_email: 将暂存的 new_email 写入 users.email 并标记已验证
    """
    from app.models import VerificationCode

    # Find the verification code (支持 email_verification 与 change_email 两种 purpose)
    verification_code = db.query(VerificationCode).filter(
        VerificationCode.token == token,
        VerificationCode.purpose.in_(["email_verification", "change_email"]),
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

    if verification_code.purpose == "change_email":
        # change-email 流程:用暂存的新邮箱替换,且确认未被他人占用
        new_email = verification_code.new_email
        if not new_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="邮箱变更记录无效"
            )
        existing = db.query(User).filter(User.email == new_email).first()
        if existing and existing.id != user.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="该邮箱已被使用,变更失败"
            )
        user.email = new_email

    # Mark email as verified
    user.email_verified = True
    user.email_verified_at = utcnow()

    # Mark verification code as used
    verification_code.is_used = True
    verification_code.used_at = utcnow()

    db.commit()

    return {"message": "邮箱验证成功", "email_verified": True}


# ==================== Skip Verification & Change Email ====================

@router.post("/verify/skip", response_model=SkipVerificationResponse)
async def skip_verification(
    request_data: SkipVerificationRequest,
    response: Response,
    db: Session = Depends(get_db)
):
    """Skip risk verification and login in restricted mode.

    受限会话设计(封死"偷到密码 → login 202 → skip → 改密/删 2FA"的接管链):
    - 高风险(risk_level=high)登录一律拒绝跳过,必须完成验证;
    - 只签发短 TTL 受限 access token(JWT 带 restricted=true claim),
      不签发 refresh token(不可续期,到期即终止);
    - 不写 Session/Token/KnownDevice——受限会话不洗白设备信任度,
      攻击者下次登录仍会被要求验证;
    - 敏感端点由 require_unrestricted 拒绝受限会话(见 middleware/auth.py)。
    """
    verification_session = _get_valid_verification_session(db, request_data.session_token)

    # 高风险登录必须完成验证,不允许跳过(偷凭据 + 高危环境的组合只能走完整验证)
    if verification_session.risk_level == "high":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="高风险登录必须完成安全验证，不能跳过"
        )

    user = db.query(User).filter(User.id == verification_session.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    # 只签发受限 token(短 TTL + restricted claim,无 refresh)
    result = AuthService.create_restricted_access_token(
        user=user,
        client_id="internal",
        scope="profile email",
    )

    # 受限会话只设置 authorize_token cookie(寿命=受限 TTL);
    # 不设置 laaa_refresh——没有 refresh token 可供续期
    _set_authorize_cookie(
        response, result["access_token"],
        settings.restricted_access_token_expire_minutes * 60
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

    return SkipVerificationResponse(
        restricted=True,
        access_token=result["access_token"],
        refresh_token=None,
        expires_in=result["expires_in"],
    )


@router.post("/change-email")
@limiter.limit("5/hour")
async def change_email(
    request: Request,
    request_data: ChangeEmailRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Change user email.

    安全要求:必须确认当前密码(防 session 劫持后改邮箱接管)。
    新邮箱不立即生效——发验证链接到新邮箱,验证后才更新;同时通知旧邮箱。
    """
    import secrets as _secrets

    from app.models import VerificationCode
    from app.utils.security import verify_password

    # 1. 确认当前密码(step-up)
    if not verify_password(request_data.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="当前密码错误"
        )

    # 2. 新邮箱不能与当前相同
    if request_data.new_email == current_user.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="新邮箱不能与当前邮箱相同"
        )

    # 3. 新邮箱不能已被占用
    existing = db.query(User).filter(User.email == request_data.new_email).first()
    if existing and existing.id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该邮箱已被使用"
        )

    # 4. 频控:pending 的 change_email 请求最多 5/天(复用 email_verification 的日限)
    now = utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    pending_count = db.query(VerificationCode).filter(
        VerificationCode.user_id == current_user.id,
        VerificationCode.purpose == "change_email",
        VerificationCode.created_at >= today_start,
    ).count()
    if pending_count >= 5:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="今日邮箱变更请求次数已达上限",
        )

    # 5. 创建待验证记录(token 发到新邮箱,验证后才真正改邮箱)
    token = _secrets.token_urlsafe(32)
    verification_code = VerificationCode(
        user_id=current_user.id,
        token=token,
        purpose="change_email",
        new_email=request_data.new_email,  # 待生效的新邮箱
        expires_at=now + timedelta(hours=1),
        max_attempts=1,
    )
    db.add(verification_code)
    db.commit()

    # 6. 发验证链接到新邮箱(非阻塞)
    # 注意用 query 参数格式,与注册验证链接一致——前端 verify-email 页只读 searchParams
    try:
        verify_url = f"{settings.frontend_url}/verify-email?token={token}"
        _spawn_email_task(
            EmailService.send_email(
                to_email=request_data.new_email,
                subject="确认邮箱变更 - LAAA",
                html_content=(
                    f"<p>你正在将 LAAA 账户邮箱变更为此地址。</p>"
                    f"<p><a href=\"{verify_url}\">点击确认邮箱变更</a></p>"
                    f"<p>该链接 1 小时内有效。若非本人操作请忽略此邮件。</p>"
                ),
                text_content=f"确认邮箱变更: {verify_url} (1 小时内有效)",
            )
        )
    except Exception as e:
        logger.warning("change_email: send verification to new email failed user=%s err=%s", current_user.id, e)

    # 7. 通知旧邮箱(若有)有变更请求
    if current_user.email and current_user.email_verified:
        try:
            _spawn_email_task(
                EmailService.send_email(
                    to_email=current_user.email,
                    subject="邮箱变更通知 - LAAA",
                    html_content=(
                        f"<p>你的账户发起了一次邮箱变更请求。</p>"
                        f"<p>新邮箱:{request_data.new_email}</p>"
                        f"<p>若非本人操作,请立即修改密码。</p>"
                    ),
                )
            )
        except Exception as e:
            logger.warning("change_email: notify old email failed user=%s err=%s", current_user.id, e)

    return {"message": "验证链接已发送到新邮箱,请查收并点击确认以完成邮箱变更"}
