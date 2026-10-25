import logging
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy import or_
from sqlalchemy.orm import Session as DBSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.middleware.permission import require_permission
from app.models import (
    AdminAuditLog,
    Client,
    Group,
    KnownDevice,
    LoginLog,
    Passkey,
    Permission,
    Role,
    Session,
    Token,
    User,
    UserAuthorization,
    role_permissions,
    user_groups,
    user_roles,
)
from app.schemas.admin import (
    AdminAuditLogResponse,
    AdminAuthorizationResponse,
    AdminForceReloginResponse,
    AdminLoginLogResponse,
    AdminPasskeyResponse,
    AdminReset2FARequest,
    AdminReset2FAResponse,
    AdminSessionResponse,
    AdminUserCreate,
    AdminUserGroupsUpdate,
    AdminUserResponse,
    AdminUserRolesUpdate,
    AdminUserSecurityMethodsResponse,
    AdminUserUpdate,
    AppPermissionItem,
    ComputedAppPermission,
    ComputedAppPermissionsResponse,
    PaginatedAdminAuditLogsResponse,
    PaginatedLoginLogsResponse,
    PaginatedUsersResponse,
    RoleResponse,
    UserAppPermissionsResponse,
    UserAppPermissionsUpdate,
)
from app.services.admin_audit_service import AdminAuditService
from app.services.email_service import EmailService
from app.services.session_limit_service import SessionLimitService
from app.services.site_service import SiteService
from app.utils.device import get_client_ip
from app.utils.security import get_password_hash_async
from app.utils.time import utcnow

router = APIRouter(prefix="/api/admin", tags=["admin"])

logger = logging.getLogger(__name__)


def _audit_user_action(
    db: DBSession,
    request: Request,
    actor: User,
    action: str,
    target: User,
    detail: Optional[dict] = None,
) -> None:
    """在业务事务内追加一条针对用户的审计记录(调用方负责 commit)。"""
    AdminAuditService.record(
        db,
        actor=actor,
        action=action,
        target_type='user',
        target_id=target.id,
        target_username=target.username,
        detail=detail,
        ip_address=get_client_ip(request),
        user_agent=request.headers.get('user-agent'),
    )


def _queue_2fa_reset_email(
    background_tasks: BackgroundTasks,
    *,
    to_email: str,
    username: str,
    actor_username: str,
    totp_reset: bool,
    passkeys_removed: int,
    force_relogin: bool,
    ip_address: Optional[str],
    site_name: str,
) -> None:
    """异步通知用户二次验证被重置(不阻塞管理端响应)。"""
    background_tasks.add_task(
        EmailService.send_2fa_reset_notification,
        to_email=to_email,
        username=username,
        admin_name=actor_username,
        totp_reset=totp_reset,
        passkeys_removed=passkeys_removed,
        force_relogin=force_relogin,
        ip_address=ip_address or '',
        site_name=site_name,
    )


def _max_role_level(user: User) -> int:
    """取用户所有角色的最高 level(无角色视为 0)。"""
    return max((role.level or 0 for role in user.roles), default=0)


def _ensure_role_level_allowed(operator: User, target: User) -> None:
    """敏感管理操作(改密/改状态/改邮箱/删除/改角色)的角色等级保护。

    威胁模型:仅持有 admin.users 的 user_manager 类角色被攻破后,若无等级
    保护,可直接重置 level=100 超管的密码完成完全提权。规则:
    - 操作者不持有 admin.roles(含 admin.* 通配):不得操作同级或更高等级
      的用户(同级互相改密同样是接管链);
    - 持有 admin.roles:视为已授权管理角色体系,可操作同级,但仍不得
      操作更高等级。
    """
    target_level = _max_role_level(target)
    operator_level = _max_role_level(operator)
    if operator.has_permission("admin.roles"):
        if target_level > operator_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="无权操作更高等级的管理员",
            )
    elif target_level >= operator_level:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权操作同级或更高等级的管理员",
        )


def _has_active_admins(db: DBSession) -> bool:
    """全站是否仍有活跃用户持有 admin 角色或 admin.* 权限。

    用于「最后一名管理员」保护:任何会使该计数归零的变更(移除角色/
    停用/删除)都必须拒绝,否则系统将无法再被管理(锁死)。
    调用方需保证变更已在当前事务中可见(autoflush 会在查询时落盘)。
    """
    admin_role_ids = db.query(Role.id).filter(Role.name == "admin")
    wildcard_role_ids = (
        db.query(Role.id)
        .join(role_permissions, role_permissions.c.role_id == Role.id)
        .join(Permission, Permission.id == role_permissions.c.permission_id)
        .filter(Permission.code == "admin.*")
    )
    count = (
        db.query(User.id)
        .filter(User.status == "active")
        .join(user_roles, user_roles.c.user_id == User.id)
        .filter(
            or_(
                user_roles.c.role_id.in_(admin_role_ids),
                user_roles.c.role_id.in_(wildcard_role_ids),
            )
        )
        .count()
    )
    return count > 0


def _force_relogin(db: DBSession, user: User, reason: str) -> int:
    """让用户在所有设备上立即失效并需要重新登录。

    四件事缺一不可:
    1. 踢掉活跃会话(标记 kicked + 过期 + 删关联 refresh token);
    2. 删除该用户剩余的 refresh token(可能挂在已丢失的会话上);
    3. 清空 known_devices,下次登录按新设备处理(触发设备验证/风控);
    4. token_version +1,已签发的 access token 立即被鉴权中间件拒绝。

    返回被踢的活跃会话数。
    """
    sessions = db.query(Session).filter(
        Session.user_id == user.id,
        Session.kicked_at.is_(None),
        Session.expires_at > utcnow(),
    ).all()
    for session in sessions:
        SessionLimitService.kick_session(
            db, session, reason=reason, commit=False, forget_trust=True
        )

    db.query(Token).filter(
        Token.user_id == user.id,
        Token.type == 'refresh',
    ).delete(synchronize_session=False)

    db.query(KnownDevice).filter(
        KnownDevice.user_id == user.id,
    ).delete(synchronize_session=False)

    user.token_version = (user.token_version or 0) + 1
    return len(sessions)


@router.get("/users", response_model=PaginatedUsersResponse)
async def list_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=200),
    search: Optional[str] = Query(None, description="搜索用户名、邮箱或ID"),
    db: DBSession = Depends(get_db),
    _: User = Depends(require_permission('admin.users'))
):
    """获取所有用户列表（管理员，支持分页和搜索）"""
    query = db.query(User)

    # 搜索过滤
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            or_(
                User.username.ilike(search_term),
                User.email.ilike(search_term),
                User.id == int(search) if search.isdigit() else False
            )
        )

    # 获取总数
    total = query.count()

    # 分页(selectinload 预取 groups/roles,消除循环内 lazy select 的 N+1)
    users = query.options(
        selectinload(User.groups),
        selectinload(User.roles),
    ).order_by(User.id).offset(skip).limit(limit).all()

    items = []
    for user in users:
        items.append(AdminUserResponse(
            id=user.id,
            username=user.username,
            email=user.email,
            avatar=user.avatar,
            status=user.status,
            created_at=user.created_at,
            updated_at=user.updated_at,
            groups=[g.name for g in user.groups],
            roles=[r.name for r in user.roles],
            group_ids=[g.id for g in user.groups],
            role_ids=[r.id for r in user.roles],
            must_change_password=user.must_change_password,
        ))

    return PaginatedUsersResponse(total=total, items=items)


@router.get("/users/{user_id}", response_model=AdminUserResponse)
async def get_user(
    user_id: int,
    db: DBSession = Depends(get_db),
    _: User = Depends(require_permission('admin.users'))
):
    """获取单个用户详情（管理员）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    return AdminUserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        avatar=user.avatar,
        status=user.status,
        created_at=user.created_at,
        updated_at=user.updated_at,
        groups=[g.name for g in user.groups],
        roles=[r.name for r in user.roles],
        group_ids=[g.id for g in user.groups],
        role_ids=[r.id for r in user.roles],
        must_change_password=user.must_change_password,
    )


@router.post("/users", response_model=AdminUserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    user_data: AdminUserCreate,
    request: Request,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(require_permission('admin.users'))
):
    """创建新用户（管理员）"""
    # 检查用户名是否已存在
    if db.query(User).filter(User.username == user_data.username).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户名已存在"
        )

    # 检查邮箱是否已存在
    if db.query(User).filter(User.email == user_data.email).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="邮箱已存在"
        )

    # 创建新用户
    new_user = User(
        username=user_data.username,
        email=user_data.email,
        password_hash=await get_password_hash_async(user_data.password),
        status=user_data.status
    )

    db.add(new_user)
    db.flush()  # 取得自增 ID,供审计记录引用
    _audit_user_action(
        db, request, current_user, 'user.create', new_user,
        {'status': new_user.status},
    )
    db.commit()
    db.refresh(new_user)

    return AdminUserResponse(
        id=new_user.id,
        username=new_user.username,
        email=new_user.email,
        avatar=new_user.avatar,
        status=new_user.status,
        created_at=new_user.created_at,
        updated_at=new_user.updated_at,
        groups=[],
        roles=[]
    )


@router.put("/users/{user_id}", response_model=AdminUserResponse)
async def update_user(
    user_id: int,
    user_data: AdminUserUpdate,
    request: Request,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(require_permission('admin.users'))
):
    """更新用户信息（管理员）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    # 敏感字段(密码/状态/邮箱)变更前做角色等级保护,
    # 防止低权管理员(user_manager 类角色)操纵同级或更高等级的管理员
    if (
        user_data.password is not None
        or user_data.status is not None
        or user_data.email is not None
    ):
        _ensure_role_level_allowed(current_user, user)

    # 更新字段
    was_active = user.status == "active"
    if user_data.email is not None:
        # 检查邮箱是否已被其他用户使用
        existing = db.query(User).filter(
            User.email == user_data.email,
            User.id != user_id
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="邮箱已被使用"
            )
        # 管理员换绑邮箱同样要重新验证:保留 verified 标志会让
        # 未验证邮箱直接获得 magic-link 登录能力
        if user_data.email != user.email:
            user.email = user_data.email
            user.email_verified = False

    if user_data.avatar is not None:
        user.avatar = user_data.avatar

    if user_data.status is not None:
        user.status = user_data.status

    if user_data.password is not None:
        user.password_hash = await get_password_hash_async(user_data.password)
        # 管理员重置密码:吊销该用户所有现有 token(同改密逻辑)
        user.token_version = (user.token_version or 0) + 1
        # 临时密码应由用户本人尽快更换:置强制改密标志(前端强引导)
        user.must_change_password = True
        from app.models import Session as SessionModel
        from app.models import Token as TokenModel
        db.query(TokenModel).filter(TokenModel.user_id == user.id, TokenModel.type == 'refresh').delete()
        db.query(SessionModel).filter(SessionModel.user_id == user.id).delete()

    # 最后一名管理员保护:停用唯一活跃管理员会导致系统无法管理
    # (SessionLocal autoflush=False,需显式 flush 让状态变更对查询可见)
    if (
        user_data.status is not None
        and user_data.status != "active"
        and was_active
    ):
        db.flush()
        if not _has_active_admins(db):
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="不能停用最后一名活跃管理员，否则系统将无法管理"
            )

    changed_fields = [
        field for field in ("email", "avatar", "status", "password")
        if getattr(user_data, field) is not None
    ]
    _audit_user_action(
        db, request, current_user, 'user.update', user,
        {
            'fields': changed_fields,
            # 只记录"重置了密码"这一事实,绝不落明文/哈希
            'password_reset': user_data.password is not None,
        },
    )

    db.commit()
    db.refresh(user)

    return AdminUserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        avatar=user.avatar,
        status=user.status,
        created_at=user.created_at,
        updated_at=user.updated_at,
        groups=[g.name for g in user.groups],
        roles=[r.name for r in user.roles],
        group_ids=[g.id for g in user.groups],
        role_ids=[r.id for r in user.roles],
        must_change_password=user.must_change_password,
    )


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    request: Request,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(require_permission('admin.users'))
):
    """删除用户（管理员）"""
    # 不允许删除自己
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不能删除自己"
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    # 删除用户前做角色等级保护(删除是最高强度的敏感操作)
    _ensure_role_level_allowed(current_user, user)

    # 先落审计再删:若最后一名管理员保护触发 rollback,审计行一并回滚
    _audit_user_action(db, request, current_user, 'user.delete', user)

    db.delete(user)
    db.flush()  # autoflush=False:让删除对下面的计数查询可见

    # 最后一名管理员保护:删除唯一活跃管理员会导致系统无法管理
    if not _has_active_admins(db):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不能删除最后一名活跃管理员，否则系统将无法管理"
        )

    db.commit()

    return None


@router.put("/users/{user_id}/groups", response_model=AdminUserResponse)
async def update_user_groups(
    user_id: int,
    groups_data: AdminUserGroupsUpdate,
    request: Request,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(require_permission('admin.users'))
):
    """更新用户所属的组（管理员）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    # 删除用户现有的所有组关联
    db.execute(user_groups.delete().where(user_groups.c.user_id == user_id))

    # 添加新的组关联
    for group_id in groups_data.group_ids:
        group = db.query(Group).filter(Group.id == group_id).first()
        if not group:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"组 ID {group_id} 不存在"
            )

        db.execute(user_groups.insert().values(user_id=user_id, group_id=group_id))

    _audit_user_action(
        db, request, current_user, 'user.groups.update', user,
        {'group_ids': groups_data.group_ids},
    )

    db.commit()
    db.refresh(user)

    return AdminUserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        avatar=user.avatar,
        status=user.status,
        created_at=user.created_at,
        updated_at=user.updated_at,
        groups=[g.name for g in user.groups],
        roles=[r.name for r in user.roles],
        group_ids=[g.id for g in user.groups],
        role_ids=[r.id for r in user.roles],
        must_change_password=user.must_change_password,
    )


@router.put("/users/{user_id}/roles", response_model=AdminUserResponse)
async def update_user_roles(
    user_id: int,
    roles_data: AdminUserRolesUpdate,
    request: Request,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(require_permission('admin.roles'))
):
    """更新用户的角色（管理员）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    # 角色等级保护:不得对更高等级的用户改角色(可操作同级)
    _ensure_role_level_allowed(current_user, user)

    # 先校验所有角色存在,再校验等级(避免部分写入后才发现非法)
    new_roles = []
    for role_id in roles_data.role_ids:
        role = db.query(Role).filter(Role.id == role_id).first()
        if not role:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"角色 ID {role_id} 不存在"
            )
        new_roles.append(role)

    # 不得授予超过操作者等级的角色(防 admin.roles 持有者暗中制造超管)
    operator_level = _max_role_level(current_user)
    for role in new_roles:
        if (role.level or 0) > operator_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"无权授予高于自身等级的角色（{role.name}）"
            )

    # 删除用户现有的所有角色关联
    db.execute(user_roles.delete().where(user_roles.c.user_id == user_id))

    # 添加新的角色关联
    for role in new_roles:
        db.execute(user_roles.insert().values(user_id=user_id, role_id=role.id))

    # 最后一名管理员保护:变更后全站不得没有任何活跃管理员,
    # 否则系统将无法再被管理(锁死)
    if not _has_active_admins(db):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不能移除最后一名管理员，否则系统将无法管理"
        )

    _audit_user_action(
        db, request, current_user, 'user.roles.update', user,
        {'role_ids': roles_data.role_ids},
    )

    db.commit()
    db.refresh(user)

    return AdminUserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        avatar=user.avatar,
        status=user.status,
        created_at=user.created_at,
        updated_at=user.updated_at,
        groups=[g.name for g in user.groups],
        roles=[r.name for r in user.roles],
        group_ids=[g.id for g in user.groups],
        role_ids=[r.id for r in user.roles],
        must_change_password=user.must_change_password,
    )

@router.get("/roles", response_model=List[RoleResponse])
async def list_roles(
    db: DBSession = Depends(get_db),
    _: User = Depends(require_permission('admin.roles'))
):
    """获取所有角色列表（管理员）"""
    roles = db.query(Role).all()
    return roles


# ==================== User App Permissions ====================

@router.get("/users/{user_id}/app-permissions", response_model=UserAppPermissionsResponse)
async def get_user_app_permissions(
    user_id: int,
    db: DBSession = Depends(get_db),
    _: User = Depends(require_permission('admin.users'))
):
    """获取用户的应用权限"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    return UserAppPermissionsResponse(
        user_id=user.id,
        username=user.username,
        allowed_apps=[
            AppPermissionItem(id=app.id, client_id=app.client_id, name=app.name, logo=app.logo)
            for app in user.allowed_apps
        ],
        denied_apps=[
            AppPermissionItem(id=app.id, client_id=app.client_id, name=app.name, logo=app.logo)
            for app in user.denied_apps
        ]
    )


@router.put("/users/{user_id}/app-permissions", response_model=UserAppPermissionsResponse)
async def update_user_app_permissions(
    user_id: int,
    permissions: UserAppPermissionsUpdate,
    request: Request,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(require_permission('admin.users'))
):
    """更新用户的应用权限"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    # 检查应用ID是否有效
    allowed_apps = db.query(Client).filter(Client.id.in_(permissions.allowed_app_ids)).all() if permissions.allowed_app_ids else []
    denied_apps = db.query(Client).filter(Client.id.in_(permissions.denied_app_ids)).all() if permissions.denied_app_ids else []

    # 检查是否有重复（同一应用不能同时在允许和拒绝列表中）
    allowed_ids = set(permissions.allowed_app_ids)
    denied_ids = set(permissions.denied_app_ids)
    if allowed_ids & denied_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="同一应用不能同时在允许和拒绝列表中"
        )

    # 更新用户的应用权限
    user.allowed_apps = allowed_apps
    user.denied_apps = denied_apps

    _audit_user_action(
        db, request, current_user, 'user.app_permissions.update', user,
        {
            'allowed_app_ids': permissions.allowed_app_ids,
            'denied_app_ids': permissions.denied_app_ids,
        },
    )

    db.commit()
    db.refresh(user)

    return UserAppPermissionsResponse(
        user_id=user.id,
        username=user.username,
        allowed_apps=[
            AppPermissionItem(id=app.id, client_id=app.client_id, name=app.name, logo=app.logo)
            for app in user.allowed_apps
        ],
        denied_apps=[
            AppPermissionItem(id=app.id, client_id=app.client_id, name=app.name, logo=app.logo)
            for app in user.denied_apps
        ]
    )


# ==================== Computed App Permissions ====================

def _compute_app_permission(user: User, client: Client) -> ComputedAppPermission:
    """计算用户对某个应用的最终权限"""
    # 确定用户级别权限
    user_permission = None
    if client in user.denied_apps:
        user_permission = "denied"
    elif client in user.allowed_apps:
        user_permission = "allowed"

    # 按优先级计算最终权限
    # 1. User denied
    if client in user.denied_apps:
        return ComputedAppPermission(
            app_id=client.id,
            client_id=client.client_id,
            app_name=client.name,
            app_logo=client.logo,
            can_access=False,
            source="user_denied",
            source_detail="用户级别拒绝",
            user_permission=user_permission
        )

    # 2. User allowed
    if client in user.allowed_apps:
        return ComputedAppPermission(
            app_id=client.id,
            client_id=client.client_id,
            app_name=client.name,
            app_logo=client.logo,
            can_access=True,
            source="user_allowed",
            source_detail="用户级别允许",
            user_permission=user_permission
        )

    # 3. Group denied
    for group in user.groups:
        if client in group.denied_apps:
            return ComputedAppPermission(
                app_id=client.id,
                client_id=client.client_id,
                app_name=client.name,
                app_logo=client.logo,
                can_access=False,
                source="group_denied",
                source_detail=f"组「{group.name}」拒绝",
                user_permission=user_permission
            )

    # 4. Group allowed
    for group in user.groups:
        if client in group.allowed_apps:
            return ComputedAppPermission(
                app_id=client.id,
                client_id=client.client_id,
                app_name=client.name,
                app_logo=client.logo,
                can_access=True,
                source="group_allowed",
                source_detail=f"组「{group.name}」允许",
                user_permission=user_permission
            )

    # 5. Default
    default_access = bool(client.default_access)
    return ComputedAppPermission(
        app_id=client.id,
        client_id=client.client_id,
        app_name=client.name,
        app_logo=client.logo,
        can_access=default_access,
        source="default",
        source_detail=f"应用默认（{'允许' if default_access else '拒绝'}）",
        user_permission=user_permission
    )


@router.get("/users/{user_id}/app-permissions/computed", response_model=ComputedAppPermissionsResponse)
async def get_user_computed_app_permissions(
    user_id: int,
    skip: int = 0,
    limit: int = 20,
    search: Optional[str] = Query(None, description="搜索应用名称"),
    db: DBSession = Depends(get_db),
    _: User = Depends(require_permission('admin.users'))
):
    """获取用户计算后的应用权限（分页）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    # 查询应用列表
    query = db.query(Client)
    if search:
        search_term = f"%{search}%"
        query = query.filter(Client.name.ilike(search_term))

    total = query.count()
    clients = query.order_by(Client.id).offset(skip).limit(min(limit, 200)).all()

    # 计算每个应用的权限
    items = [_compute_app_permission(user, client) for client in clients]

    return ComputedAppPermissionsResponse(
        user_id=user.id,
        username=user.username,
        groups=[g.name for g in user.groups],
        total=total,
        items=items
    )


@router.put("/users/{user_id}/app-permissions/single")
async def update_user_single_app_permission(
    user_id: int,
    app_id: int,
    request: Request,
    permission: Optional[str] = Query(None, description="权限设置: allowed, denied, null(清除)"),
    db: DBSession = Depends(get_db),
    current_user: User = Depends(require_permission('admin.users'))
):
    """更新用户对单个应用的权限"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    client = db.query(Client).filter(Client.id == app_id).first()
    if not client:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="应用不存在"
        )

    # 先从两个列表中移除
    if client in user.allowed_apps:
        user.allowed_apps.remove(client)
    if client in user.denied_apps:
        user.denied_apps.remove(client)

    # 根据权限设置添加
    if permission == "allowed":
        user.allowed_apps.append(client)
    elif permission == "denied":
        user.denied_apps.append(client)
    # permission == None 或其他值时，只清除不添加

    _audit_user_action(
        db, request, current_user, 'user.app_permission.update', user,
        {'app_id': app_id, 'permission': permission},
    )

    db.commit()
    db.refresh(user)

    return _compute_app_permission(user, client)


# ==================== User Login Logs ====================

@router.get("/users/{user_id}/login-logs", response_model=PaginatedLoginLogsResponse)
async def get_user_login_logs(
    user_id: int,
    skip: int = 0,
    limit: int = 20,
    db: DBSession = Depends(get_db),
    _: User = Depends(require_permission('admin.users'))
):
    """获取用户的登录日志（管理员）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    query = db.query(LoginLog).filter(LoginLog.user_id == user_id)
    total = query.count()
    logs = query.order_by(LoginLog.created_at.desc()).offset(skip).limit(min(limit, 200)).all()

    return PaginatedLoginLogsResponse(
        total=total,
        items=[AdminLoginLogResponse.model_validate(log) for log in logs]
    )


# ==================== User Sessions ====================

@router.get("/users/{user_id}/sessions", response_model=List[AdminSessionResponse])
async def get_user_sessions(
    user_id: int,
    db: DBSession = Depends(get_db),
    _: User = Depends(require_permission('admin.users'))
):
    """获取用户的活跃会话（管理员）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    sessions = db.query(Session).filter(
        Session.user_id == user_id,
        Session.expires_at > utcnow()
    ).order_by(Session.last_active.desc()).all()

    return [AdminSessionResponse.model_validate(s) for s in sessions]


@router.delete("/users/{user_id}/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_user_session(
    user_id: int,
    session_id: int,
    request: Request,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(require_permission('admin.users'))
):
    """强制登出用户的单个会话（管理员）"""
    session = db.query(Session).filter(
        Session.id == session_id,
        Session.user_id == user_id
    ).first()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="会话不存在"
        )

    user = db.query(User).filter(User.id == user_id).first()

    # 吊销会话必须连带删 refresh token(走统一 helper),
    # 否则被强制登出的用户仍可用 refresh token 续命;
    # 同时遗忘设备信任:管理员强退意味着该设备需要重新验证。
    # commit=False:审计与吊销在同一事务内提交。
    SessionLimitService.kick_session(
        db, session, reason='admin_revoke', commit=False, forget_trust=True
    )
    if user is not None:
        _audit_user_action(
            db, request, current_user, 'user.session.revoke', user,
            {'session_id': session_id},
        )
    db.commit()
    return None


@router.delete("/users/{user_id}/sessions", status_code=status.HTTP_200_OK)
async def revoke_all_user_sessions(
    user_id: int,
    request: Request,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(require_permission('admin.users'))
):
    """强制登出用户的所有会话（管理员）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    sessions = db.query(Session).filter(
        Session.user_id == user_id,
        Session.kicked_at.is_(None),
        Session.expires_at > utcnow(),
    ).all()
    for session in sessions:
        # 同上:连带删各会话关联的 refresh token,并遗忘设备信任
        SessionLimitService.kick_session(
            db, session, reason='admin_revoke', commit=False, forget_trust=True
        )

    _audit_user_action(
        db, request, current_user, 'user.sessions.revoke_all', user,
        {'sessions_revoked': len(sessions)},
    )
    db.commit()

    return {"message": f"已登出 {len(sessions)} 个会话"}


# ==================== User Passkeys ====================

@router.get("/users/{user_id}/passkeys", response_model=List[AdminPasskeyResponse])
async def get_user_passkeys(
    user_id: int,
    db: DBSession = Depends(get_db),
    _: User = Depends(require_permission('admin.users'))
):
    """获取用户的通行密钥（管理员）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    passkeys = db.query(Passkey).filter(Passkey.user_id == user_id).order_by(Passkey.created_at.desc()).all()

    return [AdminPasskeyResponse.model_validate(p) for p in passkeys]


# ==================== User Authorizations ====================

@router.get("/users/{user_id}/authorizations", response_model=List[AdminAuthorizationResponse])
async def get_user_authorizations(
    user_id: int,
    db: DBSession = Depends(get_db),
    _: User = Depends(require_permission('admin.users'))
):
    """获取用户的应用授权记录（管理员）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    authorizations = db.query(UserAuthorization).options(
        selectinload(UserAuthorization.client)
    ).filter(
        UserAuthorization.user_id == user_id
    ).order_by(UserAuthorization.last_used_at.desc()).all()

    result = []
    for auth in authorizations:
        client = auth.client
        if client:
            result.append(AdminAuthorizationResponse(
                id=auth.id,
                client_id=client.client_id,
                client_name=client.name,
                client_logo=client.logo,
                scope=auth.scope,
                created_at=auth.created_at,
                updated_at=auth.last_used_at
            ))

    return result


# ==================== User Security Methods ====================

@router.get("/users/{user_id}/security-methods", response_model=AdminUserSecurityMethodsResponse)
async def get_user_security_methods(
    user_id: int,
    db: DBSession = Depends(get_db),
    _: User = Depends(require_permission('admin.users'))
):
    """获取用户的安全验证方式（管理员）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    # TOTP 状态
    totp_enabled = user.totp is not None and user.totp.is_enabled
    totp_created_at = user.totp.created_at if user.totp and user.totp.is_enabled else None

    # Passkey 数量
    passkey_count = len(user.passkeys)

    # 邮箱验证状态
    email_verified = user.email_verified
    email_verified_at = user.email_verified_at

    return AdminUserSecurityMethodsResponse(
        totp_enabled=totp_enabled,
        totp_created_at=totp_created_at,
        passkey_count=passkey_count,
        email_verified=email_verified,
        email_verified_at=email_verified_at
    )


# ==================== Admin Audit Logs ====================

@router.get("/audit-logs", response_model=PaginatedAdminAuditLogsResponse)
async def list_admin_audit_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=200),
    action: Optional[str] = Query(None, description="按操作类型精确过滤"),
    target_user_id: Optional[int] = Query(None, description="只看针对某用户的操作"),
    actor_id: Optional[int] = Query(None, description="只看某管理员的操作"),
    db: DBSession = Depends(get_db),
    _: User = Depends(require_permission('admin.users'))
):
    """查询管理员操作审计(分页)。"""
    query = db.query(AdminAuditLog)
    if action:
        query = query.filter(AdminAuditLog.action == action)
    if target_user_id is not None:
        query = query.filter(
            AdminAuditLog.target_type == 'user',
            AdminAuditLog.target_id == target_user_id,
        )
    if actor_id is not None:
        query = query.filter(AdminAuditLog.actor_id == actor_id)

    total = query.count()
    logs = query.order_by(
        AdminAuditLog.created_at.desc(), AdminAuditLog.id.desc()
    ).offset(skip).limit(limit).all()

    return PaginatedAdminAuditLogsResponse(
        total=total,
        items=[AdminAuditLogResponse.model_validate(log) for log in logs],
    )


# ==================== 2FA Recovery / Force Relogin ====================

@router.post("/users/{user_id}/reset-2fa", response_model=AdminReset2FAResponse)
async def reset_user_2fa(
    user_id: int,
    request_data: AdminReset2FARequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(require_permission('admin.users'))
):
    """重置用户的二次验证(管理员)。

    典型场景:用户丢失手机 / 验证器被删 / 备用码也找不到,已无法自行登录。
    管理员可解绑 TOTP(含备用码)与全部通行密钥,并按需强制其重新登录。

    这是账号接管链上的敏感操作(重置 2FA + 已知密码 = 绕过第二因素),
    因此沿用改密/封禁同级的角色等级保护。
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )
    _ensure_role_level_allowed(current_user, user)

    totp_reset = False
    if request_data.reset_totp and user.totp is not None:
        db.delete(user.totp)
        totp_reset = True

    passkeys_removed = 0
    if request_data.remove_passkeys:
        passkeys = db.query(Passkey).filter(Passkey.user_id == user.id).all()
        passkeys_removed = len(passkeys)
        for passkey in passkeys:
            db.delete(passkey)

    sessions_revoked = 0
    if request_data.force_relogin:
        sessions_revoked = _force_relogin(db, user, reason='admin_reset_2fa')

    # 审计与邮件参数必须在 commit 前快照(commit 后对象属性会过期重载)
    target_email = user.email
    target_username = user.username
    site_name = SiteService.get_site_name(db)
    ip_address = get_client_ip(request)

    _audit_user_action(
        db, request, current_user, 'user.2fa.reset', user,
        {
            'totp_reset': totp_reset,
            'passkeys_removed': passkeys_removed,
            'force_relogin': request_data.force_relogin,
            'sessions_revoked': sessions_revoked,
        },
    )
    db.commit()

    _queue_2fa_reset_email(
        background_tasks,
        to_email=target_email,
        username=target_username,
        actor_username=current_user.username,
        totp_reset=totp_reset,
        passkeys_removed=passkeys_removed,
        force_relogin=request_data.force_relogin,
        ip_address=ip_address,
        site_name=site_name,
    )

    logger.warning(
        "admin=%s reset 2FA for user=%s (totp=%s passkeys=%s sessions=%s)",
        current_user.id, user.id, totp_reset, passkeys_removed, sessions_revoked,
    )

    return AdminReset2FAResponse(
        totp_reset=totp_reset,
        passkeys_removed=passkeys_removed,
        sessions_revoked=sessions_revoked,
        message=(
            f"已重置二次验证：身份验证器{'已解绑' if totp_reset else '未变'}，"
            f"移除 {passkeys_removed} 个通行密钥，"
            f"登出 {sessions_revoked} 个会话"
        ),
    )


@router.delete("/users/{user_id}/totp", status_code=status.HTTP_200_OK)
async def reset_user_totp(
    user_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(require_permission('admin.users'))
):
    """解绑用户身份验证器(TOTP + 备用码),保留通行密钥与其他会话。"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )
    _ensure_role_level_allowed(current_user, user)

    if user.totp is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该用户未启用身份验证器"
        )

    target_email = user.email
    target_username = user.username
    site_name = SiteService.get_site_name(db)
    ip_address = get_client_ip(request)

    db.delete(user.totp)
    _audit_user_action(
        db, request, current_user, 'user.totp.reset', user,
        {'backup_codes_cleared': True},
    )
    db.commit()

    _queue_2fa_reset_email(
        background_tasks,
        to_email=target_email,
        username=target_username,
        actor_username=current_user.username,
        totp_reset=True,
        passkeys_removed=0,
        force_relogin=False,
        ip_address=ip_address,
        site_name=site_name,
    )

    logger.warning(
        "admin=%s reset TOTP for user=%s", current_user.id, user.id
    )
    return {"message": "身份验证器已重置"}


@router.delete("/users/{user_id}/passkeys/{passkey_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user_passkey(
    user_id: int,
    passkey_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(require_permission('admin.users'))
):
    """移除用户指定的通行密钥(管理员)。"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )
    _ensure_role_level_allowed(current_user, user)

    passkey = db.query(Passkey).filter(
        Passkey.id == passkey_id,
        Passkey.user_id == user_id,
    ).first()
    if not passkey:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="通行密钥不存在"
        )

    passkey_name = passkey.name
    target_email = user.email
    target_username = user.username
    site_name = SiteService.get_site_name(db)
    ip_address = get_client_ip(request)

    db.delete(passkey)
    _audit_user_action(
        db, request, current_user, 'user.passkey.delete', user,
        {'passkey_id': passkey_id, 'passkey_name': passkey_name},
    )
    db.commit()

    _queue_2fa_reset_email(
        background_tasks,
        to_email=target_email,
        username=target_username,
        actor_username=current_user.username,
        totp_reset=False,
        passkeys_removed=1,
        force_relogin=False,
        ip_address=ip_address,
        site_name=site_name,
    )

    logger.warning(
        "admin=%s deleted passkey=%s for user=%s",
        current_user.id, passkey_id, user.id,
    )
    return None


@router.post("/users/{user_id}/force-relogin", response_model=AdminForceReloginResponse)
async def force_user_relogin(
    user_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
    current_user: User = Depends(require_permission('admin.users'))
):
    """强制用户在所有设备上退出并重新登录(管理员)。

    与「登出全部会话」的区别:除踢会话外还递增 token_version 并清空
    设备信任,已签发但未过期的 access token 也会立即失效。
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )
    _ensure_role_level_allowed(current_user, user)

    sessions_revoked = _force_relogin(db, user, reason='admin_force_relogin')

    target_email = user.email
    target_username = user.username
    site_name = SiteService.get_site_name(db)
    ip_address = get_client_ip(request)

    _audit_user_action(
        db, request, current_user, 'user.force_relogin', user,
        {'sessions_revoked': sessions_revoked},
    )
    db.commit()

    _queue_2fa_reset_email(
        background_tasks,
        to_email=target_email,
        username=target_username,
        actor_username=current_user.username,
        totp_reset=False,
        passkeys_removed=0,
        force_relogin=True,
        ip_address=ip_address,
        site_name=site_name,
    )

    logger.warning(
        "admin=%s forced relogin for user=%s (sessions=%s)",
        current_user.id, user.id, sessions_revoked,
    )

    return AdminForceReloginResponse(
        sessions_revoked=sessions_revoked,
        message=f"已强制该用户重新登录，登出 {sessions_revoked} 个会话",
    )
