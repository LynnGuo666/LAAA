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


# User-Group association table
user_groups = Table(
    'user_groups',
    Base.metadata,
    Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE')),
    Column('group_id', Integer, ForeignKey('groups.id', ondelete='CASCADE')),
    Column('created_at', DateTime, default=datetime.utcnow)
)


# Client-Group association tables for access control (legacy, will be deprecated)
client_allowed_groups = Table(
    'client_allowed_groups',
    Base.metadata,
    Column('client_id', Integer, ForeignKey('clients.id', ondelete='CASCADE')),
    Column('group_id', Integer, ForeignKey('groups.id', ondelete='CASCADE')),
    Column('created_at', DateTime, default=datetime.utcnow)
)

client_denied_groups = Table(
    'client_denied_groups',
    Base.metadata,
    Column('client_id', Integer, ForeignKey('clients.id', ondelete='CASCADE')),
    Column('group_id', Integer, ForeignKey('groups.id', ondelete='CASCADE')),
    Column('created_at', DateTime, default=datetime.utcnow)
)


# Group-App permission tables (new)
group_allowed_apps = Table(
    'group_allowed_apps',
    Base.metadata,
    Column('group_id', Integer, ForeignKey('groups.id', ondelete='CASCADE')),
    Column('client_id', Integer, ForeignKey('clients.id', ondelete='CASCADE')),
    Column('created_at', DateTime, default=datetime.utcnow)
)

group_denied_apps = Table(
    'group_denied_apps',
    Base.metadata,
    Column('group_id', Integer, ForeignKey('groups.id', ondelete='CASCADE')),
    Column('client_id', Integer, ForeignKey('clients.id', ondelete='CASCADE')),
    Column('created_at', DateTime, default=datetime.utcnow)
)


# User-App permission tables (new, for individual overrides)
user_allowed_apps = Table(
    'user_allowed_apps',
    Base.metadata,
    Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE')),
    Column('client_id', Integer, ForeignKey('clients.id', ondelete='CASCADE')),
    Column('created_at', DateTime, default=datetime.utcnow)
)

user_denied_apps = Table(
    'user_denied_apps',
    Base.metadata,
    Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE')),
    Column('client_id', Integer, ForeignKey('clients.id', ondelete='CASCADE')),
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

    # Session security settings
    max_sessions = Column(Integer, default=3)  # Maximum concurrent sessions
    notify_new_login = Column(Boolean, default=True)  # Notify on new device login

    # Relationships
    roles = relationship('Role', secondary=user_roles, back_populates='users')
    groups = relationship('Group', secondary=user_groups, back_populates='users')
    clients = relationship('Client', back_populates='owner', cascade='all, delete-orphan')
    authorizations = relationship('UserAuthorization', back_populates='user', cascade='all, delete-orphan')
    tokens = relationship('Token', back_populates='user', cascade='all, delete-orphan')
    sessions = relationship('Session', back_populates='user', cascade='all, delete-orphan')
    passkeys = relationship('Passkey', back_populates='user', cascade='all, delete-orphan')
    login_logs = relationship('LoginLog', back_populates='user', cascade='all, delete-orphan')
    # App permissions (individual overrides)
    allowed_apps = relationship('Client', secondary=user_allowed_apps, backref='users_allowed')
    denied_apps = relationship('Client', secondary=user_denied_apps, backref='users_denied')

    def has_permission(self, permission_code: str) -> bool:
        """Check if user has a specific permission

        Supports wildcard matching:
        - 'admin.*' grants all admin.* permissions (admin.users, admin.roles, etc.)
        - Exact match for specific permissions
        """
        for role in self.roles:
            for perm in role.permissions:
                # Exact match
                if perm.code == permission_code:
                    return True
                # Wildcard match: admin.* matches admin.users, admin.roles, etc.
                if perm.code.endswith('.*'):
                    prefix = perm.code[:-1]  # 'admin.' from 'admin.*'
                    if permission_code.startswith(prefix) or permission_code == perm.code:
                        return True
        return False

    def has_role(self, role_name: str) -> bool:
        """Check if user has a specific role"""
        return any(role.name == role_name for role in self.roles)

    def in_group(self, group_name: str) -> bool:
        """Check if user is in a specific group"""
        return any(group.name == group_name for group in self.groups)

    def can_access_client(self, client) -> bool:
        """Check if user can access a specific client based on app permissions.

        Priority (highest to lowest):
        1. User denied_apps -> Deny
        2. User allowed_apps -> Allow
        3. Group denied_apps -> Deny
        4. Group allowed_apps -> Allow
        5. Client default_access -> Allow/Deny based on setting
        """
        # 1. User-level deny (highest priority)
        if client in self.denied_apps:
            return False

        # 2. User-level allow
        if client in self.allowed_apps:
            return True

        # 3. Group-level deny
        for group in self.groups:
            if client in group.denied_apps:
                return False

        # 4. Group-level allow
        for group in self.groups:
            if client in group.allowed_apps:
                return True

        # 5. Default access policy
        return bool(client.default_access)


class Client(Base):
    __tablename__ = 'clients'

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(String(100), unique=True, index=True, nullable=False)
    client_secret_hash = Column(String(255), nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    logo = Column(String(255), nullable=True)
    website_url = Column(String(500), nullable=True)
    redirect_uris = Column(Text, nullable=False)  # JSON array stored as text
    allowed_scopes = Column(Text, nullable=False)  # JSON array stored as text
    trusted = Column(Boolean, default=False)  # Skip authorization for trusted apps
    default_access = Column(Boolean, default=False)  # Default access policy (True=open, False=requires permission)
    owner_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    owner = relationship('User', back_populates='clients')
    allowed_groups = relationship('Group', secondary=client_allowed_groups, back_populates='allowed_clients')
    denied_groups = relationship('Group', secondary=client_denied_groups, back_populates='denied_clients')
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

    # GeoIP location fields
    country = Column(String(100), nullable=True)
    city = Column(String(100), nullable=True)

    # Security fields
    is_trusted = Column(Boolean, default=False)  # User marked as trusted device
    kicked_at = Column(DateTime, nullable=True)  # When session was kicked
    kicked_reason = Column(String(100), nullable=True)  # Why session was kicked

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


class Group(Base):
    __tablename__ = 'groups'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)
    description = Column(Text, nullable=True)
    is_default = Column(Boolean, default=False)  # Auto-assign new users to this group
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    users = relationship('User', secondary=user_groups, back_populates='groups')
    allowed_clients = relationship('Client', secondary=client_allowed_groups, back_populates='allowed_groups')
    denied_clients = relationship('Client', secondary=client_denied_groups, back_populates='denied_groups')
    # App permissions (new)
    allowed_apps = relationship('Client', secondary=group_allowed_apps, backref='groups_allowed')
    denied_apps = relationship('Client', secondary=group_denied_apps, backref='groups_denied')


class InviteCode(Base):
    __tablename__ = 'invite_codes'

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(64), unique=True, index=True, nullable=False)
    note = Column(Text, nullable=True)

    group_id = Column(Integer, ForeignKey('groups.id', ondelete='CASCADE'), nullable=False)

    is_active = Column(Boolean, default=True)
    expires_at = Column(DateTime, nullable=True)
    max_uses = Column(Integer, nullable=True)  # NULL = unlimited
    used_count = Column(Integer, default=0)  # Cached count for fast checks

    created_by_user_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    used_by_user_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    used_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    group = relationship('Group')
    created_by_user = relationship('User', foreign_keys=[created_by_user_id])
    used_by_user = relationship('User', foreign_keys=[used_by_user_id])
    redemptions = relationship('InviteRedemption', back_populates='invite', cascade='all, delete-orphan')


class InviteRedemption(Base):
    __tablename__ = 'invite_redemptions'

    id = Column(Integer, primary_key=True, index=True)
    invite_id = Column(Integer, ForeignKey('invite_codes.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True)
    used_at = Column(DateTime, default=datetime.utcnow)

    invite = relationship('InviteCode', back_populates='redemptions')
    user = relationship('User')


class SystemSetting(Base):
    __tablename__ = 'system_settings'

    key = Column(String(100), primary_key=True)
    value = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


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


class Passkey(Base):
    """WebAuthn/Passkey credential for passwordless authentication"""
    __tablename__ = 'passkeys'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)

    # WebAuthn credential identifiers
    credential_id = Column(String(512), unique=True, nullable=False, index=True)  # Base64URL encoded
    public_key = Column(Text, nullable=False)  # COSE public key, Base64URL encoded

    # Credential metadata
    name = Column(String(100), nullable=False)  # User-friendly name (e.g., "iPhone", "YubiKey")

    # WebAuthn counters and flags
    sign_count = Column(Integer, default=0, nullable=False)  # Signature counter for replay protection
    transports = Column(Text, nullable=True)  # JSON array: ["usb", "nfc", "ble", "internal", "hybrid"]

    # Backup eligibility and state (for passkey providers like iCloud Keychain)
    backup_eligible = Column(Boolean, default=False)
    backup_state = Column(Boolean, default=False)

    # Attestation info
    aaguid = Column(String(36), nullable=True)  # Authenticator AAGUID

    # Usage tracking
    last_used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship('User', back_populates='passkeys')


class WebAuthnChallenge(Base):
    """Temporary storage for WebAuthn challenges during registration/authentication"""
    __tablename__ = 'webauthn_challenges'

    id = Column(Integer, primary_key=True, index=True)
    challenge = Column(String(128), unique=True, nullable=False, index=True)  # Base64URL encoded
    type = Column(String(20), nullable=False)  # 'registration' or 'authentication'
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=True)  # NULL for authentication
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class LoginLog(Base):
    """Login attempt log for security monitoring and anomaly detection"""
    __tablename__ = 'login_logs'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=True, index=True)
    username = Column(String(50), nullable=False)  # Record attempted username even if user doesn't exist

    # Login result
    success = Column(Boolean, default=False, nullable=False)
    failure_reason = Column(String(100), nullable=True)  # invalid_password, user_not_found, account_suspended, session_kicked

    # Device information
    ip_address = Column(String(50), nullable=True, index=True)
    user_agent = Column(Text, nullable=True)
    device_type = Column(String(50), nullable=True)
    device_name = Column(String(100), nullable=True)

    # GeoIP location
    country = Column(String(100), nullable=True)
    city = Column(String(100), nullable=True)
    latitude = Column(String(20), nullable=True)
    longitude = Column(String(20), nullable=True)

    # Anomaly detection
    is_suspicious = Column(Boolean, default=False)
    suspicious_reasons = Column(Text, nullable=True)  # JSON array of reasons

    # Session management
    kicked_session_id = Column(Integer, nullable=True)  # ID of session that was kicked
    session_id = Column(Integer, ForeignKey('sessions.id', ondelete='SET NULL'), nullable=True)

    # Login method
    login_method = Column(String(20), default='password')  # password, passkey, oauth

    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    # Relationships
    user = relationship('User', back_populates='login_logs')
    session = relationship('Session', foreign_keys=[session_id])
