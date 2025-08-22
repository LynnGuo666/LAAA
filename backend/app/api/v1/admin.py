from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from ...core.database import get_db
from ...services.admin_service import AdminService
from ...services.permission_service import PermissionService
from ...models.user import User
from ...schemas.admin import (
    InvitationCodeCreate, InvitationCodeResponse,
    ApplicationCreate, ApplicationResponse,
    PermissionCreate, PermissionResponse,
    UserResponse, SystemStats
)
from .auth import get_current_user
import uuid

router = APIRouter()


def require_admin(current_user: User = Depends(get_current_user)):
    """要求管理员权限"""
    if current_user.security_level < 4:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required"
        )
    return current_user


@router.post("/invitation-codes", response_model=InvitationCodeResponse)
async def create_invitation_code(
    invitation_data: InvitationCodeCreate,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """创建邀请码"""
    admin_service = AdminService(db)
    
    invitation = admin_service.create_invitation_code(
        creator_id=admin_user.id,
        security_level=invitation_data.security_level,
        max_uses=invitation_data.max_uses,
        expire_days=invitation_data.expire_days
    )
    
    return invitation


@router.get("/invitation-codes", response_model=List[InvitationCodeResponse])
async def list_invitation_codes(
    active_only: bool = Query(default=True),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """获取邀请码列表"""
    admin_service = AdminService(db)
    
    invitations = admin_service.list_invitation_codes(
        creator_id=admin_user.id if admin_user.security_level < 4 else None,
        active_only=active_only
    )
    
    return invitations


@router.delete("/invitation-codes/{code_id}")
async def deactivate_invitation_code(
    code_id: uuid.UUID,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """停用邀请码"""
    admin_service = AdminService(db)
    
    success = admin_service.deactivate_invitation_code(code_id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invitation code not found"
        )
    
    return {"message": "Invitation code deactivated"}


@router.get("/users", response_model=List[UserResponse])
async def list_users(
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=100),
    security_level: Optional[int] = Query(default=None),
    active_only: bool = Query(default=True),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """获取用户列表"""
    admin_service = AdminService(db)
    
    users = admin_service.list_users(
        page=page,
        size=size,
        security_level=security_level,
        active_only=active_only
    )
    
    return users


@router.put("/users/{user_id}/security-level")
async def update_user_security_level(
    user_id: uuid.UUID,
    security_level: int,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """更新用户安全等级"""
    admin_service = AdminService(db)
    
    if not (1 <= security_level <= 4):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Security level must be between 1 and 4"
        )
    
    success = admin_service.update_user_security_level(user_id, security_level)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return {"message": "User security level updated"}


@router.delete("/users/{user_id}")
async def deactivate_user(
    user_id: uuid.UUID,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """停用用户"""
    if user_id == admin_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate yourself"
        )
    
    admin_service = AdminService(db)
    success = admin_service.deactivate_user(user_id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return {"message": "User deactivated"}


@router.post("/applications", response_model=ApplicationResponse)
async def create_application(
    app_data: ApplicationCreate,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """创建应用"""
    admin_service = AdminService(db)
    
    application = admin_service.create_application(
        creator_id=admin_user.id,
        name=app_data.name,
        description=app_data.description,
        redirect_uris=app_data.redirect_uris,
        required_security_level=app_data.required_security_level,
        require_mfa=app_data.require_mfa
    )
    
    return application


@router.get("/applications", response_model=List[ApplicationResponse])
async def list_applications(
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """获取应用列表"""
    admin_service = AdminService(db)
    
    applications = admin_service.list_applications(
        creator_id=admin_user.id if admin_user.security_level < 4 else None
    )
    
    return applications


@router.put("/applications/{app_id}")
async def update_application(
    app_id: uuid.UUID,
    app_data: ApplicationCreate,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """更新应用"""
    admin_service = AdminService(db)
    
    success = admin_service.update_application(
        app_id,
        name=app_data.name,
        description=app_data.description,
        redirect_uris=app_data.redirect_uris,
        required_security_level=app_data.required_security_level,
        require_mfa=app_data.require_mfa
    )
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found"
        )
    
    return {"message": "Application updated"}


@router.delete("/applications/{app_id}")
async def delete_application(
    app_id: uuid.UUID,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """删除应用"""
    admin_service = AdminService(db)
    
    success = admin_service.delete_application(app_id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found"
        )
    
    return {"message": "Application deleted"}


@router.post("/permissions", response_model=PermissionResponse)
async def create_permission(
    permission_data: PermissionCreate,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """创建权限"""
    admin_service = AdminService(db)
    
    permission = admin_service.create_permission(
        name=permission_data.name,
        resource=permission_data.resource,
        action=permission_data.action,
        description=permission_data.description,
        required_security_level=permission_data.required_security_level,
        require_additional_verification=permission_data.require_additional_verification
    )
    
    return permission


@router.post("/users/{user_id}/permissions/{permission_id}/grant")
async def grant_permission(
    user_id: uuid.UUID,
    permission_id: uuid.UUID,
    application_id: uuid.UUID,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """授予权限"""
    admin_service = AdminService(db)
    
    user_permission = admin_service.grant_permission(
        user_id, permission_id, application_id
    )
    
    return {"message": "Permission granted", "id": str(user_permission.id)}


@router.delete("/users/{user_id}/permissions/{permission_id}")
async def revoke_permission(
    user_id: uuid.UUID,
    permission_id: uuid.UUID,
    application_id: uuid.UUID,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """撤销权限"""
    admin_service = AdminService(db)
    
    success = admin_service.revoke_permission(
        user_id, permission_id, application_id
    )
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Permission not found"
        )
    
    return {"message": "Permission revoked"}


@router.get("/stats", response_model=SystemStats)
async def get_system_stats(
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """获取系统统计信息"""
    admin_service = AdminService(db)
    
    stats = admin_service.get_system_stats()
    
    return stats