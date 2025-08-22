import uuid
from sqlalchemy import Boolean, Column, String, Integer, DateTime, Text, JSON, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    
    # 安全等级和MFA
    security_level = Column(Integer, default=1)
    totp_secret = Column(String(255))
    totp_enabled = Column(Boolean, default=False)
    email_verified = Column(Boolean, default=False)
    phone = Column(String(20))
    phone_verified = Column(Boolean, default=False)
    backup_codes = Column(JSON, default=list)
    
    # 账户状态
    is_active = Column(Boolean, default=True)
    is_superuser = Column(Boolean, default=False)
    created_by = Column(String(36), ForeignKey("users.id"))
    
    # 时间戳
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    last_login_at = Column(DateTime(timezone=True))
    
    # 安全控制
    failed_login_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime(timezone=True))
    
    # 关系
    created_users = relationship("User", back_populates="creator")
    creator = relationship("User", back_populates="created_users", remote_side=[id])
    devices = relationship("UserDevice", back_populates="user", cascade="all, delete-orphan")
    permissions = relationship("UserPermission", back_populates="user", cascade="all, delete-orphan")
    applications = relationship("Application", back_populates="creator")
    tokens = relationship("OAuthToken", back_populates="user", cascade="all, delete-orphan")
    invitations_created = relationship("InvitationCode", back_populates="creator", foreign_keys="InvitationCode.created_by")
    invitation_used = relationship("InvitationCode", back_populates="used_by_user", foreign_keys="InvitationCode.used_by")


class InvitationCode(Base):
    __tablename__ = "invitation_codes"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    code = Column(String(32), unique=True, index=True, nullable=False)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=False)
    used_by = Column(String(36), ForeignKey("users.id"))
    
    max_uses = Column(Integer, default=1)
    current_uses = Column(Integer, default=0)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    security_level = Column(Integer, default=1)
    is_active = Column(Boolean, default=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    used_at = Column(DateTime(timezone=True))
    
    # 关系
    creator = relationship("User", back_populates="invitations_created", foreign_keys=[created_by])
    used_by_user = relationship("User", back_populates="invitation_used", foreign_keys=[used_by])


class UserDevice(Base):
    __tablename__ = "user_devices"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    device_id = Column(String(255), nullable=False)
    device_name = Column(String(100))
    device_type = Column(String(50))  # web, mobile, desktop
    device_fingerprint = Column(Text)
    is_trusted = Column(Boolean, default=False)
    
    last_seen_at = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 关系
    user = relationship("User", back_populates="devices")
    app_permissions = relationship("ApplicationDevicePermission", back_populates="device", cascade="all, delete-orphan")


class SecurityVerification(Base):
    __tablename__ = "security_verifications"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    verification_type = Column(String(20), nullable=False)  # totp, email, sms
    verification_code = Column(String(10))
    expires_at = Column(DateTime(timezone=True), nullable=False)
    is_used = Column(Boolean, default=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 关系
    user = relationship("User")