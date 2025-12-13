from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import User, Group, user_groups, Role, user_roles, Client, user_allowed_apps, user_denied_apps
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
)
from app.middleware.auth import get_current_user
from app.middleware.permission import require_permission
from app.utils.security import get_password_hash

router = APIRouter()


@router.get("/users", response_model=List[AdminUserResponse])
async def list_users(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission('admin.users'))
):
    """获取所有用户列表（管理员）"""
    users = db.query(User).offset(skip).limit(limit).all()

    result = []
    for user in users:
        result.append(AdminUserResponse(
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

    return result


@router.get("/users/{user_id}", response_model=AdminUserResponse)
async def get_user(
    user_id: int,
    db: Session = Depends(get_db),
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
    db: Session = Depends(get_db),
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
    db: Session = Depends(get_db),
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
    db: Session = Depends(get_db),
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
    db: Session = Depends(get_db),
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
    db: Session = Depends(get_db),
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
    db: Session = Depends(get_db),
    _: User = Depends(require_permission('admin.roles'))
):
    """获取所有角色列表（管理员）"""
    roles = db.query(Role).all()
    return roles


# ==================== User App Permissions ====================

@router.get("/users/{user_id}/app-permissions", response_model=UserAppPermissionsResponse)
async def get_user_app_permissions(
    user_id: int,
    db: Session = Depends(get_db),
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
    db: Session = Depends(get_db),
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

