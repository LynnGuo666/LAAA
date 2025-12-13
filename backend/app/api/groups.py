from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.middleware.permission import require_permission
from app.models import User, Group, Client
from app.schemas.group import (
    GroupCreate,
    GroupUpdate,
    GroupResponse,
    GroupMembersUpdate
)
from app.schemas.admin import (
    AppPermissionItem,
    GroupAppPermissionsResponse,
    GroupAppPermissionsUpdate,
)
from app.services.group_service import GroupService

router = APIRouter()


@router.post('/', response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
def create_group(
    group_data: GroupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission('admin.groups'))
):
    """创建用户组（管理员）"""
    # Check if group name already exists
    existing_group = GroupService.get_group_by_name(db, group_data.name)
    if existing_group:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户组名称已存在"
        )

    group = GroupService.create_group(db, group_data)

    # Add member count
    response = GroupResponse.model_validate(group)
    response.member_count = len(group.users)
    return response


@router.get('/', response_model=List[GroupResponse])
def list_groups(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission('admin.groups'))
):
    """获取用户组列表（管理员）"""
    groups = GroupService.list_groups(db, skip, limit)

    # Add member counts
    result = []
    for group in groups:
        response = GroupResponse.model_validate(group)
        response.member_count = len(group.users)
        result.append(response)

    return result


@router.get('/{group_id}', response_model=GroupResponse)
def get_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission('admin.groups'))
):
    """获取用户组详情（管理员）"""
    group = GroupService.get_group(db, group_id)
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户组不存在"
        )

    response = GroupResponse.model_validate(group)
    response.member_count = len(group.users)
    return response


@router.put('/{group_id}', response_model=GroupResponse)
def update_group(
    group_id: int,
    group_data: GroupUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission('admin.groups'))
):
    """更新用户组（管理员）"""
    # Check if new name conflicts
    if group_data.name:
        existing_group = GroupService.get_group_by_name(db, group_data.name)
        if existing_group and existing_group.id != group_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="用户组名称已存在"
            )

    group = GroupService.update_group(db, group_id, group_data)
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户组不存在"
        )

    response = GroupResponse.model_validate(group)
    response.member_count = len(group.users)
    return response


@router.delete('/{group_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission('admin.groups'))
):
    """删除用户组（管理员）"""
    success = GroupService.delete_group(db, group_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户组不存在"
        )


@router.post('/{group_id}/members', response_model=GroupResponse)
def add_group_members(
    group_id: int,
    members: GroupMembersUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission('admin.groups'))
):
    """添加用户组成员（管理员）"""
    group = GroupService.add_users_to_group(db, group_id, members.user_ids)
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户组不存在"
        )

    response = GroupResponse.model_validate(group)
    response.member_count = len(group.users)
    return response


@router.delete('/{group_id}/members', response_model=GroupResponse)
def remove_group_members(
    group_id: int,
    members: GroupMembersUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission('admin.groups'))
):
    """移除用户组成员（管理员）"""
    group = GroupService.remove_users_from_group(db, group_id, members.user_ids)
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户组不存在"
        )

    response = GroupResponse.model_validate(group)
    response.member_count = len(group.users)
    return response


@router.put('/{group_id}/members', response_model=GroupResponse)
def set_group_members(
    group_id: int,
    members: GroupMembersUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission('admin.groups'))
):
    """设置用户组成员（管理员，覆盖式）"""
    group = GroupService.set_group_members(db, group_id, members.user_ids)
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户组不存在"
        )

    response = GroupResponse.model_validate(group)
    response.member_count = len(group.users)
    return response


# ==================== Group App Permissions ====================

@router.get('/{group_id}/app-permissions', response_model=GroupAppPermissionsResponse)
def get_group_app_permissions(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission('admin.groups'))
):
    """获取用户组的应用权限"""
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户组不存在"
        )

    return GroupAppPermissionsResponse(
        group_id=group.id,
        group_name=group.name,
        allowed_apps=[
            AppPermissionItem(id=app.id, client_id=app.client_id, name=app.name, logo=app.logo)
            for app in group.allowed_apps
        ],
        denied_apps=[
            AppPermissionItem(id=app.id, client_id=app.client_id, name=app.name, logo=app.logo)
            for app in group.denied_apps
        ]
    )


@router.put('/{group_id}/app-permissions', response_model=GroupAppPermissionsResponse)
def update_group_app_permissions(
    group_id: int,
    permissions: GroupAppPermissionsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission('admin.groups'))
):
    """更新用户组的应用权限"""
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户组不存在"
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

    # 更新用户组的应用权限
    group.allowed_apps = allowed_apps
    group.denied_apps = denied_apps

    db.commit()
    db.refresh(group)

    return GroupAppPermissionsResponse(
        group_id=group.id,
        group_name=group.name,
        allowed_apps=[
            AppPermissionItem(id=app.id, client_id=app.client_id, name=app.name, logo=app.logo)
            for app in group.allowed_apps
        ],
        denied_apps=[
            AppPermissionItem(id=app.id, client_id=app.client_id, name=app.name, logo=app.logo)
            for app in group.denied_apps
        ]
    )
