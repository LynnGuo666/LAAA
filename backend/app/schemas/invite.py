from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class InviteCodeCreate(BaseModel):
    group_id: int
    expires_at: Optional[datetime] = None
    max_uses: Optional[int] = Field(None, ge=1, description="NULL 表示不限制")
    note: Optional[str] = Field(None, max_length=2000)


class InviteCodeUpdate(BaseModel):
    is_active: Optional[bool] = None
    expires_at: Optional[datetime] = None
    max_uses: Optional[int] = Field(None, ge=1, description="NULL 表示不限制")
    note: Optional[str] = Field(None, max_length=2000)


class InviteCodeResponse(BaseModel):
    id: int
    code: str
    note: Optional[str] = None
    group_id: int
    group_name: str
    is_active: bool
    expires_at: Optional[datetime] = None
    max_uses: Optional[int] = None
    used_count: int = 0
    created_by_user_id: Optional[int] = None
    used_by_user_id: Optional[int] = None
    used_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
