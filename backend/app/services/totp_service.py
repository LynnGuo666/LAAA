"""
TOTP Service

Handles Time-based One-Time Password (TOTP) for two-factor authentication.
"""

import secrets
import hashlib
import json
import base64
import hmac
import logging
from io import BytesIO
from typing import Optional, List, Tuple

import pyotp
import qrcode
from cryptography.fernet import Fernet
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import User, UserTOTP
from app.utils.time import utcnow

settings = get_settings()
logger = logging.getLogger(__name__)


class TOTPError(Exception):
    """Base exception for TOTP errors"""
    pass


class TOTPAlreadyEnabledError(TOTPError):
    """TOTP is already enabled for this user"""
    pass


class TOTPNotEnabledError(TOTPError):
    """TOTP is not enabled for this user"""
    pass


class InvalidTOTPCodeError(TOTPError):
    """Invalid TOTP code"""
    pass


class InvalidBackupCodeError(TOTPError):
    """Invalid backup code"""
    pass


class TOTPService:
    """Service for managing TOTP authentication"""

    # Fernet key derived from app secret key
    _fernet: Optional[Fernet] = None

    @classmethod
    def _get_fernet(cls) -> Fernet:
        """Get or create Fernet instance for encryption"""
        if cls._fernet is None:
            # Derive a 32-byte key from the secret key using SHA256
            key_bytes = hashlib.sha256(settings.secret_key.encode()).digest()
            key = base64.urlsafe_b64encode(key_bytes)
            cls._fernet = Fernet(key)
        return cls._fernet

    @staticmethod
    def generate_secret() -> str:
        """Generate a new TOTP secret"""
        return pyotp.random_base32()

    @classmethod
    def encrypt_secret(cls, secret: str) -> str:
        """Encrypt a TOTP secret for storage"""
        fernet = cls._get_fernet()
        return fernet.encrypt(secret.encode()).decode()

    @classmethod
    def decrypt_secret(cls, encrypted_secret: str) -> str:
        """Decrypt a stored TOTP secret"""
        fernet = cls._get_fernet()
        return fernet.decrypt(encrypted_secret.encode()).decode()

    @staticmethod
    def get_provisioning_uri(secret: str, username: str, issuer: Optional[str] = None) -> str:
        """
        Get the provisioning URI for TOTP setup.
        This URI is used to generate the QR code.
        """
        if issuer is None:
            issuer = settings.totp_issuer

        totp = pyotp.TOTP(secret)
        return totp.provisioning_uri(name=username, issuer_name=issuer)

    @staticmethod
    def generate_qr_code_base64(uri: str) -> str:
        """Generate a QR code image as base64"""
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=10,
            border=4,
        )
        qr.add_data(uri)
        qr.make(fit=True)

        img = qr.make_image(fill_color="black", back_color="white")

        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        return base64.b64encode(buffer.getvalue()).decode()

    @staticmethod
    def verify_totp(secret: str, code: str, window: int = 1) -> bool:
        """
        Verify a TOTP code.

        Args:
            secret: The TOTP secret
            code: The code to verify
            window: Number of time windows to check (before and after current)

        Returns:
            True if code is valid
        """
        totp = pyotp.TOTP(secret)
        return totp.verify(code, valid_window=window)

    @staticmethod
    def generate_backup_codes(count: int = 10) -> List[str]:
        """Generate a list of backup codes"""
        codes = []
        for _ in range(count):
            # Generate 8-character alphanumeric codes
            code = secrets.token_hex(4).upper()
            codes.append(code)
        return codes

    @staticmethod
    def hash_backup_code(code: str) -> str:
        """Hash a backup code for storage"""
        return hashlib.sha256(code.lower().encode()).hexdigest()

    @classmethod
    def setup_totp(
        cls,
        db: Session,
        user: User,
        name: str = "Authenticator"
    ) -> Tuple[str, str, str]:
        """
        Start TOTP setup for a user.

        Args:
            db: Database session
            user: User
            name: Device/app name

        Returns:
            Tuple of (secret, provisioning_uri, qr_code_base64)

        Raises:
            TOTPAlreadyEnabledError: If TOTP is already enabled
        """
        # Check if TOTP already enabled
        if user.totp and user.totp.is_enabled:
            raise TOTPAlreadyEnabledError("TOTP 已启用")

        # Generate secret
        secret = cls.generate_secret()
        uri = cls.get_provisioning_uri(secret, user.username)
        qr_code = cls.generate_qr_code_base64(uri)

        # Create or update TOTP record (not enabled yet)
        if user.totp:
            user.totp.secret_encrypted = cls.encrypt_secret(secret)
            user.totp.name = name
            user.totp.is_enabled = False
        else:
            totp_record = UserTOTP(
                user_id=user.id,
                secret_encrypted=cls.encrypt_secret(secret),
                name=name,
                is_enabled=False
            )
            db.add(totp_record)

        db.commit()

        logger.info(f"TOTP setup initiated for user {user.id}")

        return secret, uri, qr_code

    @classmethod
    def verify_and_enable_totp(
        cls,
        db: Session,
        user: User,
        code: str
    ) -> List[str]:
        """
        Verify TOTP code and enable TOTP.

        Args:
            db: Database session
            user: User
            code: TOTP code to verify

        Returns:
            List of backup codes

        Raises:
            TOTPNotEnabledError: If TOTP setup not initiated
            InvalidTOTPCodeError: If code is invalid
        """
        if not user.totp:
            raise TOTPNotEnabledError("TOTP 未设置")

        if user.totp.is_enabled:
            raise TOTPAlreadyEnabledError("TOTP 已启用")

        # Decrypt and verify
        secret = cls.decrypt_secret(user.totp.secret_encrypted)
        if not cls.verify_totp(secret, code):
            raise InvalidTOTPCodeError("验证码错误")

        # Generate backup codes
        backup_codes = cls.generate_backup_codes()
        hashed_codes = [cls.hash_backup_code(c) for c in backup_codes]

        # Enable TOTP
        user.totp.is_enabled = True
        user.totp.backup_codes_hash = json.dumps(hashed_codes)
        user.totp.last_used_at = utcnow()

        db.commit()

        logger.info(f"TOTP enabled for user {user.id}")

        return backup_codes

    @classmethod
    def verify_totp_code(
        cls,
        db: Session,
        user: User,
        code: str
    ) -> bool:
        """
        Verify a TOTP code for login.

        Args:
            db: Database session
            user: User
            code: TOTP code to verify

        Returns:
            True if code is valid

        Raises:
            TOTPNotEnabledError: If TOTP not enabled
            InvalidTOTPCodeError: If code is invalid
        """
        if not user.totp or not user.totp.is_enabled:
            raise TOTPNotEnabledError("TOTP 未启用")

        secret = cls.decrypt_secret(user.totp.secret_encrypted)
        if not cls.verify_totp(secret, code):
            raise InvalidTOTPCodeError("验证码错误")

        # Update last used
        user.totp.last_used_at = utcnow()
        db.commit()

        logger.info(f"TOTP verified for user {user.id}")

        return True

    @classmethod
    def verify_backup_code(
        cls,
        db: Session,
        user: User,
        code: str
    ) -> bool:
        """
        Verify and consume a backup code.

        Args:
            db: Database session
            user: User
            code: Backup code to verify

        Returns:
            True if code is valid

        Raises:
            TOTPNotEnabledError: If TOTP not enabled
            InvalidBackupCodeError: If code is invalid or already used
        """
        if not user.totp or not user.totp.is_enabled:
            raise TOTPNotEnabledError("TOTP 未启用")

        if not user.totp.backup_codes_hash:
            raise InvalidBackupCodeError("无效的备用码")

        hashed_codes = json.loads(user.totp.backup_codes_hash)
        code_hash = cls.hash_backup_code(code)

        # 常量时间比较(用 | 不短路,避免泄漏匹配位置)
        matched = False
        for h in hashed_codes:
            matched = matched | hmac.compare_digest(code_hash, h)
        if not matched:
            raise InvalidBackupCodeError("备用码无效或已使用")

        # Remove used code
        hashed_codes.remove(code_hash)
        user.totp.backup_codes_hash = json.dumps(hashed_codes)
        user.totp.last_used_at = utcnow()
        db.commit()

        logger.info(f"Backup code used for user {user.id}, {len(hashed_codes)} remaining")

        return True

    @classmethod
    def regenerate_backup_codes(
        cls,
        db: Session,
        user: User
    ) -> List[str]:
        """
        Regenerate backup codes.

        Args:
            db: Database session
            user: User

        Returns:
            New list of backup codes

        Raises:
            TOTPNotEnabledError: If TOTP not enabled
        """
        if not user.totp or not user.totp.is_enabled:
            raise TOTPNotEnabledError("TOTP 未启用")

        backup_codes = cls.generate_backup_codes()
        hashed_codes = [cls.hash_backup_code(c) for c in backup_codes]

        user.totp.backup_codes_hash = json.dumps(hashed_codes)
        db.commit()

        logger.info(f"Backup codes regenerated for user {user.id}")

        return backup_codes

    @staticmethod
    def get_totp_status(user: User) -> dict:
        """Get TOTP status for a user"""
        if not user.totp:
            return {
                "enabled": False,
                "name": None,
                "backup_codes_remaining": 0,
                "last_used_at": None
            }

        backup_count = 0
        if user.totp.backup_codes_hash:
            backup_count = len(json.loads(user.totp.backup_codes_hash))

        return {
            "enabled": user.totp.is_enabled,
            "name": user.totp.name,
            "backup_codes_remaining": backup_count,
            "last_used_at": user.totp.last_used_at.isoformat() if user.totp.last_used_at else None
        }

    @staticmethod
    def disable_totp(db: Session, user: User) -> bool:
        """
        Disable TOTP for a user.

        Args:
            db: Database session
            user: User

        Returns:
            True if TOTP was disabled

        Raises:
            TOTPNotEnabledError: If TOTP not enabled
        """
        if not user.totp:
            raise TOTPNotEnabledError("TOTP 未设置")

        db.delete(user.totp)
        db.commit()

        logger.info(f"TOTP disabled for user {user.id}")

        return True
