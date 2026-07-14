from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime


class GroupBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=50, description="用户组名称")
    description: Optional[str] = Field(None, description="用户组描述")
    is_default: bool = Field(False, description="是否为默认组（新用户自动加入）")


class GroupCreate(GroupBase):
    pass


class GroupUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=50)
    description: Optional[str] = None
    is_default: Optional[bool] = None


class GroupResponse(GroupBase):
    id: int
    created_at: datetime
    updated_at: datetime
    member_count: Optional[int] = Field(None, description="成员数量")

    model_config = ConfigDict(from_attributes=True)


class GroupMembersUpdate(BaseModel):
    user_ids: List[int] = Field(..., description="用户 ID 列表")


class ClientAccessControlUpdate(BaseModel):
    allowed_group_ids: List[int] = Field(default=[], description="允许访问的用户组 ID 列表（白名单）")
    denied_group_ids: List[int] = Field(default=[], description="禁止访问的用户组 ID 列表（黑名单）")
