from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey, Table
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


# User-Role association table
user_roles = Table(
    'user_roles',
    Base.metadata,
    Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE')),
    Column('role_id', Integer, ForeignKey('roles.id', ondelete='CASCADE')),
    Column('created_at', DateTime, default=datetime.utcnow)
)


# Role-Permission association table
role_permissions = Table(
    'role_permissions',
    Base.metadata,
    Column('role_id', Integer, ForeignKey('roles.id', ondelete='CASCADE')),
    Column('permission_id', Integer, ForeignKey('permissions.id', ondelete='CASCADE')),
    Column('created_at', DateTime, default=datetime.utcnow)
)


class User(Base):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    avatar = Column(String(255), nullable=True)
    status = Column(String(20), default='active')  # active, inactive, suspended
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    roles = relationship('Role', secondary=user_roles, back_populates='users')
    clients = relationship('Client', back_populates='owner', cascade='all, delete-orphan')
    authorizations = relationship('UserAuthorization', back_populates='user', cascade='all, delete-orphan')
    tokens = relationship('Token', back_populates='user', cascade='all, delete-orphan')
    sessions = relationship('Session', back_populates='user', cascade='all, delete-orphan')

    def has_permission(self, permission_code: str) -> bool:
        """Check if user has a specific permission"""
        for role in self.roles:
            # Check for wildcard admin permission
            if any(p.code == 'admin.*' for p in role.permissions):
                return True
            # Check for specific permission
            if any(p.code == permission_code for p in role.permissions):
                return True
        return False

    def has_role(self, role_name: str) -> bool:
        """Check if user has a specific role"""
        return any(role.name == role_name for role in self.roles)


class Client(Base):
    __tablename__ = 'clients'

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(String(100), unique=True, index=True, nullable=False)
    client_secret_hash = Column(String(255), nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    logo = Column(String(255), nullable=True)
    redirect_uris = Column(Text, nullable=False)  # JSON array stored as text
    allowed_scopes = Column(Text, nullable=False)  # JSON array stored as text
    trusted = Column(Boolean, default=False)  # Skip authorization for trusted apps
    owner_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    owner = relationship('User', back_populates='clients')
    authorizations = relationship('UserAuthorization', back_populates='client', cascade='all, delete-orphan')
    tokens = relationship('Token', back_populates='client', cascade='all, delete-orphan')


class UserAuthorization(Base):
    __tablename__ = 'user_authorizations'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    client_id = Column(Integer, ForeignKey('clients.id', ondelete='CASCADE'), nullable=False)
    scope = Column(Text, nullable=False)  # Space-separated scopes
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship('User', back_populates='authorizations')
    client = relationship('Client', back_populates='authorizations')


class Token(Base):
    __tablename__ = 'tokens'

    id = Column(Integer, primary_key=True, index=True)
    token_hash = Column(String(255), unique=True, index=True, nullable=False)
    type = Column(String(20), nullable=False)  # access, refresh, authorization_code
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    client_id = Column(Integer, ForeignKey('clients.id', ondelete='CASCADE'), nullable=False)
    scope = Column(Text, nullable=False)
    device_info = Column(Text, nullable=True)  # JSON with device information
    redirect_uri = Column(String(500), nullable=True)  # For authorization codes
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship('User', back_populates='tokens')
    client = relationship('Client', back_populates='tokens')


class Session(Base):
    __tablename__ = 'sessions'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    device_id = Column(String(100), unique=True, index=True, nullable=False)
    device_name = Column(String(100), nullable=True)
    device_type = Column(String(50), nullable=True)  # web, mobile, desktop
    refresh_token_hash = Column(String(255), nullable=True)
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(Text, nullable=True)
    last_active = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship('User', back_populates='sessions')


class Role(Base):
    __tablename__ = 'roles'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)
    description = Column(Text, nullable=True)
    level = Column(Integer, default=0)  # Higher level = more permissions
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    users = relationship('User', secondary=user_roles, back_populates='roles')
    permissions = relationship('Permission', secondary=role_permissions, back_populates='roles')


class Permission(Base):
    __tablename__ = 'permissions'

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(100), unique=True, nullable=False)  # e.g., 'user.read', 'admin.*'
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    roles = relationship('Role', secondary=role_permissions, back_populates='permissions')


class AuditLog(Base):
    __tablename__ = 'audit_logs'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    action = Column(String(100), nullable=False)  # login, logout, authorize, etc.
    resource = Column(String(100), nullable=True)  # What was accessed
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(Text, nullable=True)
    details = Column(Text, nullable=True)  # JSON with additional info
    created_at = Column(DateTime, default=datetime.utcnow)
