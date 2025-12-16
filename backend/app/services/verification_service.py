"""
Verification Service

Handles multi-step verification for suspicious logins.
"""

import secrets
import hashlib
import json
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Tuple

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import User, VerificationSession, VerificationCode
from app.services.risk_service import RiskAssessment, RiskLevel, RiskService
from app.services.email_service import EmailService

settings = get_settings()
logger = logging.getLogger(__name__)


class VerificationError(Exception):
    """Base exception for verification errors"""
    pass


class CodeExpiredError(VerificationError):
    """Verification code has expired"""
    pass


class CodeInvalidError(VerificationError):
    """Verification code is invalid"""
    pass


class MaxAttemptsError(VerificationError):
    """Maximum verification attempts exceeded"""
    pass


class DeviceMismatchError(VerificationError):
    """Device token does not match for Magic Link"""
    pass


class SessionExpiredError(VerificationError):
    """Verification session has expired"""
    pass


class VerificationService:
    """Service for managing verification sessions and codes"""

    @staticmethod
    def generate_session_token() -> str:
        """Generate a unique session token"""
        return secrets.token_urlsafe(32)

    @staticmethod
    def generate_verification_code() -> str:
        """Generate a 6-digit verification code"""
        return f"{secrets.randbelow(1000000):06d}"

    @staticmethod
    def generate_magic_link_token() -> str:
        """Generate a unique token for magic link"""
        return secrets.token_urlsafe(32)

    @staticmethod
    def hash_code(code: str) -> str:
        """Hash a verification code"""
        return hashlib.sha256(code.encode()).hexdigest()

    @staticmethod
    def create_verification_session(
        db: Session,
        user: User,
        risk_assessment: RiskAssessment,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        device_name: Optional[str] = None,
        device_token: Optional[str] = None,
        remember_me: bool = False
    ) -> VerificationSession:
        """
        Create a new verification session for a suspicious login.

        Args:
            db: Database session
            user: User attempting to log in
            risk_assessment: Risk assessment result
            ip_address: Client IP address
            user_agent: Client user agent
            device_name: Device name
            device_token: Device token from client
            remember_me: Remember me flag

        Returns:
            Created VerificationSession
        """
        session_token = VerificationService.generate_session_token()
        expires_at = datetime.utcnow() + timedelta(minutes=settings.verification_session_expire_minutes)

        verification_session = VerificationSession(
            user_id=user.id,
            session_token=session_token,
            risk_level=risk_assessment.risk_level.value,
            risk_score=risk_assessment.risk_score,
            anomalies=json.dumps([a.to_dict() for a in risk_assessment.anomalies]),
            required_verifications=risk_assessment.required_verifications,
            completed_verifications=0,
            completed_methods=json.dumps([]),
            ip_address=ip_address,
            user_agent=user_agent,
            device_name=device_name,
            device_token=device_token,
            remember_me=remember_me,
            is_completed=False,
            expires_at=expires_at
        )

        db.add(verification_session)
        db.commit()
        db.refresh(verification_session)

        logger.info(f"Created verification session {session_token} for user {user.id}, risk level: {risk_assessment.risk_level.value}")

        return verification_session

    @staticmethod
    def get_verification_session(db: Session, session_token: str) -> Optional[VerificationSession]:
        """Get a verification session by token"""
        return db.query(VerificationSession).filter(
            VerificationSession.session_token == session_token
        ).first()

    @staticmethod
    def validate_session(session: VerificationSession) -> bool:
        """Check if session is still valid"""
        if session.is_completed:
            return False
        if datetime.utcnow() > session.expires_at:
            return False
        return True

    @staticmethod
    async def create_email_code(
        db: Session,
        verification_session: VerificationSession,
        send_email: bool = True
    ) -> VerificationCode:
        """
        Create an email verification code.

        Args:
            db: Database session
            verification_session: The verification session
            send_email: Whether to send the email

        Returns:
            Created VerificationCode
        """
        # Check for existing unused code
        existing = db.query(VerificationCode).filter(
            VerificationCode.session_id == verification_session.id,
            VerificationCode.purpose == "email_code",
            VerificationCode.is_used == False,
            VerificationCode.expires_at > datetime.utcnow()
        ).first()

        if existing:
            # Check cooldown
            time_since_creation = (datetime.utcnow() - existing.created_at).total_seconds()
            if time_since_creation < settings.verification_code_cooldown_seconds:
                raise VerificationError(
                    f"请等待 {int(settings.verification_code_cooldown_seconds - time_since_creation)} 秒后重试"
                )

        # Generate new code
        code = VerificationService.generate_verification_code()
        code_hash = VerificationService.hash_code(code)
        expires_at = datetime.utcnow() + timedelta(minutes=settings.verification_code_expire_minutes)

        verification_code = VerificationCode(
            session_id=verification_session.id,
            user_id=verification_session.user_id,
            code_hash=code_hash,
            purpose="email_code",
            max_attempts=settings.verification_code_max_attempts,
            expires_at=expires_at
        )

        db.add(verification_code)
        db.commit()
        db.refresh(verification_code)

        # Send email
        if send_email:
            user = db.query(User).get(verification_session.user_id)
            if user and user.email:
                await EmailService.send_verification_code(
                    to_email=user.email,
                    username=user.username,
                    code=code,
                    expire_minutes=settings.verification_code_expire_minutes
                )

        logger.info(f"Created email verification code for session {verification_session.session_token}")

        return verification_code

    @staticmethod
    async def create_magic_link(
        db: Session,
        verification_session: Optional[VerificationSession],
        user: User,
        device_token: str,
        purpose: str = "magic_link"
    ) -> Tuple[VerificationCode, str]:
        """
        Create a magic link for verification.

        Args:
            db: Database session
            verification_session: The verification session (None for independent login)
            user: User
            device_token: Device token from cookie (for binding)
            purpose: Purpose of the magic link

        Returns:
            Tuple of (VerificationCode, magic link token)
        """
        token = VerificationService.generate_magic_link_token()
        expires_at = datetime.utcnow() + timedelta(minutes=settings.magic_link_expire_minutes)

        verification_code = VerificationCode(
            session_id=verification_session.id if verification_session else None,
            user_id=user.id,
            token=token,
            purpose=purpose,
            device_token=device_token,  # Bind to requesting device
            max_attempts=1,  # Magic links are single use
            expires_at=expires_at
        )

        db.add(verification_code)
        db.commit()
        db.refresh(verification_code)

        logger.info(f"Created magic link for user {user.id}, purpose: {purpose}")

        return verification_code, token

    @staticmethod
    def verify_email_code(
        db: Session,
        verification_session: VerificationSession,
        code: str
    ) -> bool:
        """
        Verify an email verification code.

        Args:
            db: Database session
            verification_session: The verification session
            code: The code to verify

        Returns:
            True if verification successful

        Raises:
            CodeExpiredError: If code has expired
            CodeInvalidError: If code is invalid
            MaxAttemptsError: If max attempts exceeded
        """
        # Find the latest unused code for this session
        verification_code = db.query(VerificationCode).filter(
            VerificationCode.session_id == verification_session.id,
            VerificationCode.purpose == "email_code",
            VerificationCode.is_used == False
        ).order_by(VerificationCode.created_at.desc()).first()

        if not verification_code:
            raise CodeInvalidError("验证码不存在或已使用")

        # Check expiration
        if datetime.utcnow() > verification_code.expires_at:
            raise CodeExpiredError("验证码已过期")

        # Check attempts
        if verification_code.attempts >= verification_code.max_attempts:
            raise MaxAttemptsError("验证码尝试次数已达上限")

        # Increment attempts
        verification_code.attempts += 1

        # Verify code
        code_hash = VerificationService.hash_code(code)
        if code_hash != verification_code.code_hash:
            db.commit()
            raise CodeInvalidError("验证码错误")

        # Mark as used
        verification_code.is_used = True
        verification_code.used_at = datetime.utcnow()
        db.commit()

        logger.info(f"Email code verified for session {verification_session.session_token}")

        return True

    @staticmethod
    async def verify_magic_link(
        db: Session,
        token: str,
        device_token: Optional[str]
    ) -> Tuple[VerificationCode, bool]:
        """
        Verify a magic link token.

        Args:
            db: Database session
            token: The magic link token
            device_token: Device token from cookie

        Returns:
            Tuple of (VerificationCode, device_matched)

        Raises:
            CodeExpiredError: If link has expired
            CodeInvalidError: If link is invalid
            DeviceMismatchError: If device does not match
        """
        verification_code = db.query(VerificationCode).filter(
            VerificationCode.token == token
        ).first()

        if not verification_code:
            raise CodeInvalidError("链接无效或已使用")

        if verification_code.is_used:
            raise CodeInvalidError("链接已使用")

        if datetime.utcnow() > verification_code.expires_at:
            raise CodeExpiredError("链接已过期")

        # Check device token
        device_matched = True
        if verification_code.device_token:
            if device_token != verification_code.device_token:
                device_matched = False
                # Send security alert
                user = db.query(User).get(verification_code.user_id)
                if user and user.email:
                    await EmailService.send_magic_link_device_mismatch(
                        to_email=user.email,
                        username=user.username
                    )
                raise DeviceMismatchError("请在同一设备上验证链接")

        # Mark as used
        verification_code.is_used = True
        verification_code.used_at = datetime.utcnow()
        db.commit()

        logger.info(f"Magic link verified for user {verification_code.user_id}")

        return verification_code, device_matched

    @staticmethod
    def complete_verification_step(
        db: Session,
        verification_session: VerificationSession,
        method: str
    ) -> bool:
        """
        Mark a verification step as completed.

        Args:
            db: Database session
            verification_session: The verification session
            method: The verification method used

        Returns:
            True if all verifications are now complete
        """
        # Update completed methods
        completed_methods = json.loads(verification_session.completed_methods or "[]")
        if method not in completed_methods:
            completed_methods.append(method)
            verification_session.completed_methods = json.dumps(completed_methods)
            verification_session.completed_verifications += 1

        # Check if all verifications complete
        if verification_session.completed_verifications >= verification_session.required_verifications:
            verification_session.is_completed = True
            verification_session.completed_at = datetime.utcnow()

        db.commit()

        logger.info(
            f"Verification step completed: {method}, "
            f"progress: {verification_session.completed_verifications}/{verification_session.required_verifications}"
        )

        return verification_session.is_completed

    @staticmethod
    def is_verification_complete(verification_session: VerificationSession) -> bool:
        """Check if all required verifications are complete"""
        return verification_session.is_completed

    @staticmethod
    def get_remaining_methods(
        user: User,
        verification_session: VerificationSession
    ) -> List[Dict[str, Any]]:
        """Get remaining available verification methods"""
        completed_methods = json.loads(verification_session.completed_methods or "[]")
        risk_level = RiskLevel(verification_session.risk_level)

        return RiskService.get_available_methods(user, risk_level, completed_methods)

    @staticmethod
    def get_session_status(
        user: User,
        verification_session: VerificationSession
    ) -> Dict[str, Any]:
        """Get current verification session status"""
        completed_methods = json.loads(verification_session.completed_methods or "[]")
        risk_level = RiskLevel(verification_session.risk_level)

        return {
            "session_token": verification_session.session_token,
            "risk_level": verification_session.risk_level,
            "required_verifications": verification_session.required_verifications,
            "completed_verifications": verification_session.completed_verifications,
            "completed_methods": completed_methods,
            "remaining_methods": RiskService.get_available_methods(user, risk_level, completed_methods),
            "is_complete": verification_session.is_completed,
            "expires_at": verification_session.expires_at.isoformat()
        }

    @staticmethod
    def cleanup_expired_sessions(db: Session) -> int:
        """Clean up expired verification sessions"""
        expired = db.query(VerificationSession).filter(
            VerificationSession.expires_at < datetime.utcnow(),
            VerificationSession.is_completed == False
        ).all()

        count = len(expired)
        for session in expired:
            db.delete(session)

        db.commit()
        logger.info(f"Cleaned up {count} expired verification sessions")

        return count
