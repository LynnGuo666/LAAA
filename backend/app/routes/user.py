import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models import Client, LoginLog, Token, User, UserAuthorization
from app.models import Session as SessionModel
from app.schemas import (
    AuthorizationListItem,
    ChangePasswordRequest,
    ClientPublicResponse,
    KickedSessionsResponse,
    LoginLogResponse,
    SecuritySettingsResponse,
    SecuritySettingsUpdate,
    SessionResponse,
    UserMeResponse,
    UserUpdate,
)
from app.utils.device import generate_device_id, get_client_ip
from app.utils.time import utcnow

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/api/user", tags=["User Management"])


@router.get("/me", response_model=UserMeResponse)
async def get_profile(current_user: User = Depends(get_current_user)):
    """Get current user profile"""
    permissions = sorted({p.code for r in current_user.roles for p in r.permissions})
    roles = sorted({r.name for r in current_user.roles})
    groups = sorted({g.name for g in current_user.groups})

    return UserMeResponse(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        avatar=current_user.avatar,
        status=current_user.status,
        created_at=current_user.created_at,
        groups=groups,
        roles=roles,
        permissions=permissions,
        is_admin=current_user.has_permission("admin.*") or current_user.has_role("admin"),
    )


@router.put("/me", response_model=UserMeResponse)
async def update_profile(
    user_data: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update current user profile"""
    if user_data.email:
        # Check if email is already taken
        existing = db.query(User).filter(
            User.email == user_data.email,
            User.id != current_user.id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already taken")
        current_user.email = user_data.email

    if user_data.avatar is not None:
        current_user.avatar = user_data.avatar

    current_user.updated_at = utcnow()
    db.commit()
    db.refresh(current_user)

    permissions = sorted({p.code for r in current_user.roles for p in r.permissions})
    roles = sorted({r.name for r in current_user.roles})
    groups = sorted({g.name for g in current_user.groups})

    return UserMeResponse(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        avatar=current_user.avatar,
        status=current_user.status,
        created_at=current_user.created_at,
        groups=groups,
        roles=roles,
        permissions=permissions,
        is_admin=current_user.has_permission("admin.*") or current_user.has_role("admin"),
    )


@router.get("/authorizations", response_model=List[AuthorizationListItem])
async def get_authorizations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get list of authorized applications"""
    authorizations = db.query(UserAuthorization).filter(
        UserAuthorization.user_id == current_user.id
    ).all()

    result = []
    for auth in authorizations:
        result.append(AuthorizationListItem(
            id=auth.id,
            client_name=auth.client.name,
            client_logo=auth.client.logo,
            scope=auth.scope,
            created_at=auth.created_at,
            last_used_at=auth.last_used_at
        ))

    return result


@router.delete("/authorizations/{auth_id}")
async def revoke_authorization(
    auth_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Revoke authorization for an application"""
    auth = db.query(UserAuthorization).filter(
        UserAuthorization.id == auth_id,
        UserAuthorization.user_id == current_user.id
    ).first()

    if not auth:
        raise HTTPException(status_code=404, detail="Authorization not found")

    # Also delete related tokens
    from app.models import Token
    db.query(Token).filter(
        Token.user_id == current_user.id,
        Token.client_id == auth.client_id
    ).delete()

    db.delete(auth)
    db.commit()

    return {"message": "Authorization revoked"}


@router.get("/sessions", response_model=List[SessionResponse])
async def get_sessions(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get list of active sessions (remembered devices)"""
    user_agent = request.headers.get("user-agent", "") or "unknown"
    client_ip = get_client_ip(request)
    current_device_id = generate_device_id(current_user.id, user_agent, client_ip)

    sessions = db.query(SessionModel).filter(
        SessionModel.user_id == current_user.id,
        SessionModel.expires_at > utcnow(),
        SessionModel.kicked_at.is_(None)  # Exclude kicked sessions
    ).order_by(SessionModel.last_active.desc()).all()

    result = []
    for session in sessions:
        result.append(SessionResponse(
            id=session.id,
            device_id=session.device_id,
            device_name=session.device_name,
            device_type=session.device_type,
            ip_address=session.ip_address,
            last_active=session.last_active,
            expires_at=session.expires_at,
            is_current=session.device_id == current_device_id,
            country=session.country,
            city=session.city,
            is_trusted=session.is_trusted or False
        ))

    return result


@router.delete("/sessions/{session_id}")
async def revoke_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Revoke a session (forget a device)"""
    session = db.query(SessionModel).filter(
        SessionModel.id == session_id,
        SessionModel.user_id == current_user.id
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Also delete related refresh token
    from app.models import Token
    db.query(Token).filter(
        Token.token_hash == session.refresh_token_hash
    ).delete()

    db.delete(session)
    db.commit()

    return {"message": "Session revoked"}


@router.get("/apps", response_model=List[ClientPublicResponse])
async def list_accessible_apps(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List apps the current user can access (based on app permissions)."""
    clients = db.query(Client).order_by(Client.id.desc()).all()
    result: List[ClientPublicResponse] = []
    for client in clients:
        try:
            can_access = current_user.can_access_client(client)
        except Exception as e:
            logger.warning(
                "list_accessible_apps: can_access_client failed user_id=%s client_id=%s err=%s",
                current_user.id, getattr(client, "client_id", None), e,
            )
            can_access = False
        if not can_access:
            continue
        result.append(
            ClientPublicResponse(
                id=client.id,
                client_id=client.client_id,
                name=client.name,
                description=client.description,
                logo=client.logo,
                website_url=getattr(client, "website_url", None),
                created_at=client.created_at,
            )
        )
    return result


# Login History and Security Settings API

@router.get("/login-history", response_model=List[LoginLogResponse])
async def get_login_history(
    skip: int = 0,
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get login history for the current user"""
    logs = db.query(LoginLog).filter(
        LoginLog.user_id == current_user.id
    ).order_by(LoginLog.created_at.desc()).offset(skip).limit(limit).all()

    return [LoginLogResponse(
        id=log.id,
        success=log.success,
        failure_reason=log.failure_reason,
        ip_address=log.ip_address,
        device_type=log.device_type,
        device_name=log.device_name,
        country=log.country,
        city=log.city,
        is_suspicious=log.is_suspicious or False,
        login_method=log.login_method or "password",
        created_at=log.created_at
    ) for log in logs]


@router.get("/security-settings", response_model=SecuritySettingsResponse)
async def get_security_settings(
    current_user: User = Depends(get_current_user)
):
    """Get user security settings"""
    return SecuritySettingsResponse(
        max_sessions=current_user.max_sessions or 3,
        notify_new_login=current_user.notify_new_login if current_user.notify_new_login is not None else True
    )


@router.put("/security-settings", response_model=SecuritySettingsResponse)
async def update_security_settings(
    settings_data: SecuritySettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update user security settings"""
    is_admin = current_user.has_permission("admin.*") or current_user.has_role("admin")

    if settings_data.max_sessions is not None:
        # Only admins can change max_sessions
        if not is_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="只有管理员可以修改最大设备数量"
            )
        # Limit between 1 and 10
        current_user.max_sessions = max(1, min(10, settings_data.max_sessions))

    if settings_data.notify_new_login is not None:
        current_user.notify_new_login = settings_data.notify_new_login

    db.commit()

    return SecuritySettingsResponse(
        max_sessions=current_user.max_sessions or 3,
        notify_new_login=current_user.notify_new_login if current_user.notify_new_login is not None else True
    )


@router.post("/sessions/{session_id}/trust")
async def mark_session_trusted(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Mark a session as trusted device"""
    session = db.query(SessionModel).filter(
        SessionModel.id == session_id,
        SessionModel.user_id == current_user.id
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.is_trusted = True
    db.commit()

    return {"message": "Session marked as trusted"}


@router.delete("/sessions/{session_id}/trust")
async def unmark_session_trusted(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove trusted status from a session"""
    session = db.query(SessionModel).filter(
        SessionModel.id == session_id,
        SessionModel.user_id == current_user.id
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.is_trusted = False
    db.commit()

    return {"message": "Session trust removed"}


@router.post("/sessions/revoke-others", response_model=KickedSessionsResponse)
async def revoke_other_sessions(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Revoke all sessions except the current one"""
    from app.services.session_limit_service import SessionLimitService

    user_agent = request.headers.get("user-agent", "") or "unknown"
    client_ip = get_client_ip(request)
    current_device_id = generate_device_id(current_user.id, user_agent, client_ip)

    kicked_sessions = SessionLimitService.kick_all_other_sessions(
        db, current_user.id, current_device_id
    )

    return KickedSessionsResponse(
        kicked_count=len(kicked_sessions),
        kicked_sessions=kicked_sessions
    )


@router.put("/password")
async def change_password(
    password_data: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Change current user password"""
    from app.utils.security import hash_password, verify_password

    # Verify current password
    if not verify_password(password_data.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="当前密码错误"
        )

    # Check if new password is same as current
    if verify_password(password_data.new_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="新密码不能与当前密码相同"
        )

    # Update password
    current_user.password_hash = hash_password(password_data.new_password)
    current_user.updated_at = utcnow()
    # 吊销所有现有 token:token_version+1 使旧 access token 立即失效,
    # 删除 refresh token 记录和 session(被窃的 refresh 也无法换新)
    current_user.token_version = (current_user.token_version or 0) + 1
    db.query(Token).filter(Token.user_id == current_user.id, Token.type == 'refresh').delete()
    db.query(SessionModel).filter(SessionModel.user_id == current_user.id).delete()
    db.commit()

    return {"message": "密码修改成功,其他设备已登出"}
