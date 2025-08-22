import uuid
from sqlalchemy import Boolean, Column, String, Integer, DateTime, Text, ARRAY, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.database import Base


class Application(Base):
    __tablename__ = "applications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    client_id = Column(String(255), unique=True, index=True, nullable=False)
    client_secret = Column(String(255), nullable=False)
    redirect_uris = Column(ARRAY(Text), default=list)
    allowed_scopes = Column(ARRAY(String), default=["read"])
    
    # 安全要求
    required_security_level = Column(Integer, default=1)
    require_mfa = Column(Boolean, default=False)
    
    is_active = Column(Boolean, default=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 关系
    creator = relationship("User", back_populates="applications")
    permissions = relationship("UserPermission", back_populates="application", cascade="all, delete-orphan")
    tokens = relationship("OAuthToken", back_populates="application", cascade="all, delete-orphan")
    device_permissions = relationship("ApplicationDevicePermission", back_populates="application", cascade="all, delete-orphan")


class ApplicationDevicePermission(Base):
    __tablename__ = "application_device_permissions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    application_id = Column(UUID(as_uuid=True), ForeignKey("applications.id"), nullable=False)
    device_id = Column(UUID(as_uuid=True), ForeignKey("user_devices.id"), nullable=False)
    
    granted_permissions = Column(ARRAY(String), default=list)
    expires_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 关系
    user = relationship("User")
    application = relationship("Application", back_populates="device_permissions")
    device = relationship("UserDevice", back_populates="app_permissions")