import uuid
from sqlalchemy import Boolean, Column, String, Integer, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.database import Base


class Permission(Base):
    __tablename__ = "permissions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), nullable=False)
    description = Column(Text)
    resource = Column(String(100), nullable=False)
    action = Column(String(50), nullable=False)
    
    # 安全要求
    required_security_level = Column(Integer, default=1)
    require_additional_verification = Column(Boolean, default=False)
    
    # 关系
    user_permissions = relationship("UserPermission", back_populates="permission", cascade="all, delete-orphan")


class UserPermission(Base):
    __tablename__ = "user_permissions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    permission_id = Column(String(36), ForeignKey("permissions.id"), nullable=False)
    application_id = Column(String(36), ForeignKey("applications.id"), nullable=False)
    
    granted_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 关系
    user = relationship("User", back_populates="permissions")
    permission = relationship("Permission", back_populates="user_permissions")
    application = relationship("Application", back_populates="permissions")