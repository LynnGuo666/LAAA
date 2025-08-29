from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from app.core.database import get_db
from app.core.security import security
from app.services.permission_management_service import PermissionManagementService
from app.services import UserService, ClientService
from app.schemas import (
    PermissionCheckRequest, PermissionCheckResponse
)
from pydantic import BaseModel
from datetime import datetime

router = APIRouter(prefix="/api/v1/permissions", tags=["权限管理"])
security_scheme = HTTPBearer()


# Permission Group Management Schemas
class PermissionGroupCreate(BaseModel):
    name: str = "默认权限组"
    description: str = None
    default_allowed: bool = False
    allowed_scopes: List[str] = None


class PermissionGroupUpdate(BaseModel):
    name: str = None
    description: str = None
    default_allowed: bool = None
    allowed_scopes: List[str] = None


class PermissionGroupResponse(BaseModel):
    id: str
    client_id: str
    name: str
    description: Optional[str] = None
    default_allowed: bool
    allowed_scopes: Optional[List[str]] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class UserAccessCreate(BaseModel):
    user_id: str
    access_type: str = "allowed"  # allowed, denied
    custom_scopes: List[str] = None
    expires_at: datetime = None
    notes: str = None


class UserAccessUpdate(BaseModel):
    access_type: str = None
    custom_scopes: List[str] = None
    expires_at: datetime = None
    notes: str = None


class UserAccessResponse(BaseModel):
    id: str
    user_id: str
    client_id: str
    access_type: str
    custom_scopes: Optional[List[str]] = None
    granted_by: Optional[str] = None
    granted_at: Optional[datetime] = None
    notes: Optional[str] = None
    expires_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security_scheme),
    db: Session = Depends(get_db)
):
    """获取当前用户"""
    access_token = credentials.credentials
    try:
        payload = security.verify_token(access_token)
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token"
            )
        
        user = UserService.get_user_by_id(db, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found"
            )
        return user
    except HTTPException:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


def require_admin(current_user = Depends(get_current_user)):
    """要求管理员权限"""
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限"
        )
    return current_user


@router.post("/check", response_model=PermissionCheckResponse)
async def check_permission(
    request: PermissionCheckRequest,
    db: Session = Depends(get_db)
):
    """检查用户权限"""
    return PermissionManagementService.check_user_access(
        db, request.user_id, request.client_id, request.requested_scopes
    )


# Permission Group Management APIs
@router.get("/groups", response_model=List[PermissionGroupResponse])
async def list_permission_groups(
    db: Session = Depends(get_db),
    admin_user = Depends(require_admin)
):
    """获取所有权限组（管理员）"""
    import json
    from app.models import ApplicationPermissionGroup
    
    groups = db.query(ApplicationPermissionGroup).all()
    result = []
    for group in groups:
        group_data = group.__dict__.copy()
        # 处理allowed_scopes字段
        if group.allowed_scopes:
            try:
                group_data['allowed_scopes'] = json.loads(group.allowed_scopes)
            except (json.JSONDecodeError, TypeError):
                group_data['allowed_scopes'] = []
        else:
            group_data['allowed_scopes'] = []
        
        group_data.pop('_sa_instance_state', None)
        result.append(group_data)
    
    return result


@router.get("/groups/{client_id}", response_model=PermissionGroupResponse) 
async def get_permission_group(
    client_id: str,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """获取应用权限组"""
    import json
    from app.models import ApplicationPermissionGroup
    
    # 检查权限
    client = ClientService.get_client_by_id(db, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="应用不存在")
    
    if client.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有应用拥有者或管理员可以查看此应用的权限"
        )
    
    group = db.query(ApplicationPermissionGroup).filter(
        ApplicationPermissionGroup.client_id == client.id
    ).first()
    
    if not group:
        # 如果不存在，创建默认权限组
        group = ApplicationPermissionGroup(
            client_id=client.id,
            name="默认权限组",
            default_allowed=False,
            allowed_scopes=json.dumps(["openid", "profile", "email"])
        )
        db.add(group)
        db.commit()
        db.refresh(group)
    
    # 处理序列化
    group_data = group.__dict__.copy()
    if group.allowed_scopes:
        try:
            group_data['allowed_scopes'] = json.loads(group.allowed_scopes)
        except (json.JSONDecodeError, TypeError):
            group_data['allowed_scopes'] = []
    else:
        group_data['allowed_scopes'] = []
    
    group_data.pop('_sa_instance_state', None)
    return group_data
@router.post("/groups/{client_id}", response_model=PermissionGroupResponse)
async def create_permission_group(
    client_id: str,
    group: PermissionGroupCreate,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """创建或更新应用权限组"""
    # 检查权限
    client = ClientService.get_client_by_id(db, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="应用不存在")
    
    if client.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有应用拥有者或管理员可以管理此应用的权限"
        )
    
    result = PermissionManagementService.create_or_update_permission_group(
        db=db,
        client_id=client_id,
        name=group.name,
        description=group.description,
        default_allowed=group.default_allowed,
        allowed_scopes=group.allowed_scopes,
        creator_id=current_user.id
    )
    
    # 处理序列化问题
    import json
    group_data = result.__dict__.copy()
    
    # 处理allowed_scopes字段
    if result.allowed_scopes:
        try:
            group_data['allowed_scopes'] = json.loads(result.allowed_scopes)
        except (json.JSONDecodeError, TypeError):
            group_data['allowed_scopes'] = []
    else:
        group_data['allowed_scopes'] = []
    
    group_data.pop('_sa_instance_state', None)
    return group_data


@router.get("/groups/{client_id}", response_model=PermissionGroupResponse)
async def get_permission_group(
    client_id: str,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """获取应用权限组配置"""
    # 检查权限
    client = ClientService.get_client_by_id(db, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="应用不存在")
    
    if client.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有应用拥有者或管理员可以管理此应用的权限"
        )
    
    from app.models import ApplicationPermissionGroup
    group = db.query(ApplicationPermissionGroup).filter(
        ApplicationPermissionGroup.client_id == client_id
    ).first()
    
    if not group:
        raise HTTPException(status_code=404, detail="权限组不存在")
    
    return group


@router.put("/groups/{client_id}", response_model=PermissionGroupResponse)
async def update_permission_group(
    client_id: str,
    group: PermissionGroupUpdate,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """更新应用权限组"""
    # 检查权限
    client = ClientService.get_client_by_id(db, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="应用不存在")
    
    if client.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有应用拥有者或管理员可以管理此应用的权限"
        )
    
    # 获取现有权限组
    from app.models import ApplicationPermissionGroup
    existing_group = db.query(ApplicationPermissionGroup).filter(
        ApplicationPermissionGroup.client_id == client_id
    ).first()
    
    if not existing_group:
        raise HTTPException(status_code=404, detail="权限组不存在")
    
    # 更新字段
    if group.name is not None:
        existing_group.name = group.name
    if group.description is not None:
        existing_group.description = group.description
    if group.default_allowed is not None:
        existing_group.default_allowed = group.default_allowed
    if group.allowed_scopes is not None:
        import json
        existing_group.allowed_scopes = json.dumps(group.allowed_scopes)
    
    existing_group.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(existing_group)
    
    # 处理序列化问题
    group_data = existing_group.__dict__.copy()
    
    # 处理allowed_scopes字段
    if existing_group.allowed_scopes:
        try:
            group_data['allowed_scopes'] = json.loads(existing_group.allowed_scopes)
        except (json.JSONDecodeError, TypeError):
            group_data['allowed_scopes'] = []
    else:
        group_data['allowed_scopes'] = []
    
    group_data.pop('_sa_instance_state', None)
    return group_data


# User Access Management APIs
@router.post("/access/{client_id}", response_model=UserAccessResponse)
async def grant_user_access(
    client_id: str,
    access: UserAccessCreate,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """授予或拒绝用户访问权限"""
    # 检查权限
    client = ClientService.get_client_by_id(db, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="应用不存在")
    
    if client.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有应用拥有者或管理员可以管理此应用的权限"
        )
    
    result = PermissionManagementService.grant_user_access(
        db=db,
        user_id=access.user_id,
        client_id=client_id,
        access_type=access.access_type,
        custom_scopes=access.custom_scopes,
        expires_at=access.expires_at,
        notes=access.notes,
        granted_by=current_user.id
    )
    return result


@router.get("/access/{client_id}")
async def get_client_permissions(
    client_id: str,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """获取应用的完整权限配置"""
    # 检查权限
    client = ClientService.get_client_by_id(db, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="应用不存在")
    
    if client.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有应用拥有者或管理员可以管理此应用的权限"
        )
    
    permissions = PermissionManagementService.get_client_permissions(db, client_id)
    return permissions


@router.delete("/access/{client_id}/user/{user_id}")
async def revoke_user_access(
    client_id: str,
    user_id: str,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """撤销用户访问权限"""
    # 检查权限
    client = ClientService.get_client_by_id(db, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="应用不存在")
    
    if client.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有应用拥有者或管理员可以管理此应用的权限"
        )
    
    success = PermissionManagementService.revoke_user_access(db, user_id, client_id)
    if success:
        return {"message": "权限已撤销"}
    else:
        raise HTTPException(status_code=404, detail="权限记录不存在")


@router.get("/user/{user_id}/accessible-clients")
async def get_user_accessible_clients(
    user_id: str,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取用户可以访问的应用列表"""
    # 用户只能查看自己的权限，管理员可以查看所有用户
    if current_user.id != user_id and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权查看其他用户的权限"
        )
    
    clients = PermissionManagementService.get_user_accessible_clients(db, user_id)
    return clients