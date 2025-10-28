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

