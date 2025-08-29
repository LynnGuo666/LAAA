from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.core.security import security
from app.services import UserService, ClientService
from app.models import ClientApplication
from app.schemas import (
    UserCreate, UserResponse, UserUpdate,
    ClientApplicationCreate, ClientApplicationResponse,
    ClientApplicationUpdate, ClientApplicationPublic,
    TokenResponse
)
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1", tags=["API"])
security_scheme = HTTPBearer()


class LoginRequest(BaseModel):
    username: str
    password: str


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


@router.post("/auth/login", response_model=TokenResponse)
async def login(
    request: Request,
    login_data: LoginRequest,
    db: Session = Depends(get_db)
):
    """用户登录"""
    user = UserService.authenticate_user(db, login_data.username, login_data.password)
    if not user:
        # 记录失败的登录尝试 - 归属到LAAA Dashboard应用
        from app.api.v1.dashboard import log_login
        from app.models import User
        failed_user = db.query(User).filter(
            (User.username == login_data.username) | (User.email == login_data.username)
        ).first()
        if failed_user:
            await log_login(db, failed_user, request, success=False, failure_reason="密码错误")
        
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码不正确"
        )
    
    # 记录成功的登录
    from app.api.v1.dashboard import log_login
    await log_login(db, user, request, success=True)
    
    # 生成token
    from app.services import OAuth2Service
    access_token = security.create_access_token(data={"sub": user.id})
    refresh_token = security.create_refresh_token(data={"sub": user.id})
    
    return TokenResponse(
        access_token=access_token,
        token_type="Bearer",
        expires_in=1800,  # 30 minutes
        refresh_token=refresh_token
    )


@router.post("/users", response_model=UserResponse)
async def create_user(user: UserCreate, db: Session = Depends(get_db)):
    """创建用户"""
    return UserService.create_user(db, user)


@router.get("/users/me", response_model=UserResponse)
async def get_current_user_info(current_user = Depends(get_current_user)):
    """获取当前用户信息"""
    return current_user


@router.get("/users", response_model=List[UserResponse])
async def list_users(
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取所有用户列表（仅管理员）"""
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有管理员才能访问用户列表"
        )
    
    from app.models import User
    users = db.query(User).all()
    return users


@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user_by_id(
    user_id: str,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取指定用户信息（仅管理员或本人）"""
    if not current_user.is_admin and current_user.id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只能查看自己的信息"
        )
    
    user = UserService.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户未找到")
    return user


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    user_update: UserUpdate,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """更新用户信息（仅管理员或本人）"""
    if not current_user.is_admin and current_user.id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只能修改自己的信息"
        )
    
    return UserService.update_user(db, user_id, user_update)


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """删除用户（仅管理员）"""
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有管理员才能删除用户"
        )
    
    if current_user.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不能删除自己"
        )
    
    success = UserService.delete_user(db, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="用户未找到")
    
    return {"message": "用户删除成功"}


@router.put("/users/me", response_model=UserResponse)
async def update_current_user(
    user_update: UserUpdate,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """更新当前用户信息"""
    return UserService.update_user(db, current_user.id, user_update)


@router.post("/clients", response_model=ClientApplicationResponse)
async def create_client_application(
    client: ClientApplicationCreate,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """创建OAuth客户端应用"""
    return ClientService.create_client(db, client, current_user.id)


@router.get("/clients", response_model=List[ClientApplicationResponse])
async def list_all_clients(
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取所有客户端应用列表（仅管理员）"""
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有管理员才能访问所有应用列表"
        )
    
    import json
    from app.models import ClientApplication
    clients = db.query(ClientApplication).all()
    
    # 处理序列化问题
    result = []
    for client in clients:
        client_data = client.__dict__.copy()
        # 处理redirect_uris和contacts字段
        if client.redirect_uris:
            try:
                client_data['redirect_uris'] = json.loads(client.redirect_uris)
            except (json.JSONDecodeError, TypeError):
                client_data['redirect_uris'] = []
        else:
            client_data['redirect_uris'] = []
            
        if client.contacts:
            try:
                client_data['contacts'] = json.loads(client.contacts)
            except (json.JSONDecodeError, TypeError):
                client_data['contacts'] = []
        else:
            client_data['contacts'] = []
        
        # 移除SQLAlchemy内部属性
        client_data.pop('_sa_instance_state', None)
        result.append(client_data)
    
    return result


@router.put("/clients/{client_id}", response_model=ClientApplicationResponse)
async def update_client(
    client_id: str,
    client_update: ClientApplicationUpdate,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """更新客户端应用"""
    client = ClientService.get_client_by_id(db, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="应用未找到")
    
    # 检查权限：管理员或应用所有者
    if not current_user.is_admin and client.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只能修改自己的应用"
        )
    
    return ClientService.update_client(db, client_id, client_update)


@router.delete("/clients/{client_id}")
async def delete_client(
    client_id: str,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """删除客户端应用"""
    client = ClientService.get_client_by_id(db, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="应用未找到")
    
    # 检查权限：管理员或应用所有者
    if not current_user.is_admin and client.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只能删除自己的应用"
        )
    
    success = ClientService.delete_client(db, client_id)
    if not success:
        raise HTTPException(status_code=404, detail="应用未找到")
    
    return {"message": "应用删除成功"}


@router.get("/clients/my", response_model=List[ClientApplicationResponse])
async def list_my_client_applications(
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取当前用户的客户端应用列表"""
    import json
    from app.models import ClientApplication
    clients = db.query(ClientApplication).filter(
        ClientApplication.owner_id == current_user.id
    ).all()
    
    # 处理序列化问题：将JSON字符串转换为列表
    result = []
    for client in clients:
        client_data = client.__dict__.copy()
        # 处理redirect_uris和contacts字段
        if client.redirect_uris:
            try:
                client_data['redirect_uris'] = json.loads(client.redirect_uris)
            except (json.JSONDecodeError, TypeError):
                client_data['redirect_uris'] = []
        else:
            client_data['redirect_uris'] = []
            
        if client.contacts:
            try:
                client_data['contacts'] = json.loads(client.contacts)
            except (json.JSONDecodeError, TypeError):
                client_data['contacts'] = []
        else:
            client_data['contacts'] = []
        
        # 移除SQLAlchemy内部属性
        client_data.pop('_sa_instance_state', None)
        result.append(client_data)
    
    return result


@router.get("/clients/{client_id}", response_model=ClientApplicationPublic)
async def get_client_public_info(client_id: str, db: Session = Depends(get_db)):
    """获取客户端公开信息"""
    client = ClientService.get_client_by_id(db, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


# 管理员专用：用户权限管理
@router.get("/admin/users/{user_id}/permissions")
async def get_user_permissions(
    user_id: str,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取用户的所有权限（管理员）"""
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有管理员才能访问用户权限"
        )
    
    import json
    from app.models import UserApplicationAccess, ClientApplication
    
    permissions = db.query(UserApplicationAccess).filter(
        UserApplicationAccess.user_id == user_id
    ).all()
    
    result = []
    for perm in permissions:
        # 获取关联的应用信息
        client = db.query(ClientApplication).filter(
            ClientApplication.id == perm.client_id
        ).first()
        
        perm_data = {
            "id": perm.id,
            "user_id": perm.user_id,
            "client_id": perm.client_id,
            "client_name": client.client_name if client else "未知应用",
            "access_type": perm.access_type,
            "custom_scopes": json.loads(perm.custom_scopes) if perm.custom_scopes else [],
            "expires_at": perm.expires_at,
            "notes": perm.notes,
            "granted_at": perm.granted_at,
            "created_at": perm.created_at
        }
        result.append(perm_data)
    
    return result


@router.post("/admin/users/{user_id}/permissions/{client_id}")
async def grant_user_permission(
    user_id: str,
    client_id: str,
    permission_data: dict,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """授予用户权限（管理员）"""
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有管理员才能授予用户权限"
        )
    
    # 验证用户和应用存在
    user = UserService.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    client = ClientService.get_client_by_id(db, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="应用不存在")
    
    # 创建或更新权限
    import json
    from app.models import UserApplicationAccess, ApplicationPermissionGroup
    from datetime import datetime
    
    # 确保权限组存在
    permission_group = db.query(ApplicationPermissionGroup).filter(
        ApplicationPermissionGroup.client_id == client.id
    ).first()
    
    if not permission_group:
        permission_group = ApplicationPermissionGroup(
            client_id=client.id,
            name="默认权限组",
            default_allowed=False,
            allowed_scopes=json.dumps(["openid", "profile", "email"])
        )
        db.add(permission_group)
        db.commit()
        db.refresh(permission_group)
    
    # 查找现有权限
    existing = db.query(UserApplicationAccess).filter(
        UserApplicationAccess.user_id == user_id,
        UserApplicationAccess.client_id == client.id
    ).first()
    
    if existing:
        # 更新现有权限
        existing.access_type = permission_data.get("access_type", "allowed")
        existing.custom_scopes = json.dumps(permission_data.get("scopes", []))
        existing.expires_at = permission_data.get("expires_at")
        existing.notes = permission_data.get("notes")
        existing.granted_by = current_user.id
        existing.granted_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        result = existing
    else:
        # 创建新权限
        new_permission = UserApplicationAccess(
            user_id=user_id,
            client_id=client.id,
            permission_group_id=permission_group.id,
            access_type=permission_data.get("access_type", "allowed"),
            custom_scopes=json.dumps(permission_data.get("scopes", [])),
            expires_at=permission_data.get("expires_at"),
            notes=permission_data.get("notes"),
            granted_by=current_user.id,
            granted_at=datetime.utcnow()
        )
        db.add(new_permission)
        db.commit()
        db.refresh(new_permission)
        result = new_permission
    
    return {
        "message": "权限设置成功",
        "permission_id": result.id,
        "access_type": result.access_type
    }


@router.delete("/admin/users/{user_id}/permissions/{client_id}")
async def revoke_user_permission(
    user_id: str,
    client_id: str,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """撤销用户权限（管理员）"""
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有管理员才能撤销用户权限"
        )
    
    from app.models import UserApplicationAccess
    
    # 验证应用存在
    client = ClientService.get_client_by_id(db, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="应用不存在")
    
    # 查找并删除权限
    permission = db.query(UserApplicationAccess).filter(
        UserApplicationAccess.user_id == user_id,
        UserApplicationAccess.client_id == client.id
    ).first()
    
    if not permission:
        raise HTTPException(status_code=404, detail="权限记录不存在")
    
    db.delete(permission)
    db.commit()
    
    return {"message": "权限撤销成功"}