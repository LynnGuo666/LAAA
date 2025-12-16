from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import Optional, Tuple, Dict, Any, List
from app.models import User, Token, Session as SessionModel, LoginLog
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
import json

settings = get_settings()


class AuthService:
    """Authentication service"""

    @staticmethod
    def register_user(
        db: Session,
        *,
        username: str,
        email: str,
        password: str,
        invite_code: Optional[str] = None
    ) -> User:
        """Register a new user"""
        from app.services.invite_service import InviteService

        existing_user_count = db.query(User.id).count()
        invite = None
        if not settings.allow_open_registration:
            if existing_user_count == 0 and settings.bootstrap_allow_first_user:
                invite = InviteService.get_redeemable_invite(db, invite_code) if invite_code else None
            else:
                invite = InviteService.get_redeemable_invite(db, invite_code or "")
                if not invite:
                    raise ValueError("当前为邀请制注册，请提供有效邀请码")

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
        db.flush()

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

        # Assign group from invite code (if any)
        if invite:
            invite_group = invite.group
            if invite_group and invite_group not in user.groups:
                user.groups.append(invite_group)
            InviteService.redeem_invite(db, invite, user_id=user.id)

        db.commit()
        db.refresh(user)

        return user

    @staticmethod
    def authenticate_user(
        db: Session,
        username: str,
        password: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ) -> Tuple[Optional[User], Optional[str]]:
        """
        Authenticate a user.

        Returns:
            Tuple of (User or None, failure_reason or None)
        """
        user = db.query(User).filter(User.username == username).first()
        if not user:
            return None, "user_not_found"
        if not verify_password(password, user.password_hash):
            return None, "invalid_password"
        if user.status != 'active':
            return None, "account_suspended"
        return user, None

    @staticmethod
    def create_tokens(
        db: Session,
        user: User,
        client_id: str,
        scope: str,
        remember_me: bool = False,
        device_name: Optional[str] = None,
        device_token: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        login_method: str = "password"
    ) -> Dict[str, Any]:
        """
        Create access and refresh tokens for a user.

        Returns:
            Dictionary containing:
            - access_token: str
            - refresh_token: str
            - kicked_session: Optional[dict] - Info about kicked session if any
            - is_suspicious: bool - Whether login is suspicious
            - anomalies: List[dict] - List of detected anomalies
        """
        from app.services.geoip_service import GeoIPService
        from app.services.session_limit_service import SessionLimitService
        from app.services.login_anomaly_service import LoginAnomalyService

        safe_user_agent = user_agent or "unknown"
        safe_ip_address = ip_address or "unknown"

        # Always generate device_id for session tracking
        device_id = generate_device_id(user.id, safe_user_agent, safe_ip_address)

        # Get GeoIP information
        geo_info = GeoIPService.get_location(safe_ip_address)

        # Check for anomalies
        anomalies = LoginAnomalyService.check_anomalies(
            db, user, safe_ip_address, safe_user_agent, geo_info
        )
        is_suspicious = LoginAnomalyService.is_suspicious(anomalies)

        # Check and enforce session limits
        kicked_session = None
        allowed, kicked_info = SessionLimitService.check_and_enforce_limit(
            db, user, device_id
        )
        kicked_session = kicked_info

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
            "device_id": device_id,  # Always include device_id
        }
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

        # Create or update session (always, not just when remember_me)
        device_type = parse_device_type(safe_user_agent)
        device_display_name = device_name or get_device_name(safe_user_agent)

        # Check if session exists for this user+device
        session_record = db.query(SessionModel).filter(
            SessionModel.user_id == user.id,
            SessionModel.device_id == device_id
        ).first()

        if session_record:
            session_record.refresh_token_hash = hash_token(refresh_token)
            session_record.last_active = datetime.utcnow()
            session_record.expires_at = refresh_expires
            session_record.ip_address = safe_ip_address
            session_record.user_agent = safe_user_agent
            if device_name:
                session_record.device_name = device_display_name
            session_record.device_type = device_type
            # Update device_token if provided
            if device_token:
                session_record.device_token = device_token
            # Update geo info
            if geo_info:
                session_record.country = geo_info.get('country')
                session_record.city = geo_info.get('city')
            # Clear kicked status if re-logging in
            session_record.kicked_at = None
            session_record.kicked_reason = None
        else:
            session_record = SessionModel(
                user_id=user.id,
                device_id=device_id,
                device_name=device_display_name,
                device_type=device_type,
                device_token=device_token,
                refresh_token_hash=hash_token(refresh_token),
                ip_address=safe_ip_address,
                user_agent=safe_user_agent,
                expires_at=refresh_expires,
                country=geo_info.get('country') if geo_info else None,
                city=geo_info.get('city') if geo_info else None
            )
            db.add(session_record)

        db.commit()

        # Record login log
        AuthService.record_login_log(
            db,
            user=user,
            username=user.username,
            success=True,
            ip_address=safe_ip_address,
            user_agent=safe_user_agent,
            geo_info=geo_info,
            anomalies=anomalies,
            kicked_session_id=kicked_session.get('id') if kicked_session else None,
            session_id=session_record.id if session_record else None,
            login_method=login_method
        )

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "kicked_session": kicked_session,
            "is_suspicious": is_suspicious,
            "anomalies": anomalies
        }

    @staticmethod
    def record_login_log(
        db: Session,
        user: Optional[User],
        username: str,
        success: bool,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        failure_reason: Optional[str] = None,
        geo_info: Optional[Dict[str, Any]] = None,
        anomalies: Optional[List[Dict[str, Any]]] = None,
        kicked_session_id: Optional[int] = None,
        session_id: Optional[int] = None,
        login_method: str = "password",
        is_suspicious: Optional[bool] = None
    ) -> LoginLog:
        """Record a login attempt in the log"""
        from app.utils.device import get_device_name, parse_device_type

        # Calculate is_suspicious if not explicitly provided
        if is_suspicious is None:
            is_suspicious = any(a.get('severity') in ('medium', 'high') for a in (anomalies or []))

        log = LoginLog(
            user_id=user.id if user else None,
            username=username,
            success=success,
            failure_reason=failure_reason,
            ip_address=ip_address,
            user_agent=user_agent,
            device_type=parse_device_type(user_agent or "unknown"),
            device_name=get_device_name(user_agent or "unknown"),
            country=geo_info.get('country') if geo_info else None,
            city=geo_info.get('city') if geo_info else None,
            latitude=geo_info.get('latitude') if geo_info else None,
            longitude=geo_info.get('longitude') if geo_info else None,
            is_suspicious=is_suspicious,
            suspicious_reasons=json.dumps(anomalies) if anomalies else None,
            kicked_session_id=kicked_session_id,
            session_id=session_id,
            login_method=login_method
        )
        db.add(log)
        db.commit()
        return log

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
