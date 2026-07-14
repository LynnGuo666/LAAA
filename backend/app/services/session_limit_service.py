"""
Session Limit Service - Manages concurrent session limits per user

This service enforces maximum concurrent session limits for each user.
When a user exceeds their session limit, the oldest session is automatically
terminated to make room for the new login.
"""

from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Session as SessionModel
from app.models import Token, User
from app.utils.time import utcnow

settings = get_settings()


class SessionLimitService:
    """Service for managing concurrent session limits"""

    @staticmethod
    def get_active_sessions(db: Session, user_id: int) -> List[SessionModel]:
        """
        Get all active (non-expired) sessions for a user.

        Returns sessions ordered by last_active ascending (oldest first).
        """
        return db.query(SessionModel).filter(
            SessionModel.user_id == user_id,
            SessionModel.expires_at > utcnow(),
            SessionModel.kicked_at.is_(None)  # Not kicked
        ).order_by(SessionModel.last_active.asc()).all()

    @staticmethod
    def get_session_count(db: Session, user_id: int) -> int:
        """Get the count of active sessions for a user"""
        return db.query(SessionModel).filter(
            SessionModel.user_id == user_id,
            SessionModel.expires_at > utcnow(),
            SessionModel.kicked_at.is_(None)
        ).count()

    @staticmethod
    def check_and_enforce_limit(
        db: Session,
        user: User,
        new_device_id: str
    ) -> Tuple[bool, Optional[Dict[str, Any]]]:
        """
        Check if user can create a new session and enforce the limit.

        If the user is at their session limit, the oldest session will be
        kicked to make room for the new one.

        Args:
            db: Database session
            user: The user attempting to login
            new_device_id: Device ID of the new session

        Returns:
            Tuple of:
            - bool: Whether the new session is allowed
            - Optional dict: Info about the kicked session, or None
              {
                  "id": 123,
                  "device_name": "Chrome on Windows",
                  "device_type": "web",
                  "ip_address": "192.168.1.1"
              }
        """
        max_sessions = user.max_sessions or settings.default_max_sessions

        active_sessions = SessionLimitService.get_active_sessions(db, user.id)

        # Check if the new device already has an active session
        # Same device re-login doesn't count towards the limit
        existing_device_session = None
        for session in active_sessions:
            if session.device_id == new_device_id:
                existing_device_session = session
                break

        # If same device is re-logging in, allow it (session will be updated)
        if existing_device_session:
            return True, None

        # Check if we're at or over the limit
        if len(active_sessions) < max_sessions:
            return True, None

        # We're at the limit - kick the oldest session
        oldest_session = active_sessions[0]  # Already sorted by last_active asc
        kicked_info = SessionLimitService.kick_session(
            db, oldest_session, reason='session_limit'
        )

        return True, kicked_info

    @staticmethod
    def kick_session(
        db: Session,
        session: SessionModel,
        reason: str = 'manual'
    ) -> Dict[str, Any]:
        """
        Kick (terminate) a specific session.

        Args:
            db: Database session
            session: The session to kick
            reason: Reason for kicking (session_limit, manual, security, etc.)

        Returns:
            Dictionary with info about the kicked session
        """
        kicked_info = {
            "id": session.id,
            "device_name": session.device_name,
            "device_type": session.device_type,
            "ip_address": session.ip_address,
            "city": session.city,
            "country": session.country
        }

        # Mark the session as kicked
        session.kicked_at = utcnow()
        session.kicked_reason = reason

        # Delete the associated refresh token
        if session.refresh_token_hash:
            db.query(Token).filter(
                Token.token_hash == session.refresh_token_hash
            ).delete()

        # Expire the session
        session.expires_at = utcnow()

        db.commit()

        return kicked_info

    @staticmethod
    def kick_all_other_sessions(
        db: Session,
        user_id: int,
        current_device_id: str
    ) -> List[Dict[str, Any]]:
        """
        Kick all sessions except the current one.

        Args:
            db: Database session
            user_id: The user whose sessions to kick
            current_device_id: Device ID to keep

        Returns:
            List of kicked session info dicts
        """
        kicked_sessions = []

        active_sessions = SessionLimitService.get_active_sessions(db, user_id)

        for session in active_sessions:
            if session.device_id != current_device_id:
                kicked_info = SessionLimitService.kick_session(
                    db, session, reason='user_request'
                )
                kicked_sessions.append(kicked_info)

        return kicked_sessions
