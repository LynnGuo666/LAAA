import uuid
from sqlalchemy import Boolean, Column, String, Integer, DateTime, Text, JSON, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.database import Base


class Application(Base):
    __tablename__ = "applications"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), nullable=False)
    description = Column(Text)
    logo_url = Column(String(500))  # 应用图标URL
    website_url = Column(String(500))  # 应用官网
    support_email = Column(String(255))  # 支持邮箱
    privacy_policy_url = Column(String(500))  # 隐私政策链接
    terms_of_service_url = Column(String(500))  # 服务条款链接
    client_id = Column(String(255), unique=True, index=True, nullable=False)
    client_secret = Column(String(255), nullable=False)
    redirect_uris = Column(JSON, default=list)
    allowed_scopes = Column(JSON, default=["read"])
    
    # 安全要求
    required_security_level = Column(Integer, default=1)
    require_mfa = Column(Boolean, default=False)
    
    is_active = Column(Boolean, default=True)
    created_by = Column(String(36), ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 关系
    creator = relationship("User", back_populates="applications")
    permissions = relationship("UserPermission", back_populates="application", cascade="all, delete-orphan")
    tokens = relationship("OAuthToken", back_populates="application", cascade="all, delete-orphan")
    device_permissions = relationship("ApplicationDevicePermission", back_populates="application", cascade="all, delete-orphan")


class ApplicationDevicePermission(Base):
    __tablename__ = "application_device_permissions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    application_id = Column(String(36), ForeignKey("applications.id"), nullable=False)
    device_id = Column(String(36), ForeignKey("user_devices.id"), nullable=False)
    
    granted_permissions = Column(JSON, default=list)
    expires_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 关系
    user = relationship("User")
    application = relationship("Application", back_populates="device_permissions")
    device = relationship("UserDevice", back_populates="app_permissions")