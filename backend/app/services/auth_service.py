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
    hash_token
)
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
        from app.models import Role
        user_role = db.query(Role).filter(Role.name == 'user').first()
        if user_role:
            user.roles.append(user_role)
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

        # Create JWT tokens
        token_data = {"sub": str(user.id), "scope": scope}
        access_token = create_access_token(token_data)
        refresh_token = create_refresh_token(token_data, remember_me)

        # Calculate expiration
        access_expires = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
        if remember_me:
            refresh_expires = datetime.utcnow() + timedelta(days=settings.refresh_token_remember_me_days)
        else:
            refresh_expires = datetime.utcnow() + timedelta(days=settings.refresh_token_expire_days)

        # Get or create client (for internal auth, we use a default client)
        from app.models import Client
        client = db.query(Client).filter(Client.client_id == client_id).first()
        if not client:
            # This shouldn't happen in production, but handle gracefully
            client = db.query(Client).first()

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
        if remember_me and device_name and ip_address and user_agent:
            device_id = generate_device_id(user_agent, ip_address)
            device_type = parse_device_type(user_agent)
            device_display_name = device_name or get_device_name(user_agent)

            # Check if session exists
            session = db.query(SessionModel).filter(
                SessionModel.device_id == device_id
            ).first()

            if session:
                # Update existing session
                session.refresh_token_hash = hash_token(refresh_token)
                session.last_active = datetime.utcnow()
                session.expires_at = refresh_expires
            else:
                # Create new session
                session = SessionModel(
                    user_id=user.id,
                    device_id=device_id,
                    device_name=device_display_name,
                    device_type=device_type,
                    refresh_token_hash=hash_token(refresh_token),
                    ip_address=ip_address,
                    user_agent=user_agent,
                    expires_at=refresh_expires
                )
                db.add(session)

        db.commit()

        return access_token, refresh_token

    @staticmethod
    def refresh_access_token(db: Session, refresh_token: str) -> Optional[Tuple[str, str]]:
        """Refresh an access token using a refresh token"""
        # Decode refresh token
        payload = decode_token(refresh_token)
        if not payload or payload.get("type") != "refresh":
            return None

        # Check if refresh token exists and is valid
        token_hash_value = hash_token(refresh_token)
        token_record = db.query(Token).filter(
            Token.token_hash == token_hash_value,
            Token.type == 'refresh',
            Token.expires_at > datetime.utcnow()
        ).first()

        if not token_record:
            return None

        # Get user
        user = token_record.user
        if not user or user.status != 'active':
            return None

        # Create new tokens
        token_data = {"sub": str(user.id), "scope": token_record.scope}
        new_access_token = create_access_token(token_data)
        new_refresh_token = create_refresh_token(token_data)

        # Calculate new expiration
        refresh_expires = datetime.utcnow() + timedelta(days=settings.refresh_token_expire_days)

        # Update old refresh token record
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

        db.commit()

        return new_access_token, new_refresh_token

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
