import uuid
from sqlalchemy import Boolean, Column, String, Integer, DateTime, Text, ARRAY, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.database import Base


class OAuthToken(Base):
    __tablename__ = "oauth_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    application_id = Column(UUID(as_uuid=True), ForeignKey("applications.id"), nullable=False)
    
    access_token = Column(String(500), nullable=False)
    refresh_token = Column(String(500))
    token_type = Column(String(20), default="Bearer")
    expires_at = Column(DateTime(timezone=True), nullable=False)
    scopes = Column(ARRAY(String), default=list)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 关系
    user = relationship("User", back_populates="tokens")
    application = relationship("Application", back_populates="tokens")


class OAuthAuthorizationCode(Base):
    __tablename__ = "oauth_authorization_codes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(255), unique=True, index=True, nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    application_id = Column(UUID(as_uuid=True), ForeignKey("applications.id"), nullable=False)
    
    redirect_uri = Column(Text, nullable=False)
    scopes = Column(ARRAY(String), default=list)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    is_used = Column(Boolean, default=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 关系
    user = relationship("User")
    application = relationship("Application")