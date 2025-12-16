from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime


class AdminUserResponse(BaseModel):
    """用户详情响应（管理员视图）"""
    id: int
    username: str
    email: EmailStr
    avatar: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: datetime
    groups: List[str] = []  # Group names
    roles: List[str] = []  # Role names

    class Config:
        from_attributes = True


class AdminUserUpdate(BaseModel):
    """管理员更新用户信息"""
    email: Optional[EmailStr] = None
    avatar: Optional[str] = None
    status: Optional[str] = Field(None, pattern="^(active|inactive|suspended)$")
    password: Optional[str] = Field(None, min_length=6)


class AdminUserCreate(BaseModel):
    """管理员创建用户"""
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=6)
    status: str = Field("active", pattern="^(active|inactive|suspended)$")


class AdminUserGroupsUpdate(BaseModel):
    """更新用户所属的组"""
    group_ids: List[int]


class AdminUserRolesUpdate(BaseModel):
    """更新用户的角色"""
    role_ids: List[int]


class RoleResponse(BaseModel):
    """角色响应"""
    id: int
    name: str
    description: Optional[str] = None
    level: int

    class Config:
        from_attributes = True


# App Permission Schemas
class AppPermissionItem(BaseModel):
    """应用权限项"""
    id: int
    client_id: str
    name: str
    logo: Optional[str] = None


class UserAppPermissionsResponse(BaseModel):
    """用户应用权限响应"""
    user_id: int
    username: str
    allowed_apps: List[AppPermissionItem] = []
    denied_apps: List[AppPermissionItem] = []


class UserAppPermissionsUpdate(BaseModel):
    """更新用户应用权限"""
    allowed_app_ids: List[int] = []
    denied_app_ids: List[int] = []


class GroupAppPermissionsResponse(BaseModel):
    """用户组应用权限响应"""
    group_id: int
    group_name: str
    allowed_apps: List[AppPermissionItem] = []
    denied_apps: List[AppPermissionItem] = []


class GroupAppPermissionsUpdate(BaseModel):
    """更新用户组应用权限"""
    allowed_app_ids: List[int] = []
    denied_app_ids: List[int] = []


# Computed App Permissions (for detailed view)
class ComputedAppPermission(BaseModel):
    """计算后的应用权限"""
    app_id: int
    client_id: str
    app_name: str
    app_logo: Optional[str] = None
    can_access: bool  # 最终结果
    source: str  # 权限来源: user_denied, user_allowed, group_denied, group_allowed, default
    source_detail: Optional[str] = None  # 详细说明，如组名
    user_permission: Optional[str] = None  # 用户级别设置: allowed, denied, null


class ComputedAppPermissionsResponse(BaseModel):
    """用户计算后应用权限响应（分页）"""
    user_id: int
    username: str
    groups: List[str] = []  # 用户所属组
    total: int  # 总数
    items: List[ComputedAppPermission] = []


class PaginatedUsersResponse(BaseModel):
    """分页用户列表响应"""
    total: int
    items: List[AdminUserResponse] = []


# ==================== Admin User Detail Schemas ====================

class AdminLoginLogResponse(BaseModel):
    """管理员查看的登录日志"""
    id: int
    username: str
    success: bool
    failure_reason: Optional[str] = None
    ip_address: Optional[str] = None
    device_type: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    login_method: Optional[str] = None
    is_suspicious: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class PaginatedLoginLogsResponse(BaseModel):
    """分页登录日志响应"""
    total: int
    items: List[AdminLoginLogResponse] = []


class AdminSessionResponse(BaseModel):
    """管理员查看的会话"""
    id: int
    device_id: str
    device_name: Optional[str] = None
    device_type: Optional[str] = None
    ip_address: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    last_active: datetime
    expires_at: datetime
    created_at: datetime
    is_trusted: bool = False

    class Config:
        from_attributes = True


class AdminPasskeyResponse(BaseModel):
    """管理员查看的通行密钥"""
    id: int
    name: str
    credential_id: str
    created_at: datetime
    last_used_at: Optional[datetime] = None
    backup_eligible: bool = False
    aaguid: Optional[str] = None

    class Config:
        from_attributes = True


class AdminAuthorizationResponse(BaseModel):
    """管理员查看的用户授权"""
    id: int
    client_id: str
    client_name: str
    client_logo: Optional[str] = None
    scope: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

