import uuid
from sqlalchemy import Boolean, Column, String, Integer, DateTime, Text, JSON, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.database import Base


class OAuthToken(Base):
    __tablename__ = "oauth_tokens"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    application_id = Column(String(36), ForeignKey("applications.id"), nullable=False)
    
    access_token = Column(String(500), nullable=False)
    refresh_token = Column(String(500))
    token_type = Column(String(20), default="Bearer")
    expires_at = Column(DateTime(timezone=True), nullable=False)
    scopes = Column(JSON, default=list)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 关系
    user = relationship("User", back_populates="tokens")
    application = relationship("Application", back_populates="tokens")


class OAuthAuthorizationCode(Base):
    __tablename__ = "oauth_authorization_codes"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    code = Column(String(255), unique=True, index=True, nullable=False)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    application_id = Column(String(36), ForeignKey("applications.id"), nullable=False)
    
    redirect_uri = Column(Text, nullable=False)
    scopes = Column(JSON, default=list)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    is_used = Column(Boolean, default=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 关系
    user = relationship("User")
    application = relationship("Application")