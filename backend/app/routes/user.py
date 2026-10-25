import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.middleware.auth import get_current_user, require_unrestricted
from app.models import Client, KnownDevice, LoginLog, Role, Token, User, UserAuthorization
from app.models import Session as SessionModel
from app.schemas import (
    AuthorizationListItem,
    ChangePasswordRequest,
    ClientPublicResponse,
    KickedSessionsResponse,
    KnownDeviceResponse,
    LoginLogResponse,
    SecuritySettingsResponse,
    SecuritySettingsUpdate,
    SessionResponse,
    UserMeResponse,
    UserUpdate,
)
from app.utils.device import generate_device_id, get_client_ip
from app.utils.security import hash_token
from app.utils.time import utcnow

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/api/user", tags=["User Management"])


def me_collections(db: Session, user: User):
    """汇总 /me 响应所需的 roles/permissions/groups(消除 N+1)。

    默认 lazy loading 下 roles→permissions 逐角色触发 select,加上 groups
    一次 /me 要发 2+N 条查询(N=角色数);这里 roles+permissions 用
    selectinload 一条链取齐、groups 单独一条,固定 3 条。
    auth.py 的 /api/auth/me 与本文件的 /api/user/me 共用,各端点仍
    自行构造响应,语义不变。
    返回 (permissions, roles, groups, is_admin)。
    """
    from app.models import Group, user_groups, user_roles

    roles = (
        db.query(Role)
        .options(selectinload(Role.permissions))
        .join(user_roles, user_roles.c.role_id == Role.id)
        .filter(user_roles.c.user_id == user.id)
        .all()
    )
    role_names = sorted({r.name for r in roles})
    permissions = sorted({p.code for r in roles for p in r.permissions})
    groups = (
        db.query(Group)
        .join(user_groups, user_groups.c.group_id == Group.id)
        .filter(user_groups.c.user_id == user.id)
        .all()
    )
    group_names = sorted({g.name for g in groups})
    # 与 User.has_permission("admin.*") / has_role("admin") 等价:
    # 二者最终都归结为「名为 admin 的角色」或「admin.* 权限码」
    is_admin = "admin" in role_names or "admin.*" in permissions
    return permissions, role_names, group_names, is_admin


def _resolve_current_session(
    request: Request, db: Session, user: User
) -> Optional[SessionModel]:
    """反查当前请求所属的 session。

    优先用当前请求携带的 refresh token（X-Refresh-Token 头，或
    laaa_refresh cookie——该 cookie Path=/api/auth，通常只有显式传头
    才可用）按 hash 精确反查 Session.refresh_token_hash。
    此前按 UA+IP 现算 device_id 匹配：用户切换网络（公司→家）后 IP
    变化，现算值匹配不到任何 session，「登出其他设备」会把自己也踢掉。
    未携带 refresh token 时回退旧逻辑（现算 device_id 匹配）。
    """
    refresh_token = request.headers.get("x-refresh-token") or request.cookies.get(
        "laaa_refresh"
    )
    if refresh_token:
        return db.query(SessionModel).filter(
            SessionModel.user_id == user.id,
            SessionModel.refresh_token_hash == hash_token(refresh_token),
        ).first()

    user_agent = request.headers.get("user-agent", "") or "unknown"
    client_ip = get_client_ip(request)
    fallback_device_id = generate_device_id(user.id, user_agent, client_ip)
    return db.query(SessionModel).filter(
        SessionModel.user_id == user.id,
        SessionModel.device_id == fallback_device_id,
    ).first()


@router.get("/me", response_model=UserMeResponse)
async def get_profile(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get current user profile"""
    permissions, roles, groups, is_admin = me_collections(db, current_user)

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
        is_admin=is_admin,
        must_change_password=bool(current_user.must_change_password),
    )


@router.put("/me", response_model=UserMeResponse)
async def update_profile(
    user_data: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update current user profile"""
    # 邮箱变更已移除:必须走 /api/auth/change-email(密码确认 + 双向验证邮件)
    if getattr(user_data, "email", None):
        raise HTTPException(status_code=400, detail="邮箱变更请使用密码确认流程")

    if user_data.avatar is not None:
        current_user.avatar = user_data.avatar

    current_user.updated_at = utcnow()
    db.commit()
    db.refresh(current_user)

    permissions, roles, groups, is_admin = me_collections(db, current_user)

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
        is_admin=is_admin,
        must_change_password=bool(current_user.must_change_password),
    )


@router.get("/authorizations", response_model=List[AuthorizationListItem])
async def get_authorizations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get list of authorized applications"""
    authorizations = db.query(UserAuthorization).options(
        selectinload(UserAuthorization.client)
    ).filter(
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
    # 通过当前请求的 refresh token 反查所属 session 标记 is_current,
    # 而非按 UA+IP 现算 device_id(切网后现算值失配,当前设备标记丢失)
    current_session = _resolve_current_session(request, db, current_user)

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
            is_current=current_session is not None and session.id == current_session.id,
            country=session.country,
            city=session.city,
            is_trusted=session.is_trusted or False
        ))

    return result


@router.delete("/sessions/{session_id}")
async def revoke_session(
    session_id: int,
    current_user: User = Depends(require_unrestricted),
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

    # 主动撤销 = 不再信任该设备。普通 logout 保留设备记忆(避免验证循环),
    # 但用户主动"撤销会话"必须遗忘,否则被盗设备重新登录仍会被判为已知设备。
    from app.services.device_service import forget_device as forget_known_device

    device_token = session.device_token
    db.delete(session)
    forget_known_device(db, current_user.id, device_token, commit=False)
    db.commit()

    return {"message": "Session revoked"}


@router.get("/devices", response_model=List[KnownDeviceResponse])
async def list_known_devices(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """列出已记住的设备(含当前没有活跃会话的设备)。

    这是风控使用的设备信任记忆,不等同于会话列表:设备登出后仍会保留,
    直到用户主动忘记、被撤销/强退,或超过保留期被清理。
    """
    from app.services.device_service import list_devices

    current_session = _resolve_current_session(request, db, current_user)
    current_token = current_session.device_token if current_session else None

    return [
        KnownDeviceResponse(
            id=device.id,
            device_name=device.device_name,
            device_type=device.device_type,
            ip_address=device.ip_address,
            country=device.country,
            city=device.city,
            first_seen=device.first_seen,
            last_seen=device.last_seen,
            is_current=bool(current_token and device.device_token == current_token),
        )
        for device in list_devices(db, current_user.id)
    ]


@router.delete("/devices/{device_id}")
async def forget_known_device(
    device_id: int,
    request: Request,
    current_user: User = Depends(require_unrestricted),
    db: Session = Depends(get_db)
):
    """忘记设备:删除信任记忆,并吊销该设备上的全部会话。

    忘记后,该设备下次登录会被判为新设备,需要重新完成安全验证。
    """
    from app.services.device_service import forget_device
    from app.services.session_limit_service import SessionLimitService

    device = db.query(KnownDevice).filter(
        KnownDevice.id == device_id,
        KnownDevice.user_id == current_user.id,
    ).first()

    if not device:
        raise HTTPException(status_code=404, detail="设备不存在")

    current_session = _resolve_current_session(request, db, current_user)
    was_current = bool(
        current_session
        and current_session.device_token
        and current_session.device_token == device.device_token
    )

    sessions = db.query(SessionModel).filter(
        SessionModel.user_id == current_user.id,
        SessionModel.device_token == device.device_token,
    ).all()
    for session in sessions:
        # 设备行由下面统一删除,这里只踢会话(kick_session 内不再重复删记忆)
        SessionLimitService.kick_session(
            db, session, reason='user_forget', commit=False, forget_trust=False
        )

    forget_device(db, current_user.id, device.device_token, commit=False)
    db.commit()

    return {
        "message": "设备已忘记",
        "kicked_count": len(sessions),
        "was_current": was_current,
    }


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
    ).order_by(LoginLog.created_at.desc()).offset(skip).limit(min(limit, 200)).all()

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
    current_user: User = Depends(require_unrestricted),
    db: Session = Depends(get_db)
):
    """Revoke all sessions except the current one"""
    from app.services.session_limit_service import SessionLimitService

    # 通过 refresh token 反查当前 session(而非现算 device_id),
    # 防止切换网络后 IP 变化导致误杀自己
    current_session = _resolve_current_session(request, db, current_user)

    kicked_sessions = SessionLimitService.kick_all_other_sessions(
        db, current_user.id, current_session.id if current_session else None,
        forget_trust=True,
    )

    return KickedSessionsResponse(
        kicked_count=len(kicked_sessions),
        kicked_sessions=kicked_sessions
    )


@router.put("/password")
async def change_password(
    password_data: ChangePasswordRequest,
    request: Request,
    current_user: User = Depends(require_unrestricted),
    db: Session = Depends(get_db)
):
    """Change current user password"""
    from app.services.device_service import forget_all_devices
    from app.utils.security import get_password_hash_async, verify_password_async

    # Verify current password
    if not await verify_password_async(password_data.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="当前密码错误"
        )

    # Check if new password is same as current
    if await verify_password_async(password_data.new_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="新密码不能与当前密码相同"
        )

    # Update password
    current_user.password_hash = await get_password_hash_async(password_data.new_password)
    current_user.updated_at = utcnow()
    # 用户本人完成改密:清除首登/重置后的强制改密标志
    current_user.must_change_password = False
    # 改密是安全动作:除当前设备外,其他设备的信任记忆一并清除。
    # 保留当前设备是为了避免"改完密码立刻被锁在验证页"(SMTP 未配置时尤其危险)。
    current_session = _resolve_current_session(request, db, current_user)
    keep_device_token = current_session.device_token if current_session else None

    # 吊销所有现有 token:token_version+1 使旧 access token 立即失效,
    # 删除 refresh token 记录和 session(被窃的 refresh 也无法换新)
    current_user.token_version = (current_user.token_version or 0) + 1
    db.query(Token).filter(Token.user_id == current_user.id, Token.type == 'refresh').delete()
    db.query(SessionModel).filter(SessionModel.user_id == current_user.id).delete()
    forget_all_devices(db, current_user.id, keep_token=keep_device_token, commit=False)
    db.commit()

    return {"message": "密码修改成功,其他设备已登出"}
