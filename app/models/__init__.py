from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base
import uuid


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String)
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # OIDC fields
    given_name = Column(String)
    family_name = Column(String)
    middle_name = Column(String)
    nickname = Column(String)
    preferred_username = Column(String)
    profile = Column(String)
    picture = Column(String)
    website = Column(String)
    phone_number = Column(String)
    phone_number_verified = Column(Boolean, default=False)
    email_verified = Column(Boolean, default=False)
    gender = Column(String)
    birthdate = Column(String)
    zoneinfo = Column(String)
    locale = Column(String)

    # Relationships
    client_applications = relationship("ClientApplication", back_populates="owner")
    authorizations = relationship("UserAuthorization", back_populates="user")


class ClientApplication(Base):
    __tablename__ = "client_applications"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    client_id = Column(String, unique=True, index=True, nullable=False)
    client_secret = Column(String, nullable=False)
    client_name = Column(String, nullable=False)
    client_description = Column(Text)
    
    # OAuth2 configuration
    redirect_uris = Column(Text, nullable=False)  # JSON array as string
    response_types = Column(String, default="code")  # "code", "token", "id_token"
    grant_types = Column(String, default="authorization_code,refresh_token")
    scope = Column(String, default="openid profile email")
    
    # Client metadata
    client_uri = Column(String)
    logo_uri = Column(String)
    tos_uri = Column(String)
    policy_uri = Column(String)
    contacts = Column(Text)  # JSON array as string
    
    # Technical settings
    token_endpoint_auth_method = Column(String, default="client_secret_basic")
    jwks_uri = Column(String)
    
    # Owner
    owner_id = Column(String, ForeignKey("users.id"))
    owner = relationship("User", back_populates="client_applications")
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Status
    is_active = Column(Boolean, default=True)

    # Relationships
    authorizations = relationship("UserAuthorization", back_populates="client")
    tokens = relationship("OAuth2Token", back_populates="client")
    authorization_codes = relationship("AuthorizationCode", back_populates="client")


class UserAuthorization(Base):
    __tablename__ = "user_authorizations"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    client_id = Column(String, ForeignKey("client_applications.id"), nullable=False)
    scope = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user = relationship("User", back_populates="authorizations")
    client = relationship("ClientApplication", back_populates="authorizations")


class AuthorizationCode(Base):
    __tablename__ = "authorization_codes"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    code = Column(String, unique=True, index=True, nullable=False)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    client_id = Column(String, ForeignKey("client_applications.id"), nullable=False)
    redirect_uri = Column(String, nullable=False)
    scope = Column(String, nullable=False)
    code_challenge = Column(String)  # PKCE
    code_challenge_method = Column(String, default="S256")  # PKCE
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # OIDC
    nonce = Column(String)
    
    # Relationships
    user = relationship("User")
    client = relationship("ClientApplication", back_populates="authorization_codes")


class OAuth2Token(Base):
    __tablename__ = "oauth2_tokens"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    access_token = Column(Text, nullable=False)
    refresh_token = Column(Text)
    token_type = Column(String, default="Bearer")
    scope = Column(String)
    
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    client_id = Column(String, ForeignKey("client_applications.id"), nullable=False)
    
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    revoked = Column(Boolean, default=False)

    # Relationships
    user = relationship("User")
    client = relationship("ClientApplication", back_populates="tokens")