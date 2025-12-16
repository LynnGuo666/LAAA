from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import or_, func
from typing import List, Optional
from datetime import datetime
from app.database import get_db
from app.models import User, Group, user_groups, Role, user_roles, Client, user_allowed_apps, user_denied_apps, LoginLog, Session, Passkey, UserAuthorization
from app.schemas.admin import (
    AdminUserResponse,
    AdminUserCreate,
    AdminUserUpdate,
    AdminUserGroupsUpdate,
    AdminUserRolesUpdate,
    RoleResponse,
    AppPermissionItem,
    UserAppPermissionsResponse,
    UserAppPermissionsUpdate,
    ComputedAppPermission,
    ComputedAppPermissionsResponse,
    PaginatedUsersResponse,
    AdminLoginLogResponse,
    PaginatedLoginLogsResponse,
    AdminSessionResponse,
    AdminPasskeyResponse,
    AdminAuthorizationResponse,
)
from app.middleware.auth import get_current_user
from app.middleware.permission import require_permission
from app.utils.security import get_password_hash

router = APIRouter()


@router.get("/users", response_model=PaginatedUsersResponse)
async def list_users(
    skip: int = 0,
    limit: int = 20,
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

    # 分页
    users = query.order_by(User.id).offset(skip).limit(limit).all()

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
            roles=[r.name for r in user.roles]
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
        roles=[r.name for r in user.roles]
    )


@router.post("/users", response_model=AdminUserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    user_data: AdminUserCreate,
    db: DBSession = Depends(get_db),
    _: User = Depends(require_permission('admin.users'))
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
        password_hash=get_password_hash(user_data.password),
        status=user_data.status
    )

    db.add(new_user)
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
    db: DBSession = Depends(get_db),
    _: User = Depends(require_permission('admin.users'))
):
    """更新用户信息（管理员）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    # 更新字段
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
        user.email = user_data.email

    if user_data.avatar is not None:
        user.avatar = user_data.avatar

    if user_data.status is not None:
        user.status = user_data.status

    if user_data.password is not None:
        user.password_hash = get_password_hash(user_data.password)

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
        roles=[r.name for r in user.roles]
    )


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
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

    db.delete(user)
    db.commit()

    return None


@router.put("/users/{user_id}/groups", response_model=AdminUserResponse)
async def update_user_groups(
    user_id: int,
    groups_data: AdminUserGroupsUpdate,
    db: DBSession = Depends(get_db),
    _: User = Depends(require_permission('admin.users'))
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
        roles=[r.name for r in user.roles]
    )


@router.put("/users/{user_id}/roles", response_model=AdminUserResponse)
async def update_user_roles(
    user_id: int,
    roles_data: AdminUserRolesUpdate,
    db: DBSession = Depends(get_db),
    _: User = Depends(require_permission('admin.roles'))
):
    """更新用户的角色（管理员）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    # 删除用户现有的所有角色关联
    db.execute(user_roles.delete().where(user_roles.c.user_id == user_id))

    # 添加新的角色关联
    for role_id in roles_data.role_ids:
        role = db.query(Role).filter(Role.id == role_id).first()
        if not role:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"角色 ID {role_id} 不存在"
            )

        db.execute(user_roles.insert().values(user_id=user_id, role_id=role_id))

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
        roles=[r.name for r in user.roles]
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
    db: DBSession = Depends(get_db),
    _: User = Depends(require_permission('admin.users'))
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
    clients = query.order_by(Client.id).offset(skip).limit(limit).all()

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
    permission: Optional[str] = Query(None, description="权限设置: allowed, denied, null(清除)"),
    db: DBSession = Depends(get_db),
    _: User = Depends(require_permission('admin.users'))
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
    logs = query.order_by(LoginLog.created_at.desc()).offset(skip).limit(limit).all()

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
        Session.expires_at > datetime.utcnow()
    ).order_by(Session.last_active.desc()).all()

    return [AdminSessionResponse.model_validate(s) for s in sessions]


@router.delete("/users/{user_id}/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_user_session(
    user_id: int,
    session_id: int,
    db: DBSession = Depends(get_db),
    _: User = Depends(require_permission('admin.users'))
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

    db.delete(session)
    db.commit()
    return None


@router.delete("/users/{user_id}/sessions", status_code=status.HTTP_200_OK)
async def revoke_all_user_sessions(
    user_id: int,
    db: DBSession = Depends(get_db),
    _: User = Depends(require_permission('admin.users'))
):
    """强制登出用户的所有会话（管理员）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    count = db.query(Session).filter(Session.user_id == user_id).delete()
    db.commit()

    return {"message": f"已登出 {count} 个会话"}


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

    authorizations = db.query(UserAuthorization).filter(
        UserAuthorization.user_id == user_id
    ).order_by(UserAuthorization.updated_at.desc()).all()

    result = []
    for auth in authorizations:
        client = db.query(Client).filter(Client.id == auth.client_id).first()
        if client:
            result.append(AdminAuthorizationResponse(
                id=auth.id,
                client_id=client.client_id,
                client_name=client.name,
                client_logo=client.logo,
                scope=auth.scope,
                created_at=auth.created_at,
                updated_at=auth.updated_at
            ))

    return result
