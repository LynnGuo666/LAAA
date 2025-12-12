from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import Optional, Tuple
from app.models import User, Token, Session as SessionModel
from app.utils.security import (
    verify_password,
    get_password_hash,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_token,
    verify_client_secret
)
from sqlalchemy.exc import IntegrityError
from app.utils.device import generate_device_id, get_device_name, parse_device_type
from app.config import get_settings

settings = get_settings()


class AuthService:
    """Authentication service"""

    @staticmethod
    def register_user(db: Session, username: str, email: str, password: str) -> User:
        """Register a new user"""
        # Check if user exists
        existing = db.query(User).filter(
            (User.username == username) | (User.email == email)
        ).first()

        if existing:
            raise ValueError("Username or email already exists")

        # Create user
        user = User(
            username=username,
            email=email,
            password_hash=get_password_hash(password)
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        # Assign default 'user' role
        from app.models import Role, Group
        user_role = db.query(Role).filter(Role.name == 'user').first()
        if user_role:
            user.roles.append(user_role)
        
        # Assign default groups (is_default=True)
        default_groups = db.query(Group).filter(Group.is_default == True).all()
        for group in default_groups:
            if group not in user.groups:
                user.groups.append(group)

        db.commit()

        return user

    @staticmethod
    def authenticate_user(db: Session, username: str, password: str) -> Optional[User]:
        """Authenticate a user"""
        user = db.query(User).filter(User.username == username).first()
        if not user:
            return None
        if not verify_password(password, user.password_hash):
            return None
        if user.status != 'active':
            return None
        return user

    @staticmethod
    def create_tokens(
        db: Session,
        user: User,
        client_id: str,
        scope: str,
        remember_me: bool = False,
        device_name: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ) -> Tuple[str, str]:
        """Create access and refresh tokens for a user"""

        safe_user_agent = user_agent or "unknown"
        safe_ip_address = ip_address or "unknown"

        device_id: Optional[str] = None
        if remember_me:
            device_id = generate_device_id(user.id, safe_user_agent, safe_ip_address)

        # Resolve client early so tokens are bound to a real client_id
        from app.models import Client
        client = db.query(Client).filter(Client.client_id == client_id).first()
        if not client:
            # Fallback for internal auth or legacy data
            client = db.query(Client).first()

        # Create JWT tokens
        token_data = {
            "sub": str(user.id),
            "scope": scope,
            "client_id": client.client_id if client else client_id,
        }
        if device_id:
            token_data["device_id"] = device_id
        access_token = create_access_token(token_data)
        refresh_token = create_refresh_token(token_data, remember_me)

        # Calculate expiration
        access_expires = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
        if remember_me:
            refresh_expires = datetime.utcnow() + timedelta(days=settings.refresh_token_remember_me_days)
        else:
            refresh_expires = datetime.utcnow() + timedelta(days=settings.refresh_token_expire_days)

        # Store refresh token
        refresh_token_record = Token(
            token_hash=hash_token(refresh_token),
            type='refresh',
            user_id=user.id,
            client_id=client.id if client else 1,
            scope=scope,
            expires_at=refresh_expires
        )
        db.add(refresh_token_record)

        # Create or update session if remember_me
        if remember_me:
            device_type = parse_device_type(safe_user_agent)
            device_display_name = device_name or get_device_name(safe_user_agent)

            # Check if session exists for this user+device
            session = db.query(SessionModel).filter(
                SessionModel.user_id == user.id,
                SessionModel.device_id == device_id
            ).first()

            if session:
                session.refresh_token_hash = hash_token(refresh_token)
                session.last_active = datetime.utcnow()
                session.expires_at = refresh_expires
                session.ip_address = safe_ip_address
                session.user_agent = safe_user_agent
                if device_name:
                    session.device_name = device_display_name
                session.device_type = device_type
            else:
                session = SessionModel(
                    user_id=user.id,
                    device_id=device_id,
                    device_name=device_display_name,
                    device_type=device_type,
                    refresh_token_hash=hash_token(refresh_token),
                    ip_address=safe_ip_address,
                    user_agent=safe_user_agent,
                    expires_at=refresh_expires
                )
                db.add(session)

        db.commit()

        return access_token, refresh_token

    @staticmethod
    def refresh_access_token(
        db: Session,
        refresh_token: str,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None
    ) -> Optional[Tuple[str, str]]:
        """Refresh an access token using a refresh token"""
        # Decode refresh token
        payload = decode_token(refresh_token)
        if not payload or payload.get("type") != "refresh":
            return None
        device_id = payload.get("device_id")

        # Check if refresh token exists and is valid
        token_hash_value = hash_token(refresh_token)
        token_record = db.query(Token).filter(
            Token.token_hash == token_hash_value,
            Token.type == 'refresh',
            Token.expires_at > datetime.utcnow()
        ).first()

        if not token_record:
            return None

        # Ensure the refresh token is still bound to a valid client
        from app.models import Client
        bound_client = token_record.client
        if not bound_client:
            return None

        # If caller provides client_id, require it to match the bound client
        if client_id and bound_client.client_id != client_id:
            return None

        # If caller provides client_secret, verify it against the bound client
        if client_secret and not verify_client_secret(client_secret, bound_client.client_secret_hash):
            return None

        # Get user
        user = token_record.user
        if not user or user.status != 'active':
            return None

        # Create new tokens
        token_data = {
            "sub": str(user.id),
            "scope": token_record.scope,
            "client_id": bound_client.client_id,
        }
        if device_id:
            token_data["device_id"] = device_id
        new_access_token = create_access_token(token_data)
        new_refresh_token = create_refresh_token(token_data)

        # Calculate new expiration
        refresh_expires = datetime.utcnow() + timedelta(days=settings.refresh_token_expire_days)

        # Update old refresh token record
        for _ in range(3):
            token_record.token_hash = hash_token(new_refresh_token)
            token_record.expires_at = refresh_expires

            # Update session if exists
            session = db.query(SessionModel).filter(
                SessionModel.refresh_token_hash == token_hash_value
            ).first()
            if session:
                session.refresh_token_hash = hash_token(new_refresh_token)
                session.last_active = datetime.utcnow()
                session.expires_at = refresh_expires

            try:
                db.commit()
                return new_access_token, new_refresh_token
            except IntegrityError:
                db.rollback()
                new_refresh_token = create_refresh_token(token_data)

        return None

    @staticmethod
    def logout(db: Session, refresh_token: str) -> bool:
        """Logout user by removing refresh token"""
        token_hash_value = hash_token(refresh_token)

        # Delete token
        token = db.query(Token).filter(
            Token.token_hash == token_hash_value,
            Token.type == 'refresh'
        ).first()

        if token:
            db.delete(token)

        # Delete session
        session = db.query(SessionModel).filter(
            SessionModel.refresh_token_hash == token_hash_value
        ).first()

        if session:
            db.delete(session)

        db.commit()
        return True
